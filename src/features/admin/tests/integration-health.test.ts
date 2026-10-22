import { describe, expect, it } from "vitest";
import { classifyIntegrationFailure, effectiveIntegrationStatus, integrationHealthLabel, integrationHealthTone } from "@/features/admin/services/integration-health";

describe("integration health", () => {
  it.each([
    ["Gmail list failed (401).", "authentication_expired"],
    ["VMS_API_URL is not configured.", "configuration_required"],
    ["VMS responded 503.", "synchronization_delayed"],
    ["Unexpected provider response shape.", "degraded"],
  ] as const)("classifies %s", (message, expected) => {
    expect(classifyIntegrationFailure(message)).toBe(expected);
  });

  it("renders clear status labels and tones", () => {
    expect(integrationHealthLabel("authentication_expired")).toBe("Authentication expired");
    expect(integrationHealthTone("authentication_expired")).toBe("danger");
    expect(integrationHealthLabel("error")).toBe("Degraded");
  });

  it("reads a connected integration as delayed after three missed sync intervals", () => {
    const now = new Date("2026-11-20T12:00:00Z");
    const ago = (minutes: number) => new Date(now.getTime() - minutes * 60_000).toISOString();
    expect(effectiveIntegrationStatus("zeffy", "connected", ago(44), now)).toBe("connected");
    expect(effectiveIntegrationStatus("zeffy", "connected", ago(46), now)).toBe("synchronization_delayed");
    expect(effectiveIntegrationStatus("volunteer_system", "connected", ago(60 * 24 * 2), now)).toBe("connected");
    expect(effectiveIntegrationStatus("gmail", "connected", null, now)).toBe("connected");
    expect(effectiveIntegrationStatus("gmail", "authentication_expired", ago(999), now)).toBe("authentication_expired");
    expect(effectiveIntegrationStatus("email", "connected", ago(9999), now)).toBe("connected");
  });
});
