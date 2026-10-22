import { afterEach, describe, expect, it, vi } from "vitest";

const reportError = vi.hoisted(() => vi.fn());
vi.mock("@/lib/observability", () => ({ reportError }));
const { onRequestError, register } = await import("@/instrumentation");

describe("instrumentation", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    reportError.mockClear();
  });

  it("sends every server-side request error to monitoring, without the query string", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    const error = Object.assign(new Error("boom"), { digest: "123" });
    await onRequestError(
      error,
      { path: "/invite?token=abc", method: "GET", headers: { "x-request-id": "req-12345678" } },
      {
        routerKind: "App Router",
        routePath: "/invite",
        routeType: "render",
        renderSource: "react-server-components-payload",
        revalidateReason: undefined,
      },
    );
    expect(reportError).toHaveBeenCalledWith(
      error,
      expect.objectContaining({ path: "/invite", digest: "123", requestId: "req-12345678" }),
    );
  });

  it("refuses to start a deployed server with missing settings", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("QBBE_ENV", "staging");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await register();
    expect(exit).toHaveBeenCalledWith(1);
    expect(log.mock.calls[0][0]).toContain("SUPABASE_SERVICE_ROLE_KEY is not set.");
  });

  it("starts without checks when not deployed", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("QBBE_ENV", "");
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    await register();
    expect(exit).not.toHaveBeenCalled();
  });
});
