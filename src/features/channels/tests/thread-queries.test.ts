import { describe, expect, it } from "vitest";
import { fakeDb, type TableCall } from "@/lib/objects/testing/fake-db";
import { fetchLinkedMessage, fetchThread } from "@/features/channels/services/thread.queries";

const CHANNEL = { column: "channel_id" as const, id: "chan-1" };
const ROOT = { id: "root-1", thread_root_id: null, created_at: "2026-01-01T00:00:00Z" };
const REPLY = { id: "reply-1", thread_root_id: "root-1", created_at: "2026-10-01T00:00:00Z" };

function db(rows: Record<string, unknown>[]) {
  return fakeDb({
    table: (call: TableCall) => {
      const id = call.filters.find((f) => f.op === "eq" && f.column === "id")?.value;
      const root = call.filters.find((f) => f.op === "eq" && f.column === "thread_root_id")?.value;
      if (id) return { data: rows.find((r) => r.id === id) ?? null, error: null };
      if (root) return { data: rows.filter((r) => r.thread_root_id === root), error: null };
      return { data: [], error: null };
    },
  });
}

describe("loading a thread or message the timeline does not have", () => {
  it("reads an old thread's root and its replies, within the channel", async () => {
    const fake = db([ROOT, REPLY]);
    const thread = await fetchThread(fake.db, CHANNEL, "root-1", "*");
    expect(thread.map((m) => m.id)).toEqual(["root-1", "reply-1"]);
    for (const call of fake.tableCalls) {
      expect(call.filters).toContainEqual({ op: "eq", column: "channel_id", value: "chan-1" });
    }
  });

  it("opens the thread a linked reply belongs to", async () => {
    const fake = db([ROOT, REPLY]);
    expect((await fetchLinkedMessage(fake.db, CHANNEL, "reply-1", "*")).map((m) => m.id)).toEqual(["root-1", "reply-1"]);
    expect((await fetchLinkedMessage(fake.db, CHANNEL, "root-1", "*")).map((m) => m.id)).toEqual(["root-1"]);
  });

  it("returns nothing for a message that cannot be read here", async () => {
    const fake = db([]);
    expect(await fetchThread(fake.db, CHANNEL, "root-1", "*")).toEqual([]);
    expect(await fetchLinkedMessage(fake.db, CHANNEL, "gone", "*")).toEqual([]);
  });
});
