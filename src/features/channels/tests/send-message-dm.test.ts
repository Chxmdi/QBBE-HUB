import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type Answer, type TableCall } from "@/lib/objects/testing/fake-db";

const ORG = "44444444-4444-4444-8444-444444444444";
const ME = "55555555-5555-4555-8555-555555555555";
const BEA = "66666666-6666-4666-8666-666666666666";
const CAL = "77777777-7777-4777-8777-777777777777";
const CONVERSATION = "88888888-8888-4888-8888-888888888888";
const CHANNEL = "99999999-9999-4999-8999-999999999999";

let answer: (call: TableCall) => Answer;
const createNotifications = vi.fn();

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/auth", () => ({
  requireSession: async () => ({
    userId: ME,
    organizationId: ORG,
    timeZone: "America/Toronto",
    profile: { full_name: "Ada Lovelace" },
  }),
}));
vi.mock("@/lib/i18n/server", async () => {
  const { createTranslator } = await import("@/lib/i18n/translate");
  return { getLocale: async () => "en", getT: async () => createTranslator("en") };
});
vi.mock("@/lib/rate-limit", () => ({ enforceRateLimit: async () => null }));
vi.mock("@/features/channels/recipient-locale", async () => {
  const { createTranslator } = await import("@/lib/i18n/translate");
  return {
    recipientTranslators: async () => (userId: string) =>
      createTranslator(userId === CAL ? "fr-CA" : "en"),
  };
});
vi.mock("@/features/jobs/services/notify", () => ({
  createNotifications: (...a: unknown[]) => createNotifications(...a),
  notificationDedupeKey: (...parts: string[]) => parts.join(":"),
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => fakeDb({ table: (call) => answer(call) }).db,
}));

const { sendMessage } = await import("../services/message.commands");

type Draft = { user_id: string; title: string; body: string | null; dedupe_key: string; link: string; category: string; reason: string };
const drafts = () => createNotifications.mock.calls.flatMap((call) => call[1] as Draft[]);

function happy(call: TableCall): Answer {
  if (call.table === "message" && call.action === "insert") return { data: { id: "msg-1" }, error: null };
  if (call.table === "conversation_member") {
    return { data: [{ user_id: ME }, { user_id: BEA }, { user_id: CAL }], error: null };
  }
  if (call.table === "organization_membership") {
    return {
      data: [
        { user_id: ME, user_profile: { full_name: "Ada Lovelace" } },
        { user_id: BEA, user_profile: { full_name: "Bea Arthur" } },
        { user_id: CAL, user_profile: { full_name: "Cal Ripken" } },
      ],
      error: null,
    };
  }
  return { data: [], error: null };
}

beforeEach(() => {
  vi.clearAllMocks();
  answer = happy;
});

describe("sendMessage in a direct conversation", () => {
  it("notifies every other member once, keyed on the message, without the message text", async () => {
    expect(await sendMessage({ conversationId: CONVERSATION, body: "Salary figures for March are attached" })).toEqual({ ok: true, id: "msg-1" });
    const rows = drafts();
    expect(rows.map((r) => r.user_id).sort()).toEqual([BEA, CAL].sort());
    for (const row of rows) {
      expect(row.dedupe_key).toBe(`message:msg-1:${row.user_id}`);
      expect(row.link).toBe(`/messages/${CONVERSATION}`);
      expect(row.body).toBeNull();
      expect(JSON.stringify(row)).not.toContain("Salary");
    }
    expect(rows.find((r) => r.user_id === BEA)?.title).toBe("Ada Lovelace sent you a direct message");
    expect(rows.find((r) => r.user_id === CAL)?.title).toBe("Ada Lovelace vous a envoyé un message direct");
  });

  it("does not add a second notice for someone the message also mentions", async () => {
    await sendMessage({ conversationId: CONVERSATION, body: "@Bea Arthur can you look?" });
    const rows = drafts();
    expect(rows.filter((r) => r.user_id === BEA)).toHaveLength(1);
    expect(rows.find((r) => r.user_id === BEA)?.category).toBe("mention");
    expect(rows.filter((r) => r.user_id === CAL)).toHaveLength(1);
    expect(rows.some((r) => r.user_id === ME)).toBe(false);
  });

  it("leaves plain channel messages as they were: no notice without a mention", async () => {
    await sendMessage({ channelId: CHANNEL, body: "Morning all" });
    expect(drafts()).toEqual([]);
  });
});
