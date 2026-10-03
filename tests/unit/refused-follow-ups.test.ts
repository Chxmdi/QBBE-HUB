import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type Answer, type TableCall } from "@/lib/objects/testing/fake-db";

/**
 * The second half of the refused-write review: saves whose refusal left
 * nothing else behind but still read as done, and the two-step writes whose
 * second step could be refused after the first had landed.
 */

const ORG = "44444444-4444-4444-8444-444444444444";
const ME = "55555555-5555-4555-8555-555555555555";
const A = "77777777-7777-4777-8777-777777777777";
const B = "88888888-8888-4888-8888-888888888888";
const LATER = "99999999-9999-4999-8999-999999999999";

let answer: (call: TableCall) => Answer;
const recorded: TableCall[][] = [];
const calls = () => recorded.flat();
const writes = (table: string, action: TableCall["action"]) => calls().filter((c) => c.table === table && c.action === action);

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
vi.mock("@/lib/access-capabilities", () => ({ hasProjectCapability: async () => true, hasProgramCapability: async () => true }));
vi.mock("@/features/calendar/services/google-calendar-write", () => ({
  createGoogleMeetingEvent: async () => undefined,
  updateGoogleMeetingEvent: async () => undefined,
  deleteGoogleMeetingEvent: async () => undefined,
  calendarFailureStatus: () => "degraded",
}));
vi.mock("@/features/jobs/services/notify", () => ({ createNotifications: async () => undefined, notificationDedupeKey: () => "k" }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => {
    const fake = fakeDb({ table: (call) => answer(call) });
    recorded.push(fake.tableCalls);
    return fake.db;
  },
}));

const meetings = await import("@/features/meetings/services/meeting.commands");
const { recordProjectDecision } = await import("@/features/risks/services/decision.commands");
const { escalateRiskToIssue } = await import("@/features/risks/services/risk.commands");
const { reorderChecklist } = await import("@/features/tasks/services/checklist.commands");
const { restoreTasks } = await import("@/features/tasks/services/task.commands");

const agendaItem = {
  id: A, meeting_id: A, title: "Budget", desired_outcome: null, status: "accepted", sort_key: 2,
  meeting: { status: "scheduled", project_id: null, series_id: null, starts_at: "2026-10-01T14:00:00Z" },
};
const reads: Record<string, unknown> = {
  agenda_item: agendaItem,
  meeting: { id: LATER, status: "scheduled", starts_at: "2026-11-01T14:00:00Z" },
  risk: { id: A, title: "Rain", description: null, project_id: B, organization_id: ORG, owner_id: ME, mitigation: null },
  checklist_item: [{ id: A }, { id: B }],
};
/** `refuse` lists "table.update" pairs that match no row; everything else succeeds. */
function db(refuse: string[] = []) {
  return (call: TableCall): Answer => {
    if (call.action === "update") return { data: refuse.includes(`${call.table}.update`) ? [] : [{ id: A }], error: null };
    if (call.action === "select") return { data: reads[call.table] ?? null, error: null };
    if (call.action === "insert") return { data: { id: B }, error: null };
    return { data: null, error: null };
  };
}

beforeEach(() => {
  recorded.length = 0;
  answer = db();
});

describe("agenda and notes", () => {
  it("triage, move and notes fail visibly when refused, and succeed otherwise", async () => {
    answer = db(["agenda_item.update", "meeting.update"]);
    expect((await meetings.triageAgendaItem({ agendaItemId: A, decision: "accepted" })).ok).toBe(false);
    expect((await meetings.moveAgendaItem({ agendaItemId: A, direction: "up" })).ok).toBe(false);
    expect((await meetings.saveMeetingNotes({ meetingId: A, notes: "Agreed." })).ok).toBe(false);
    answer = db();
    expect((await meetings.triageAgendaItem({ agendaItemId: A, decision: "accepted" })).ok).toBe(true);
    expect((await meetings.moveAgendaItem({ agendaItemId: A, direction: "up" })).ok).toBe(true);
    expect((await meetings.saveMeetingNotes({ meetingId: A, notes: "Agreed." })).ok).toBe(true);
  });

  it("combining touches the target only after the folded item is marked", async () => {
    answer = db(["agenda_item.update"]);
    expect(await meetings.combineAgendaItem({ agendaItemId: A, targetItemId: B })).toEqual({
      ok: false,
      error: "Only the meeting organizer can combine agenda items.",
    });
    expect(writes("agenda_item", "update")).toHaveLength(1);
    expect(writes("agenda_item", "update")[0].payload).toMatchObject({ status: "combined" });
  });

  it("a refused carry-forward copies nothing, and a failed copy puts the item back", async () => {
    answer = db(["agenda_item.update"]);
    expect(await meetings.carryForwardAgendaItem({ agendaItemId: A, targetMeetingId: LATER })).toEqual({
      ok: false,
      error: "Only the organizer or the person who proposed this item can carry it forward.",
    });
    expect(writes("agenda_item", "insert")).toHaveLength(0);

    recorded.length = 0;
    answer = (call) => (call.action === "insert" ? { data: null, error: { message: "refused" } } : db()(call));
    expect((await meetings.carryForwardAgendaItem({ agendaItemId: A, targetMeetingId: LATER })).ok).toBe(false);
    expect(writes("agenda_item", "update").map((c) => c.payload)).toEqual([{ status: "deferred" }, { status: "accepted" }]);
  });
});

describe("decisions and risks", () => {
  it("a decision for a request already answered is removed, so a retry cannot record it twice", async () => {
    answer = db(["decision_request.update"]);
    expect(await recordProjectDecision({ projectId: B, title: "Go ahead", requestId: A })).toEqual({
      ok: false,
      error: "That request was already answered, so no decision was recorded.",
    });
    expect(writes("decision", "delete")).toHaveLength(1);
  });

  it("an issue raised from a risk that could not be closed is removed", async () => {
    answer = db(["risk.update"]);
    expect((await escalateRiskToIssue({ riskId: A })).ok).toBe(false);
    expect(writes("issue", "delete")).toHaveLength(1);
    recorded.length = 0;
    answer = db();
    expect((await escalateRiskToIssue({ riskId: A })).ok).toBe(true);
    expect(writes("issue", "delete")).toHaveLength(0);
  });
});

describe("work", () => {
  it("a refused checklist reorder and a restore that restored nothing both fail", async () => {
    answer = db(["checklist_item.update", "task.update"]);
    expect((await reorderChecklist({ taskId: B, itemIds: [A, B] })).ok).toBe(false);
    expect(await restoreTasks([A])).toEqual({ ok: false, error: "Could not restore those tasks." });
    answer = db();
    expect((await reorderChecklist({ taskId: B, itemIds: [A, B] })).ok).toBe(true);
    expect(await restoreTasks([A])).toEqual({ ok: true });
  });
});
