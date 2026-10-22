import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Each release gets its own deployment id, so a tab opened before a release
 * is told to reload instead of calling server actions the new build no longer
 * has (useServerAction shows the message and reloads).
 */
describe("next.config deploymentId", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("is the commit being built", async () => {
    vi.stubEnv("APP_COMMIT", "0123456789abcdef0123456789abcdef01234567");
    const { default: config } = await import("../../next.config");
    expect(config.deploymentId).toBe("0123456789abcdef0123456789abcdef01234567");
  });

  it("is left unset for local and CI builds that name no commit", async () => {
    vi.stubEnv("APP_COMMIT", "unknown");
    const { default: config } = await import("../../next.config");
    expect(config.deploymentId).toBeUndefined();
  });
});
