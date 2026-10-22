import { describe, expect, it } from "vitest";
import { nextOccurrence } from "@/features/tasks/recurrence";
import { createMilestoneSchema } from "@/features/projects/schemas";

describe("nextOccurrence", () => {
  it("advances weekly and monthly from an ISO date", () => {
    expect(nextOccurrence("weekly", "2026-08-14")).toBe("2026-08-21");
    expect(nextOccurrence("monthly", "2026-01-15")).toBe("2026-02-15");
  });

  it("lands a month-end task on the last day of a shorter month, not in the next one", () => {
    expect(nextOccurrence("monthly", "2026-01-31")).toBe("2026-02-28");
    expect(nextOccurrence("monthly", "2028-01-31")).toBe("2028-02-29");
    expect(nextOccurrence("monthly", "2026-03-31")).toBe("2026-04-30");
    expect(nextOccurrence("monthly", "2026-12-31")).toBe("2027-01-31");
  });

  it("keeps a chain on its original day after a short month", () => {
    // Each successor is computed from the one before; the anchor carries the 31st.
    const chain: string[] = [];
    let due = "2026-01-31";
    for (let i = 0; i < 4; i += 1) {
      due = nextOccurrence("monthly", due, "2026-01-31");
      chain.push(due);
    }
    expect(chain).toEqual(["2026-02-28", "2026-03-31", "2026-04-30", "2026-05-31"]);
    expect(nextOccurrence("monthly", "2026-02-28", "2026-01-30")).toBe("2026-03-30");
  });

  it("is unchanged for weekly repeats and an unknown rule", () => {
    expect(nextOccurrence("weekly", "2026-02-28", "2026-01-31")).toBe("2026-03-07");
    expect(nextOccurrence("never", "2026-02-28")).toBe("2026-02-28");
  });
});

describe("createMilestoneSchema extra", () => {
  it("requires a project id", () => {
    expect(createMilestoneSchema.safeParse({ name: "X" }).success).toBe(false);
  });
});
