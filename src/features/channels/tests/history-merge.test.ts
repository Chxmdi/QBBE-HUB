import { describe, expect, it, vi } from "vitest";
import { mergeMessages, upsertMessage } from "@/features/channels/history";
import { createReadReceipt } from "@/features/channels/read-receipt";

type Message = {
  id: string;
  created_at: string;
  body: string;
  edited_at: string | null;
  reactions?: { user_id: string; emoji: string }[];
};

function message(index: number, patch: Partial<Message> = {}): Message {
  return {
    id: `00000000-0000-0000-0000-${String(index).padStart(12, "0")}`,
    created_at: new Date(Date.UTC(2026, 0, 1, 9, 0, index)).toISOString(),
    body: `Message ${index}`,
    edited_at: null,
    reactions: [],
    ...patch,
  };
}

/** The same rows as a fresh read returns them: equal, but new objects. */
function refetched(messages: Message[]): Message[] {
  return messages.map((m) => structuredClone(m));
}

describe("mergeMessages keeps unchanged messages", () => {
  it("reuses the shown object when a refetch returns the same message", () => {
    const shown = [message(1), message(2), message(3)];
    const merged = mergeMessages(shown, refetched(shown));
    merged.forEach((m, index) => expect(m).toBe(shown[index]));
  });

  it("takes the fresh object when the message was edited or reacted to", () => {
    const shown = [message(1), message(2), message(3)];
    const fresh = refetched(shown);
    fresh[1] = { ...fresh[1], body: "Edited", edited_at: "2026-01-01T10:00:00.000Z" };
    fresh[2] = { ...fresh[2], reactions: [{ user_id: "u1", emoji: "👍" }] };
    const merged = mergeMessages(shown, fresh);
    expect(merged[0]).toBe(shown[0]);
    expect(merged[1]).toBe(fresh[1]);
    expect(merged[2]).toBe(fresh[2]);
  });

  it("still adds new messages in order", () => {
    const shown = [message(1), message(3)];
    const merged = mergeMessages(shown, [message(2), message(4)]);
    expect(merged.map((m) => m.body)).toEqual(["Message 1", "Message 2", "Message 3", "Message 4"]);
  });
});

describe("upsertMessage", () => {
  it("returns the same list when the fetched message is already shown unchanged", () => {
    const shown = [message(1), message(2)];
    expect(upsertMessage(shown, structuredClone(shown[1]))).toBe(shown);
  });

  it("adds a new message in order and replaces a changed one", () => {
    const shown = [message(1), message(3)];
    const added = upsertMessage(shown, message(2));
    expect(added.map((m) => m.body)).toEqual(["Message 1", "Message 2", "Message 3"]);
    expect(added[0]).toBe(shown[0]);
    const edited = upsertMessage(added, message(3, { body: "Edited" }));
    expect(edited.map((m) => m.body)).toEqual(["Message 1", "Message 2", "Edited"]);
  });
});

describe("createReadReceipt", () => {
  function harness(visible = true) {
    vi.useFakeTimers();
    const state = { visible };
    const send = vi.fn();
    const receipt = createReadReceipt(send, {
      intervalMs: 10_000,
      isVisible: () => state.visible,
    });
    return { state, send, receipt };
  }

  it("sends the first request at once and at most one more per interval", () => {
    const { send, receipt } = harness();
    receipt.request();
    expect(send).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 20; i += 1) {
      vi.advanceTimersByTime(400);
      receipt.request();
    }
    // 8 seconds of new messages: still one receipt.
    expect(send).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(2_000);
    // The trailing receipt covers the messages that arrived in between.
    expect(send).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(30_000);
    expect(send).toHaveBeenCalledTimes(2);
    receipt.dispose();
    vi.useRealTimers();
  });

  it("waits while the tab is hidden and sends once it is shown", () => {
    const { state, send, receipt } = harness(false);
    receipt.request();
    receipt.request();
    vi.advanceTimersByTime(60_000);
    expect(send).not.toHaveBeenCalled();
    state.visible = true;
    receipt.visible();
    expect(send).toHaveBeenCalledTimes(1);
    receipt.dispose();
    vi.useRealTimers();
  });

  it("sends a pending receipt when the view closes, and nothing after", () => {
    const { send, receipt } = harness();
    receipt.request();
    receipt.request();
    expect(send).toHaveBeenCalledTimes(1);
    receipt.flush();
    expect(send).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(60_000);
    expect(send).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
