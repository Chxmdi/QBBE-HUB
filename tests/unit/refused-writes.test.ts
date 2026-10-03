import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type Answer, type TableCall } from "@/lib/objects/testing/fake-db";

/**
 * Row-level security refuses a write by matching no row, which PostgREST
 * reports as success. Each action here used to treat that as done and then
 * act on it: an audit record of a deletion that never happened, a "you were
 * assigned" notification for a reassignment that never happened, or a
 * project's open tasks hidden while the project stayed open.
 */

const ORG = "44444444-4444-4444-8444-444444444444";
const ME = "55555555-5555-4555-8555-555555555555";
const NEW_OWNER = "66666666-6666-4666-8666-666666666666";
const ID = "77777777-7777-4777-8777-777777777777";

let answer: (call: TableCall) => Answer;
const createNotifications = vi.fn();

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/auth", () => {
  const session = { userId: ME, organizationId: ORG, timeZone: "America/Toronto", isAdmin: false, isStaff: true, role: "staff" };
  return { requireSession: async () => session, authorizeAdminAction: async () => ({ ok: true, session }) };
});
vi.mock("@/lib/i18n/server", async () => {
  const { createTranslator } = await import("@/lib/i18n/translate");
  return { getLocale: async () => "en", getT: async () => createTranslator("en") };
});
vi.mock("@/lib/rate-limit", () => ({ enforceRateLimit: async () => null }));
vi.mock("@/lib/access-capabilities", () => ({
  hasProjectCapability: async () => true,
  hasProgramCapability: async () => true,
}));
vi.mock("@/features/jobs/services/notify", () => ({
  createNotifications: (...a: unknown[]) => createNotifications(...a),
  notificationDedupeKey: () => "k",
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => {
    const fake = fakeDb({ table: (call) => answer(call) });
    // An action may open more than one client; keep every client's calls.
    recorded.push(fake.tableCalls);
    return fake.db;
  },
}));
const recorded: TableCall[][] = [];
const calls = () => recorded.flat();

const { deleteMessage } = await import("@/features/channels/services/message.commands");
const { setChannelArchived } = await import("@/features/channels/services/channel.commands");
const { archiveDocument, restoreDocument } = await import("@/features/documents/services/document.commands");
const { updateOpportunity } = await import("@/features/crm/services/opportunity.commands");
const { closeProject } = await import("@/features/projects/services/project.commands");
const { toggleChecklistItem } = await import("@/features/tasks/services/checklist.commands");

/** Reads succeed; `allowed` decides whether updates match the row. */
function db(allowed: boolean, reads: Record<string, unknown> = {}) {
  return (call: TableCall): Answer => {
    if (call.action === "update") return { data: allowed ? [{ id: ID }] : [], error: null };
    if (call.action === "select") return { data: reads[call.table] ?? null, error: null };
    return { data: { id: "new-row" }, error: null };
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  recorded.length = 0;
});

describe("deleteMessage", () => {
  it("records the deletion only when a message was deleted", async () => {
    answer = db(true);
    expect(await deleteMessage(ID)).toEqual({ ok: true });
    expect(calls().some((c) => c.table === "audit_event")).toBe(true);
  });

  it("a refused deletion fails and leaves no audit record", async () => {
    answer = db(false);
    const result = await deleteMessage(ID);
    expect(result.ok).toBe(false);
    // A sentence in the reader's language, not a catalogue key.
    expect(result.ok ? "" : result.error).not.toMatch(/^messages\./);
    expect(calls().some((c) => c.table === "audit_event")).toBe(false);
  });
});

describe("setChannelArchived", () => {
  const reads = { channel: { is_mandatory: false, name: "general" } };

  it("a refused archive fails and leaves no audit record", async () => {
    answer = db(false, reads);
    expect(await setChannelArchived(ID, true)).toEqual({ ok: false, error: "Only the channel owner or an admin can do that." });
    expect(calls().some((c) => c.table === "audit_event")).toBe(false);
  });

  it("an allowed archive is audited", async () => {
    answer = db(true, reads);
    expect((await setChannelArchived(ID, true)).ok).toBe(true);
    expect(calls().find((c) => c.table === "audit_event")?.payload).toMatchObject({ action: "channel_archived" });
  });
});

describe("archiveDocument", () => {
  it("reports a refused archive instead of success", async () => {
    answer = db(false);
    expect(await archiveDocument(ID)).toEqual({ ok: false, error: "Could not archive the document." });
    answer = db(true);
    expect(await archiveDocument(ID)).toEqual({ ok: true });
  });

  it("reports a refused restore instead of success", async () => {
    answer = db(false);
    expect(await restoreDocument(ID)).toEqual({ ok: false, error: "Could not restore the document." });
    answer = db(true);
    expect(await restoreDocument(ID)).toEqual({ ok: true });
  });
});

describe("updateOpportunity", () => {
  const reads = { opportunity: { id: ID, crm_organization_id: ID, title: "Grant", stage: "prospect", owner_id: ME } };

  it("a refused reassignment fails and tells nobody they were assigned", async () => {
    answer = db(false, reads);
    expect(await updateOpportunity({ opportunityId: ID, ownerId: NEW_OWNER })).toEqual({
      ok: false,
      error: "That opportunity is not available to you.",
    });
    expect(createNotifications).not.toHaveBeenCalled();
  });
});

describe("closeProject", () => {
  it("leaves open tasks alone when the project could not be closed", async () => {
    answer = (call) => (call.table === "project" && call.action === "update" ? { data: null, error: null } : db(true)(call));
    const result = await closeProject({ projectId: ID, results: "Delivered the fair.", archiveOpenTasks: true });
    expect(result.ok).toBe(false);
    expect(calls().some((c) => c.table === "task" && c.action === "update")).toBe(false);
  });

  it("archives open tasks after the project is closed", async () => {
    answer = (call) =>
      call.table === "project" && call.action === "update" ? { data: { name: "Fair", program_id: null }, error: null } : db(true)(call);
    await closeProject({ projectId: ID, results: "Delivered the fair.", archiveOpenTasks: true });
    const order = calls().filter((c) => c.action === "update").map((c) => c.table);
    expect(order.indexOf("project")).toBeGreaterThanOrEqual(0);
    expect(order.indexOf("task")).toBeGreaterThan(order.indexOf("project"));
  });
});

describe("toggleChecklistItem", () => {
  it("reports a refused tick instead of success", async () => {
    answer = db(false);
    expect((await toggleChecklistItem(ID, true)).ok).toBe(false);
    answer = db(true);
    expect(await toggleChecklistItem(ID, true)).toEqual({ ok: true });
  });
});
