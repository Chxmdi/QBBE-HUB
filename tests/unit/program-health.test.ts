import { expect, it } from "vitest";
import { summarizeProjectHealth } from "@/features/dashboard/health";

it("preserves manual health independently of completion", () => {
  expect(summarizeProjectHealth([{ health: "on_track", stage: "active", archived_at: null }]).statusLabel).toBe("On track");
  expect(summarizeProjectHealth([{ health: "unknown", stage: "active", archived_at: null }]).statusLabel).toBe("Not assessed");
});
it("uses worst open-project health and excludes completed work", () => {
  expect(summarizeProjectHealth([
    { health: "off_track", stage: "completed", archived_at: null },
    { health: "at_risk", stage: "active", archived_at: null },
  ]).statusLabel).toBe("At risk");
  expect(summarizeProjectHealth([]).statusLabel).toBe("No projects");
});
