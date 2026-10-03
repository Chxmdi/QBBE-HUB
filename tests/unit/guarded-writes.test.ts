import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type Answer, type TableCall } from "@/lib/objects/testing/fake-db";

/**
 * The saves the refused-write review marked "Guarded": an app-side check runs
 * before the write and matches the database rule, so a person the database
 * would refuse never reaches the write. Each test denies that check and
 * proves nothing is written.
 */

const ORG = "44444444-4444-4444-8444-444444444444";
const ME = "55555555-5555-4555-8555-555555555555";
const SOMEONE = "66666666-6666-4666-8666-666666666666";
const ID = "77777777-7777-4777-8777-777777777777";
const PROJECT = "88888888-8888-4888-8888-888888888888";

let isStaff = true;
let isAdmin = true;
let canManageProject = true;
let flagOn = true;
let answer: (call: TableCall) => Answer = () => ({ data: null, error: null });
const recorded: TableCall[][] = [];
const writesOf = () => recorded.flat().filter((c) => c.action !== "select");

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/auth", () => {
  const refuse = async () => {
    throw new Error("not an administrator");
  };
  const session = () => ({ userId: ME, organizationId: ORG, timeZone: "America/Toronto", isAdmin, isStaff, role: isAdmin ? "admin" : "staff" });
  return {
    requireSession: async () => session(),
    authorizeAdminAction: async () => (isAdmin ? { ok: true, session: session() } : { ok: false, error: "Admins only.", reason: "role" }),
    requireAdmin: async () => (isAdmin ? session() : refuse()),
  };
});
vi.mock("@/lib/feature-flags", () => ({ isEnabled: async () => flagOn }));
vi.mock("@/lib/i18n/server", async () => {
  const { createTranslator } = await import("@/lib/i18n/translate");
  return { getLocale: async () => "en", getT: async () => createTranslator("en") };
});
vi.mock("@/lib/rate-limit", () => ({ enforceRateLimit: async () => null }));
vi.mock("@/lib/access-capabilities", () => ({
  hasProjectCapability: async () => canManageProject,
  hasProgramCapability: async () => canManageProject,
}));
vi.mock("@/features/jobs/services/notify", () => ({ createNotifications: async () => undefined, notificationDedupeKey: () => "k" }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => {
    const fake = fakeDb({ table: (call) => answer(call) });
    recorded.push(fake.tableCalls);
    return fake.db;
  },
}));
vi.mock("@/lib/supabase/service", () => ({
  createSupabaseServiceClient: () => {
    const fake = fakeDb({ table: (call) => answer(call) });
    recorded.push(fake.tableCalls);
    return fake.db;
  },
}));

const crm = await import("@/features/crm/services/crm.commands");
const milestones = await import("@/features/projects/services/milestone.commands");
const { editMessage } = await import("@/features/channels/services/message.commands");
const { connectVolunteerSystem } = await import("@/features/admin/services/integration.commands");
const { saveWorkflow } = await import("@/features/workflows/services/workflow.commands");
const gifts = await import("@/features/gifts/services/gift.commands");
const { createProgramFromTemplate } = await import("@/features/programs/services/program-template.commands");

beforeEach(() => {
  recorded.length = 0;
  isStaff = true;
  isAdmin = true;
  canManageProject = true;
  flagOn = true;
  answer = () => ({ data: null, error: null });
});

describe("CRM: only staff change organizations and follow-ups", () => {
  it("refuses someone who is not staff before any write", async () => {
    isStaff = false;
    expect((await crm.updateCrmOrganization({ id: ID, name: "Fondation", category: "funder" })).ok).toBe(false);
    expect((await crm.setCrmOrganizationStatus(ID, "inactive")).ok).toBe(false);
    expect((await crm.completeFollowUp(ID)).ok).toBe(false);
    expect(writesOf()).toHaveLength(0);
  });
});

describe("milestones: only project managers change them", () => {
  it("refuses someone who cannot manage the project before any write", async () => {
    canManageProject = false;
    answer = (call) =>
      call.table === "milestone" && call.action === "select"
        ? { data: { id: ID, project_id: PROJECT, completed_at: null, sort_key: 1, name: "Launch" }, error: null }
        : { data: null, error: null };
    expect((await milestones.completeMilestone({ milestoneId: ID, completed: true, evidence: "Report filed" })).ok).toBe(false);
    expect((await milestones.updateMilestone({ milestoneId: ID, name: "Launch day" })).ok).toBe(false);
    expect((await milestones.reorderMilestone({ milestoneId: ID, direction: "up" })).ok).toBe(false);
    expect((await milestones.deleteMilestone(ID)).ok).toBe(false);
    expect(writesOf()).toHaveLength(0);
  });
});

describe("messages: only the author edits", () => {
  it("refuses someone else's message before any write", async () => {
    answer = (call) =>
      call.table === "message" && call.action === "select"
        ? { data: { id: ID, author_id: SOMEONE, deleted_at: null, channel_id: ID }, error: null }
        : { data: null, error: null };
    expect((await editMessage({ messageId: ID, body: "Changed" })).ok).toBe(false);
    expect(writesOf()).toHaveLength(0);
  });
});

describe("admin-only connections and workflows", () => {
  it("refuses a non-administrator before any write", async () => {
    isAdmin = false;
    expect(await connectVolunteerSystem()).toEqual({ ok: false, error: "Admins only." });
    expect((await saveWorkflow({})).ok).toBe(false);
    expect(writesOf()).toHaveLength(0);
  });

  it("refuses gift acknowledgements and programs from templates to a non-administrator", async () => {
    isAdmin = false;
    expect((await gifts.resendAcknowledgement(ID)).ok).toBe(false);
    expect((await gifts.issueGiftAcknowledgement({ giftId: ID })).ok).toBe(false);
    expect(await createProgramFromTemplate(ID)).toEqual({ ok: false, error: "Admins only." });
    expect(writesOf()).toHaveLength(0);
  });

  it("refuses workflows while their switch is off, even for an administrator", async () => {
    flagOn = false;
    expect((await saveWorkflow({})).ok).toBe(false);
    expect(writesOf()).toHaveLength(0);
  });
});

describe("the same calls do write once the check allows them", () => {
  // Without these, a refusal above could come from bad input rather than the guard.
  it("staff, a project manager and the author each reach their write", async () => {
    answer = (call) => {
      if (call.action === "update") return { data: [{ id: ID }], error: null };
      if (call.table === "milestone" && call.action === "select")
        return { data: { id: ID, project_id: PROJECT, completed_at: null, sort_key: 1, name: "Launch" }, error: null };
      if (call.table === "message" && call.action === "select")
        return { data: { id: ID, author_id: ME, deleted_at: null, channel_id: ID }, error: null };
      return { data: null, error: null };
    };
    await crm.updateCrmOrganization({ id: ID, name: "Fondation", category: "funder" });
    await milestones.updateMilestone({ milestoneId: ID, name: "Launch day" });
    await editMessage({ messageId: ID, body: "Changed" });
    const updated = writesOf().filter((c) => c.action === "update").map((c) => c.table);
    expect(updated).toEqual(expect.arrayContaining(["crm_organization", "milestone", "message"]));
  });
});

describe("own-row saves only ever touch the caller's row", () => {
  const ownFilter = (table: string) =>
    writesOf()
      .filter((c) => c.table === table && c.action === "update")
      .map((c) => c.filters.find((f) => f.column === "user_id")?.value);

  it("muting a channel and marking a channel or conversation read filter on the caller", async () => {
    answer = (call) => (call.action === "update" ? { data: [{ id: ID }], error: null } : { data: null, error: null });
    const channels = await import("@/features/channels/services/channel.commands");
    const messages = await import("@/features/channels/services/message.commands");
    await channels.setChannelMute({ channelId: ID, mutedLevel: "muted" });
    await channels.markChannelRead(ID);
    await messages.markConversationRead(ID);
    expect(ownFilter("channel_member")).toEqual([ME, ME]);
    expect(ownFilter("conversation_member")).toEqual([ME]);
  });
});

describe("disconnecting an integration", () => {
  it("disconnects only the caller's own Google connection, and says so when none was there", async () => {
    const { disconnectIntegration } = await import("@/features/admin/services/integration.commands");
    // The update asks for one row back (maybeSingle): a row, or nothing.
    answer = (call) => (call.action === "update" ? { data: { id: ID }, error: null } : { data: null, error: null });
    expect((await disconnectIntegration("gmail")).ok).toBe(true);
    const update = writesOf().find((c) => c.table === "integration_connection");
    expect(update?.filters).toEqual(expect.arrayContaining([{ op: "eq", column: "user_id", value: ME }]));

    recorded.length = 0;
    answer = () => ({ data: null, error: null });
    expect((await disconnectIntegration("gmail")).ok).toBe(false);
  });
});
