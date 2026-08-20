import { describe, expect, it } from "vitest";
import { cronAuthorized, secretsMatch } from "@/lib/cron-auth";

describe("secretsMatch", () => {
  it("accepts equal secrets and rejects different ones", () => {
    expect(secretsMatch("alpha-secret", "alpha-secret")).toBe(true);
    expect(secretsMatch("alpha-secret", "other-secret")).toBe(false);
    expect(secretsMatch("short", "longer-value")).toBe(false);
  });
});

describe("cronAuthorized", () => {
  it("requires a configured secret and matching bearer token", () => {
    const previousJob = process.env.CRON_JOB_SECRET;
    const previousCron = process.env.CRON_SECRET;
    process.env.CRON_JOB_SECRET = "job-secret-value";
    delete process.env.CRON_SECRET;
    try {
      expect(
        cronAuthorized(new Request("http://localhost/api/jobs/x", { headers: { authorization: "Bearer job-secret-value" } })),
      ).toBe(true);
      expect(
        cronAuthorized(new Request("http://localhost/api/jobs/x", { headers: { authorization: "Bearer wrong" } })),
      ).toBe(false);
      expect(cronAuthorized(new Request("http://localhost/api/jobs/x"))).toBe(false);
    } finally {
      if (previousJob === undefined) delete process.env.CRON_JOB_SECRET;
      else process.env.CRON_JOB_SECRET = previousJob;
      if (previousCron === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = previousCron;
    }
  });
});
