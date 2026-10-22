import { describe, expect, it, vi } from "vitest";
import { FakeSupabase, asClient } from "../../../../tests/support/fake-supabase";
import { countUnread, watchNotifications } from "@/components/layout/unread-badge";

describe("the notification bell's count", () => {
  it("counts only unread notifications", async () => {
    const db = new FakeSupabase();
    db.seed("notification", [
      { id: "a", read_at: null },
      { id: "b", read_at: "2026-10-01T00:00:00Z" },
      { id: "c", read_at: null },
    ]);
    expect(await countUnread(asClient(db))).toBe(2);
  });

  it("recounts on every change to the person's notifications, and stops when asked", async () => {
    let handler: (() => void) | null = null;
    const channel = {
      on: vi.fn((_kind: string, _filter: unknown, cb: () => void) => {
        handler = cb;
        return channel;
      }),
      subscribe: vi.fn(() => channel),
    };
    const removeChannel = vi.fn(async () => "ok");
    const client = {
      auth: { getSession: async () => ({ data: { session: { access_token: "t", user: { id: "u1" } } } }) },
      realtime: { setAuth: vi.fn(async () => undefined) },
      channel: vi.fn(() => channel),
      removeChannel,
    };
    const onChange = vi.fn();
    const stop = watchNotifications(client as never, onChange);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(client.realtime.setAuth).toHaveBeenCalledWith("t");
    expect(channel.on).toHaveBeenCalledWith("postgres_changes", { event: "*", schema: "public", table: "notification" }, expect.any(Function));
    handler!();
    expect(onChange).toHaveBeenCalledTimes(1);
    stop();
    expect(removeChannel).toHaveBeenCalledWith(channel);
  });
});
