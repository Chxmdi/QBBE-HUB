import { describe, expect, it } from "vitest";
import { createMilestoneSchema } from "@/features/projects/schemas";

describe("createMilestoneSchema", () => {
  it("rejects an empty name", () => {
    const parsed = createMilestoneSchema.safeParse({
      projectId: "11111111-1111-1111-1111-111111111111",
      name: "  ",
    });
    expect(parsed.success).toBe(false);
  });

  it("accepts a named milestone", () => {
    const parsed = createMilestoneSchema.safeParse({
      projectId: "11111111-1111-1111-1111-111111111111",
      name: "Kickoff",
      dueDate: "2026-09-01",
    });
    expect(parsed.success).toBe(true);
  });
});
