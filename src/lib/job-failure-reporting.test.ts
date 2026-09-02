import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { recordJobRun } from "@/lib/job-observability";

/**
 * A background job has no user watching it fail.
 *
 * The execution ledger already made failures durable, which makes them
 * discoverable once somebody thinks to look. These tests pin the other half:
 * that something actually raises its hand, so that a sync breaking overnight
 * does not wait on an administrator's curiosity.
 *
 * They assert against `reportError`'s console output rather than the network,
 * because reporting must work whether or not a monitoring DSN is configured —
 * and in this environment none is.
 */

function fakeClient(insertResult: { error: { message: string } | null }) {
  return {
    from: () => ({ insert: async () => insertResult }),
  } as unknown as Parameters<typeof recordJobRun>[0];
}

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** The [qbbe] prefix is what `reportError` emits; ledger noise uses other text. */
function reportedCalls() {
  return consoleError.mock.calls.filter((args) => args[0] === "[qbbe]");
}

describe("an integration failure reaches the error monitor", () => {
  it("reports when a handler records a failed run", async () => {
    await recordJobRun(fakeClient({ error: null }), {
      organizationId: "org-1",
      jobName: "google-sync",
      status: "failed",
      error: "Provider returned 503",
    });

    const reported = reportedCalls();
    expect(reported).toHaveLength(1);
    expect(reported[0][1]).toBe("Provider returned 503");
    expect(reported[0][2]).toMatchObject({
      source: "integration",
      jobName: "google-sync",
      organizationId: "org-1",
      ledgerWritten: true,
    });
  });

  it("stays silent on a successful run", async () => {
    await recordJobRun(fakeClient({ error: null }), {
      organizationId: "org-1",
      jobName: "google-sync",
      status: "succeeded",
    });

    expect(reportedCalls()).toHaveLength(0);
  });

  it("redacts credentials before they leave the process", async () => {
    // The monitor is a third party and is more exposed than the admin-visible
    // ledger, so it must not receive anything the ledger would have redacted.
    await recordJobRun(fakeClient({ error: null }), {
      organizationId: "org-1",
      jobName: "gmail-watch-renew",
      status: "failed",
      error: "refused: Bearer ya29.super-secret access_token=abc123",
    });

    const [, message] = reportedCalls()[0];
    expect(message).toBe("refused: Bearer [redacted] access_token=[redacted]");
    expect(message).not.toContain("ya29.super-secret");
    expect(message).not.toContain("abc123");
  });

  it("still reports when the ledger write itself fails", async () => {
    // A run whose failure could not even be recorded is the one most worth
    // hearing about, so the alert must not depend on the insert succeeding.
    await recordJobRun(fakeClient({ error: { message: "connection reset" } }), {
      organizationId: "org-1",
      jobName: "vms-sync",
      status: "failed",
      error: "upstream timeout",
    });

    const reported = reportedCalls();
    expect(reported).toHaveLength(1);
    expect(reported[0][2]).toMatchObject({ ledgerWritten: false });
  });

  it("falls back to the job name when a failure carries no message", async () => {
    await recordJobRun(fakeClient({ error: null }), {
      organizationId: "org-1",
      jobName: "vms-sync",
      status: "failed",
    });

    expect(reportedCalls()[0][1]).toBe("vms-sync failed");
  });
});
