import { describe, expect, it } from "vitest";
import { nextOccurrence } from "@/features/tasks/recurrence";
import { createMilestoneSchema } from "@/features/projects/schemas";

describe("nextOccurrence", () => {
  it("advances weekly and monthly from an ISO date", () => {
    expect(nextOccurrence("weekly", "2026-08-14")).toBe("2026-08-21");
    expect(nextOccurrence("monthly", "2026-01-15")).toBe("2026-02-15");
  });
});

describe("createMilestoneSchema extra", () => {
  it("requires a project id", () => {
    expect(createMilestoneSchema.safeParse({ name: "X" }).success).toBe(false);
  });
});
