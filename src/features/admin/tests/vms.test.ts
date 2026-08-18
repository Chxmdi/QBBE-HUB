import { describe, expect, it } from "vitest";
import { mapVmsIdentities, mapVmsIdentity, vmsDisconnectEffect } from "@/features/admin/services/vms";
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

  it("disconnect drops VMS fields only", () => {
    expect(vmsDisconnectEffect()).toEqual({
      dropsVmsFields: true,
      deletesHubTasks: false,
    });
  });
});
