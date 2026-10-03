import { describe, expect, it } from "vitest";
import { optionalDay } from "@/lib/schema";
import { createTaskSchema, updateTaskSchema } from "@/features/tasks/schemas";
import { createMilestoneSchema, updateMilestoneSchema } from "@/features/projects/schemas";
import {
  createDecisionRequestSchema,
  createIssueSchema,
  createRiskSchema,
  updateIssueSchema,
  updateRiskSchema,
} from "@/features/risks/schemas";
import { createProjectRequestSchema, requestApprovalSchema } from "@/features/requests/schemas";
import { createMetricSchema, recordMeasurementSchema } from "@/features/outcomes/schemas";

/**
 * Dates that are not days (31 February, month 13) used to reach Postgres and
 * come back as an unrelated message — "you don't have permission", "could not
 * save". Every date a person types is now checked before it is saved.
 */

const id = "00000000-0000-4000-8000-000000000001";
const NOT_DAYS = ["2026-02-31", "2026-13-01", "2026-00-10", "2026-2-3", "tomorrow", "2026-04-31"];

describe("optionalDay", () => {
  const day = optionalDay().nullable().optional();

  it("accepts a real day, a blank, null and nothing", () => {
    for (const value of ["2026-10-03", "2028-02-29", "", "  ", null, undefined]) {
      expect(day.safeParse(value).success, String(value)).toBe(true);
    }
  });

  it("refuses dates that are not days", () => {
    for (const value of [...NOT_DAYS, "2027-02-29"]) {
      expect(day.safeParse(value).success, value).toBe(false);
    }
  });

  it("says what is wrong", () => {
    const result = optionalDay().safeParse("2026-02-31");
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe("Enter the date as YYYY-MM-DD.");
  });
});

describe("every date field in these forms refuses a date that is not a day", () => {
  const cases: [string, (date: string) => { success: boolean }][] = [
    ["new task due date", (d) => createTaskSchema.safeParse({ title: "T", dueAt: d })],
    ["task due date change", (d) => updateTaskSchema.safeParse({ taskId: id, dueAt: d })],
    ["new milestone due date", (d) => createMilestoneSchema.safeParse({ projectId: id, name: "M", dueDate: d })],
    ["milestone due date change", (d) => updateMilestoneSchema.safeParse({ milestoneId: id, dueDate: d })],
    ["new risk review date", (d) => createRiskSchema.safeParse({ projectId: id, title: "R", reviewAt: d })],
    ["risk review date change", (d) => updateRiskSchema.safeParse({ riskId: id, reviewAt: d })],
    ["new issue due date", (d) => createIssueSchema.safeParse({ projectId: id, title: "I", dueAt: d })],
    ["issue due date change", (d) => updateIssueSchema.safeParse({ issueId: id, dueAt: d })],
    [
      "decision request due date",
      (d) => createDecisionRequestSchema.safeParse({ projectId: id, assigneeId: id, dueAt: d, context: "C" }),
    ],
    ["project request needed-by date", (d) => createProjectRequestSchema.safeParse({ title: "P", summary: "S", neededBy: d })],
    ["approval due date", (d) => requestApprovalSchema.safeParse({ approverId: id, projectRequestId: id, dueAt: d })],
    [
      "metric target date",
      (d) => createMetricSchema.safeParse({ programId: id, name: "N", baseline: 1, target: 2, targetOn: d }),
    ],
    ["measurement date", (d) => recordMeasurementSchema.safeParse({ metricId: id, measuredOn: d, value: 3 })],
  ];

  for (const [name, parse] of cases) {
    it(name, () => {
      expect(parse("2026-10-15").success, `${name} with a real day`).toBe(true);
      for (const value of NOT_DAYS) {
        expect(parse(value).success, `${name} with ${value}`).toBe(false);
      }
    });
  }
});
