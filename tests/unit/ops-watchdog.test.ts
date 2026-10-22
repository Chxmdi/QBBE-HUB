import { describe, expect, it } from "vitest";
import { opsAlerts, opsWatchdog, type OpsSnapshot } from "@/features/jobs/services/handlers/ops-watchdog";
import type { JobContext } from "@/features/jobs/services/runner";

const NOW = new Date("2026-11-20T12:00:00Z");
const MB = 1024 * 1024;
const ago = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000).toISOString();

const healthy: OpsSnapshot = {
  database_bytes: 100 * MB,
  jobs: [
    { name: "drain-notifications", schedule: "* * * * *", enabled: true, last_started_at: ago(1), failures_in_a_row: 0 },
    { name: "apply-retention", schedule: "40 2 * * *", enabled: true, last_started_at: ago(600), failures_in_a_row: 0 },
  ],
  refusals: [{ bucket: "webhook-refused:zeffy_webhook:signature_invalid", count: 2 }],
};

describe("ops alert rules", () => {
  it("raises nothing when everything is healthy", () => {
    expect(opsAlerts(healthy, [{ queue_name: "notifications", oldest_message_age_seconds: 30 }], NOW)).toEqual([]);
  });

  it("raises one alert per condition", () => {
    const alerts = opsAlerts(
      {
        database_bytes: 360 * MB,
        jobs: [
          { name: "drain-notifications", schedule: "* * * * *", enabled: true, last_started_at: ago(4), failures_in_a_row: 0 },
          { name: "scan-documents", schedule: "* * * * *", enabled: true, last_started_at: ago(1), failures_in_a_row: 3 },
          { name: "vms-sync", schedule: "0 8 * * *", enabled: false, last_started_at: ago(60 * 24 * 10), failures_in_a_row: 9 },
        ],
        refusals: [
          { bucket: "webhook-refused:zeffy_webhook:signature_invalid", count: 7 },
          { bucket: "webhook-refused:zeffy_webhook:signature_invalid", count: 4 },
          { bucket: "webhook-refused:gmail_push:bad_request", count: 50 },
        ],
      },
      [{ queue_name: "notifications", oldest_message_age_seconds: 16 * 60 }],
      NOW,
    );
    expect(alerts.map((a) => a.key)).toEqual([
      "overdue:drain-notifications",
      "failing:scan-documents",
      "queue:notifications",
      "database",
      "refusals:zeffy_webhook",
    ]);
    expect(alerts.find((a) => a.kind === "database")).toMatchObject({ percent: 72, limitMb: 500 });
  });
});

/** Just enough of the client for the handler: two RPCs, owners, notifications. */
function fakeDb(snapshot: OpsSnapshot) {
  const notifications: Record<string, unknown>[] = [];
  const chain = (rows: () => unknown[]) => {
    const q: Record<string, unknown> = {};
    for (const m of ["select", "eq", "in", "order", "limit"]) q[m] = () => q;
    q.then = (resolve: (v: unknown) => void) => resolve({ data: rows(), error: null });
    return q;
  };
  const db = {
    rpc: async (name: string) => ({ data: name === "ops_health_snapshot" ? snapshot : [], error: null }),
    from: (table: string) => {
      if (table === "organization_membership") {
        return chain(() => [{ user_id: "u1", organization_id: "o1", user: { locale: "fr-CA" } }]);
      }
      const q = chain(() => notifications) as Record<string, unknown>;
      q.insert = async (rows: Record<string, unknown>[]) => {
        for (const row of rows) {
          if (!notifications.some((n) => n.dedupe_key === row.dedupe_key)) notifications.push(row);
        }
        return { data: null, error: null };
      };
      q.upsert = q.insert;
      q.update = () => q;
      return q;
    },
  };
  return { db, notifications };
}

describe("ops-watchdog job", () => {
  it("notifies owners in their language, once per condition per day", async () => {
    const { db, notifications } = fakeDb({ ...healthy, jobs: [healthy.jobs[1]], database_bytes: 400 * MB });
    const context = { db, now: NOW, definition: {} } as unknown as JobContext;
    await opsWatchdog(context);
    await opsWatchdog({ ...context, now: new Date(NOW.getTime() + 15 * 60_000) });
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({ category: "system", urgency: "high", link: "/admin/jobs", user_id: "u1" });
    expect(String(notifications[0].title)).toContain("80 %");
  });

  it("writes nothing when healthy", async () => {
    const { db, notifications } = fakeDb(healthy);
    const result = await opsWatchdog({ db, now: NOW, definition: {} } as unknown as JobContext);
    expect(result.processed).toBe(0);
    expect(notifications).toHaveLength(0);
  });
});
