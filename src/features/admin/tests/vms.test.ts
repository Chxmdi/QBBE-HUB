import { describe, expect, it } from "vitest";
import { mapVmsAssignment, mapVmsAssignments, mapVmsIdentities, mapVmsIdentity, mapVmsSnapshot, vmsDisconnectEffect } from "@/features/admin/services/vms";
import fixture from "@/features/admin/tests/vms-identity.fixture.json";

describe("VMS contract", () => {
  it("maps a recorded identity fixture", () => {
    const mapped = mapVmsIdentity(fixture as Record<string, unknown>);
    expect(mapped).toEqual({
      vmsId: "vms-42",
      displayName: "QA Volunteer",
      availability: "available",
    });
  });

  it("rejects incomplete payloads", () => {
    expect(mapVmsIdentity({ name: "No id" })).toBeNull();
  });

  it("maps a VMS list envelope and deduplicates external identities", () => {
    expect(mapVmsIdentities({ volunteers: [fixture, fixture, { id: "vms-7", name: "Unavailable", availability: "unavailable" }] })).toEqual([
      { vmsId: "vms-42", displayName: "QA Volunteer", availability: "available" },
      { vmsId: "vms-7", displayName: "Unavailable", availability: "unavailable" },
    ]);
  });

  it("maps assignment references without turning them into Hub work records", () => {
    expect(mapVmsAssignment({
      assignment_id: "shift-9",
      volunteer_id: "vms-42",
      title: "Saturday workshop",
      status: "accepted",
      starts_at: "2026-10-03T13:00:00Z",
      ends_at: "2026-10-03T17:00:00Z",
      url: "https://vms.example/assignments/shift-9",
    })).toEqual({
      assignmentId: "shift-9",
      vmsId: "vms-42",
      title: "Saturday workshop",
      status: "confirmed",
      startsAt: "2026-10-03T13:00:00.000Z",
      endsAt: "2026-10-03T17:00:00.000Z",
      sourceUrl: "https://vms.example/assignments/shift-9",
      updatedAt: null,
    });
  });

  it("deduplicates assignment ids and rejects incomplete assignment rows", () => {
    expect(mapVmsAssignments({
      assignments: [
        { id: "a1", volunteer_id: "v1", title: "One", status: "scheduled" },
        { id: "a1", volunteer_id: "v1", title: "Duplicate", status: "done" },
        { id: "missing-volunteer", title: "Invalid" },
      ],
    })).toHaveLength(1);
  });

  it("distinguishes identity-only responses from authoritative assignment snapshots", () => {
    expect(mapVmsSnapshot({ volunteers: [fixture] })).toMatchObject({
      recognized: true,
      assignmentsProvided: false,
      assignments: [],
    });
    expect(mapVmsSnapshot({ volunteers: [fixture], assignments: [] })).toMatchObject({
      recognized: true,
      assignmentsProvided: true,
      assignments: [],
    });
    expect(mapVmsSnapshot({ unexpected: true }).recognized).toBe(false);
  });

  it("disconnect drops VMS fields only", () => {
    expect(vmsDisconnectEffect()).toEqual({
      dropsVmsFields: true,
      deletesHubTasks: false,
    });
  });
});
