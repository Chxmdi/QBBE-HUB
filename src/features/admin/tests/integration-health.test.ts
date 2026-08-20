import { describe, expect, it } from "vitest";
import { classifyIntegrationFailure, integrationHealthLabel, integrationHealthTone } from "@/features/admin/services/integration-health";

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
});
