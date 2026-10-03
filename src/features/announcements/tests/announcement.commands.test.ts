import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type Answer, type TableCall } from "@/lib/objects/testing/fake-db";

const ORG = "44444444-4444-4444-8444-444444444444";
const ME = "55555555-5555-4555-8555-555555555555";
const OTHER = "66666666-6666-4666-8666-666666666666";
const CHANNEL = "77777777-7777-4777-8777-777777777777";
const ANNOUNCEMENT = "88888888-8888-4888-8888-888888888888";

let tableCalls: TableCall[] = [];
let answer: (call: TableCall) => Answer;
let isAdmin = true;
let limited: { ok: false; error: string } | null = null;
const createNotifications = vi.fn();
const fireWorkflows = vi.fn();

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/auth", () => {
  const session = { userId: ME, organizationId: ORG, timeZone: "America/Toronto" };
  return {
    requireSession: async () => session,
    authorizeAdminAction: async () =>
      isAdmin ? { ok: true, session } : { ok: false, error: "Only an administrator can do that." },
  };
});
vi.mock("@/lib/i18n/server", async () => {
  const { createTranslator } = await import("@/lib/i18n/translate");
  return { getLocale: async () => "en", getT: async () => createTranslator("en") };
});
vi.mock("@/lib/rate-limit", () => ({ enforceRateLimit: async () => limited }));
vi.mock("@/features/channels/recipient-locale", async () => {
  const { createTranslator } = await import("@/lib/i18n/translate");
  return { recipientTranslators: async () => () => createTranslator("en") };
});
vi.mock("@/features/jobs/services/notify", () => ({
  createNotifications: (...a: unknown[]) => createNotifications(...a),
  notificationDedupeKey: (...parts: string[]) => parts.join(":"),
}));
vi.mock("@/features/admin/services/workflow.runtime", () => ({
  fireWorkflows: (...a: unknown[]) => fireWorkflows(...a),
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => {
    const fake = fakeDb({ table: (call) => answer(call) });
    tableCalls = fake.tableCalls;
    return fake.db;
  },
}));

const { acknowledgeAnnouncement, publishAnnouncement } = await import("../services/announcement.commands");

function happy(call: TableCall): Answer {
  if (call.table === "channel") return { data: { id: CHANNEL }, error: null };
  if (call.table === "message" && call.action === "insert") return { data: { id: "msg-1" }, error: null };
  if (call.table === "announcement" && call.action === "insert") return { data: { id: ANNOUNCEMENT }, error: null };
  if (call.table === "organization_membership") return { data: [{ user_id: ME }, { user_id: OTHER }], error: null };
  return { data: null, error: null };
}
const inserted = (table: string) => tableCalls.find((c) => c.table === table && c.action === "insert")?.payload as
  | Record<string, unknown>
  | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  tableCalls = [];
  isAdmin = true;
  limited = null;
  answer = happy;
});

describe("publishAnnouncement", () => {
  const post = { title: "Office closed", body: "Closed Monday for the holiday.", priority: "important", requiresAck: true };

  it("posts now, notifies everyone but the author, records an audit event and fires workflows", async () => {
    expect(await publishAnnouncement(post)).toEqual({ ok: true, id: ANNOUNCEMENT });
    expect(inserted("message")).toMatchObject({ channel_id: CHANNEL, author_id: ME, body: post.body });
    expect(inserted("announcement")).toMatchObject({ message_id: "msg-1", body: null, channel_id: null, priority: "important", requires_ack: true });
    const [, rows] = createNotifications.mock.calls[0] as [unknown, { user_id: string; urgency: string }[]];
    expect(rows.map((r) => r.user_id)).toEqual([OTHER]);
    // An announcement that needs acknowledging is raised above normal.
    expect(rows[0].urgency).toBe("high");
    expect(inserted("audit_event")).toMatchObject({ action: "announcement_published", object_id: ANNOUNCEMENT });
    expect(fireWorkflows).toHaveBeenCalledOnce();
  });

  it("marks a critical announcement critical", async () => {
    await publishAnnouncement({ ...post, priority: "critical", requiresAck: false });
    const [, rows] = createNotifications.mock.calls[0] as [unknown, { urgency: string }[]];
    expect(rows[0].urgency).toBe("critical");
  });

  it("holds a scheduled announcement's text on its own row and tells nobody yet", async () => {
    const result = await publishAnnouncement({ ...post, publishAt: "2099-01-05T09:00" });
    expect(result.ok).toBe(true);
    expect(inserted("message")).toBeUndefined();
    // 09:00 in Toronto in January (EST) is 14:00 UTC.
    expect(inserted("announcement")).toMatchObject({
      message_id: null,
      body: post.body,
      channel_id: CHANNEL,
      publish_at: "2099-01-05T14:00:00.000Z",
    });
    expect(createNotifications).not.toHaveBeenCalled();
    expect(fireWorkflows).not.toHaveBeenCalled();
  });

  it("reads the acknowledgement deadline in the organization's time zone", async () => {
    await publishAnnouncement({ ...post, ackDeadline: "2026-11-10T17:00" });
    expect(inserted("announcement")).toMatchObject({ ack_deadline: "2026-11-10T22:00:00.000Z" });
  });

  it("refuses a non-administrator and a person over the rate limit before writing anything", async () => {
    isAdmin = false;
    expect(await publishAnnouncement(post)).toEqual({ ok: false, error: "Only an administrator can do that." });
    isAdmin = true;
    limited = { ok: false, error: "Slow down." };
    expect(await publishAnnouncement(post)).toEqual({ ok: false, error: "Slow down." });
    expect(tableCalls).toHaveLength(0);
  });

  it("refuses a missing title or body, an impossible publish time and an impossible deadline", async () => {
    for (const bad of [
      { ...post, title: "  " },
      { ...post, body: "" },
      { ...post, priority: "urgent" },
      { ...post, publishAt: "2026-02-31T09:00" },
      { ...post, ackDeadline: "2026-13-01T09:00" },
    ]) {
      expect((await publishAnnouncement(bad)).ok, JSON.stringify(bad)).toBe(false);
    }
    expect(tableCalls.some((c) => c.action === "insert")).toBe(false);
  });

  it("says so when there is no announcements channel or the message cannot be posted", async () => {
    answer = (call) => (call.table === "channel" ? { data: null, error: null } : happy(call));
    expect((await publishAnnouncement(post)).ok).toBe(false);
    answer = (call) =>
      call.table === "message" ? { data: null, error: { message: "rls" } } : happy(call);
    const denied = await publishAnnouncement(post);
    expect(denied.ok).toBe(false);
    expect(inserted("announcement")).toBeUndefined();
    expect(createNotifications).not.toHaveBeenCalled();
  });
});

describe("acknowledgeAnnouncement", () => {
  it("records a click acknowledgement once, ignoring a repeat", async () => {
    expect(await acknowledgeAnnouncement(ANNOUNCEMENT)).toEqual({ ok: true });
    const upsert = tableCalls.find((c) => c.action === "upsert");
    expect(upsert).toMatchObject({ table: "announcement_acknowledgment", payload: { announcement_id: ANNOUNCEMENT, user_id: ME, method: "click" } });
  });

  it("reports a refused acknowledgement", async () => {
    answer = () => ({ data: null, error: { message: "rls" } });
    expect((await acknowledgeAnnouncement(ANNOUNCEMENT)).ok).toBe(false);
  });
});
