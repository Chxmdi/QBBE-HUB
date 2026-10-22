import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  serviceClient: vi.fn(),
  handler: vi.fn(),
}));

vi.mock("@/lib/supabase/service", () => ({
  createSupabaseServiceClient: mocks.serviceClient,
}));
vi.mock("./handlers", () => ({
  JOB_HANDLERS: { "scan-documents": mocks.handler, "apply-retention": mocks.handler },
}));
vi.mock("@/lib/observability", () => ({ reportError: vi.fn() }));

import { DisabledJobError, runJob } from "./runner";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});

describe("runner host activation boundary", () => {
  it.each(["", " ", "scan-documents", "*"])(
    "rejects retention before database access with allowlist %j",
    async (allowlist) => {
      vi.stubEnv("JOB_RUNNER_ALLOWLIST", allowlist);
      await expect(runJob("apply-retention")).rejects.toBeInstanceOf(DisabledJobError);
      expect(mocks.serviceClient).not.toHaveBeenCalled();
      expect(mocks.handler).not.toHaveBeenCalled();
    },
  );

  it("still requires database approval for a host-allowed job", async () => {
    vi.stubEnv("JOB_RUNNER_ALLOWLIST", "scan-documents");
    const query = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: { name: "scan-documents", enabled: false }, error: null,
      }),
    };
    const from = vi.fn().mockReturnValue(query);
    mocks.serviceClient.mockReturnValue({ from });
    await expect(runJob("scan-documents")).rejects.toBeInstanceOf(DisabledJobError);
    expect(from.mock.calls).toEqual([["job_definition"]]);
    expect(mocks.handler).not.toHaveBeenCalled();
  });
});
