import { afterEach, describe, expect, it, vi } from "vitest";
import { vmsSync } from "@/features/jobs/services/handlers/vms-sync";
import type { JobDefinition } from "@/features/jobs/services/runner";
import { FakeSupabase, asClient } from "../support/fake-supabase";

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.VMS_API_URL;
  delete process.env.VMS_API_KEY;
});

const ORG = "org-1";
const USER = "user-1";
const CONNECTION = "vms-connection-1";

function definition(): JobDefinition {
  return {
    name: "vms-sync",
    description: "test",
    schedule: "0 8 * * *",
    queue: "integrations",
    enabled: true,
    batch_size: 50,
    max_attempts: 3,
  };
}

function seed(db: FakeSupabase) {
  db.seed("integration_connection", [{
    id: CONNECTION,
    organization_id: ORG,
    user_id: null,
    provider: "volunteer_system",
    status: "connected",
  }]);
  db.seed("organization_membership", [{
    id: "membership-1",
    organization_id: ORG,
    user_id: USER,
    role: "volunteer",
    status: "active",
  }]);
  db.seed("user_profile", [{
    id: USER,
    vms_id: "vms-42",
    vms_availability: "unknown",
    vms_synced_at: null,
  }]);
  db.seed("vms_assignment_reference", [{
    id: "old-ref",
    organization_id: ORG,
    user_id: USER,
    external_assignment_id: "old-assignment",
    title: "Old shift",
    status: "assigned",
  }]);
  db.seed("background_job_run", []);
}

describe("vms-sync", () => {
  it("syncs linked identity availability and minimal assignment references", async () => {
    process.env.VMS_API_URL = "https://vms.example/api/snapshot";
    const db = new FakeSupabase(new Date("2026-09-24T06:00:00Z"));
    seed(db);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      volunteers: [{
        id: "vms-42",
        display_name: "QA Volunteer",
        availability: "available",
      }],
      assignments: [{
        id: "assignment-1",
        volunteer_id: "vms-42",
        title: "Saturday workshop",
        status: "accepted",
        starts_at: "2026-10-03T13:00:00Z",
        ends_at: "2026-10-03T17:00:00Z",
        url: "https://vms.example/assignments/assignment-1",
      }],
    }), { status: 200 })));

    const result = await vmsSync({
      db: asClient(db),
      definition: definition(),
      now: db.now(),
    });

    expect(result.processed).toBe(1);
    expect(result.failed).toBe(0);
    expect(db.rows("user_profile")[0]).toMatchObject({
      vms_id: "vms-42",
      vms_availability: "available",
      vms_synced_at: "2026-09-24T06:00:00.000Z",
    });
    expect(db.rows("vms_assignment_reference")).toEqual([
      expect.objectContaining({
        organization_id: ORG,
        user_id: USER,
        external_assignment_id: "assignment-1",
        title: "Saturday workshop",
        status: "confirmed",
      }),
    ]);
    expect(db.rows("integration_connection")[0]).toMatchObject({
      status: "connected",
      last_error: null,
      last_sync_at: "2026-09-24T06:00:00.000Z",
    });
  });

  it("does not erase assignments when the provider sends only identities", async () => {
    process.env.VMS_API_URL = "https://vms.example/api/snapshot";
    const db = new FakeSupabase(new Date("2026-09-24T06:00:00Z"));
    seed(db);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      volunteers: [{ id: "vms-42", display_name: "QA Volunteer", availability: "unavailable" }],
    }), { status: 200 })));

    await vmsSync({ db: asClient(db), definition: definition(), now: db.now() });

    expect(db.rows("vms_assignment_reference")).toHaveLength(1);
    expect(db.rows("vms_assignment_reference")[0].external_assignment_id).toBe("old-assignment");
  });

  it("surfaces malformed provider data as a degraded integration", async () => {
    process.env.VMS_API_URL = "https://vms.example/api/snapshot";
    const db = new FakeSupabase(new Date("2026-09-24T06:00:00Z"));
    seed(db);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ unexpected: true }), { status: 200 }),
    ));

    const result = await vmsSync({
      db: asClient(db),
      definition: definition(),
      now: db.now(),
    });

    expect(result.failed).toBe(1);
    expect(db.rows("integration_connection")[0]).toMatchObject({
      status: "degraded",
      last_error: "Unexpected VMS provider response shape.",
    });
  });
});
