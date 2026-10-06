import { describe, expect, it } from "vitest";
import { canRetry, durationMs, splitReason, summarizeRun, summaryLine } from "../run-summary";

const step = (position: number, step_id: string, status: string, extra: Partial<{ attempt: number; error: string; step_kind: string }> = {}) => ({
  position, step_id, status, step_kind: extra.step_kind ?? "action", attempt: extra.attempt ?? 1, error: extra.error ?? null,
});

describe("run summary", () => {
  it("reads as the debugger's headline", () => {
    const items = summarizeRun([
      step(0, "trigger", "succeeded", { step_kind: "trigger" }),
      step(1, "fetch", "succeeded"),
      step(2, "send", "failed", { error: "forbidden: the workflow's owner may not do this." }),
    ]);
    expect(summaryLine(items, (item) => item.stepId)).toBe(
      "✓ trigger ✓ fetch ✕ send (forbidden: the workflow's owner may not do this.)",
    );
  });

  it("folds retries and completed pauses into one visit", () => {
    const items = summarizeRun([
      step(0, "trigger", "succeeded"),
      step(1, "call", "failed", { attempt: 1, error: "failed: busy" }),
      step(2, "call", "succeeded", { attempt: 2 }),
      step(3, "pause", "waiting", { step_kind: "wait" }),
      step(4, "pause", "succeeded", { step_kind: "wait" }),
    ]);
    expect(items.map((item) => [item.stepId, item.symbol, item.attempts])).toEqual([
      ["trigger", "✓", 1], ["call", "✓", 2], ["pause", "✓", 1],
    ]);
  });

  it("keeps separate loop iterations of the same step", () => {
    const items = summarizeRun([step(0, "notify", "succeeded"), step(1, "notify", "succeeded")]);
    expect(items).toHaveLength(2);
  });

  it("orders by position and marks waiting runs", () => {
    const items = summarizeRun([step(1, "approve", "waiting", { step_kind: "approval" }), step(0, "trigger", "succeeded")]);
    expect(items.map((item) => item.symbol)).toEqual(["✓", "…"]);
  });

  it("splits reasons and times steps", () => {
    expect(splitReason("loop_limit: 60 items is more than 50.")).toEqual({ code: "loop_limit", text: "60 items is more than 50." });
    expect(splitReason("plain words")).toEqual({ code: null, text: "plain words" });
    expect(splitReason(null)).toEqual({ code: null, text: null });
    expect(durationMs("2026-01-01T00:00:00.000Z", "2026-01-01T00:00:01.250Z")).toBe(1250);
    expect(durationMs(null, "2026-01-01T00:00:00.000Z")).toBeNull();
    expect([canRetry("failed"), canRetry("waiting"), canRetry("running")]).toEqual([true, false, false]);
  });
});
