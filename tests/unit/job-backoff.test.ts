import { describe, expect, it } from "vitest";
import { backoffSeconds } from "@/features/jobs/services/queue";

// #111: the retry delay every redelivered job message waits. Exhaustion
// itself ("gives up visibly once the attempts are spent") is covered per
// handler in job-handlers, drain-notifications and gmail-push-sync.
describe("job retry backoff", () => {
  it("doubles from 30 seconds", () => {
    expect([1, 2, 3, 4, 5].map(backoffSeconds)).toEqual([30, 60, 120, 240, 480]);
  });

  it("treats a first delivery the same as the first retry", () => {
    expect(backoffSeconds(0)).toBe(30);
  });

  it("is capped at fifteen minutes however many times a message has failed", () => {
    expect(backoffSeconds(6)).toBe(900);
    expect(backoffSeconds(50)).toBe(900);
  });

  it("spends the default five attempts within an hour, so a poisoned message dead-letters promptly", () => {
    const total = [1, 2, 3, 4, 5].reduce((sum, attempt) => sum + backoffSeconds(attempt), 0);
    expect(total).toBeLessThan(3600);
  });
});
