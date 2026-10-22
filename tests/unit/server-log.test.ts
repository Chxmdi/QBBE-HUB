import { afterEach, describe, expect, it, vi } from "vitest";

const forwardToMonitoring = vi.hoisted(() => vi.fn());
vi.mock("@/lib/observability", () => ({ forwardToMonitoring }));
const { logActionFailure, logEvent, redact, requestIdOf } = await import("@/lib/server-log");

function lines(spy: { mock: { calls: unknown[][] } }) {
  return spy.mock.calls.map((call) => JSON.parse(String(call[0])) as Record<string, unknown>);
}

describe("server log", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    forwardToMonitoring.mockClear();
  });

  it("writes one JSON line per action failure with the action, Postgres code and request id", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    logActionFailure("task.update", { code: "42501", message: "new row violates row-level security policy for table \"task\"" }, {
      requestId: "req-12345678",
      orgId: "org-1",
    });
    const [line] = lines(error);
    expect(error).toHaveBeenCalledTimes(1);
    expect(line).toMatchObject({ level: "error", event: "action.failed", action: "task.update", code: "42501", requestId: "req-12345678" });
    expect(forwardToMonitoring).toHaveBeenCalledTimes(1);
  });

  it("never writes tokens, secrets or e-mail addresses", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    logEvent("probe", {
      authorization: "Bearer abc.def",
      emailAddress: "a@b.org",
      jobSecret: "s3cret",
      detail: "failed for jane.doe@example.org with Bearer eyJabc.def and /invite?token=zzz",
    });
    const text = String(info.mock.calls[0][0]);
    for (const leaked of ["abc.def", "a@b.org", "s3cret", "jane.doe@example.org", "eyJabc", "zzz"]) {
      expect(text).not.toContain(leaked);
    }
    expect(text).not.toMatch(/"(authorization|emailAddress|jobSecret)"/);
  });

  it("redacts free text and reads the request id from headers", () => {
    expect(redact("x@y.ca Bearer t0k")).toBe("[email] Bearer [redacted]");
    expect(requestIdOf(new Headers({ "x-request-id": "abc" }))).toBe("abc");
    expect(requestIdOf(new Request("https://h.example", { headers: { "x-request-id": "def" } }))).toBe("def");
  });
});
