import { describe, expect, it } from "vitest";
import { isCalendarDate } from "@/lib/schema";
import { dateParam } from "@/features/ledger/services/ledger.access";
import { isValidValue } from "@/features/offline/op-log";
import { rescheduleSchema, taskSeriesSchema } from "@/features/tasks/schemas";
import { classifyDocumentSchema } from "@/features/record-retention/schemas";
import { portfolioFilterSchema } from "@/features/dashboard/portfolio";
import { isCalendarDate as templateIsCalendarDate } from "@/features/templates-v2/template";

/**
 * Dates that match YYYY-MM-DD but are not days. `Date.parse` rolls each of
 * them over to a real day, so a pattern or a `Date.parse` check let them
 * through and Postgres refused them: a finance export answered 500 and a form
 * failed with a generic message.
 */
const IMPOSSIBLE = ["2026-02-29", "2026-02-30", "2026-02-31", "2026-04-31", "2026-06-31", "2026-09-31", "2026-11-31", "2100-02-29"];
const MALFORMED = ["2026-13-01", "2026-00-10", "2026-01-00", "2026-01-32", "0000-01-01", "26-01-01", "2026-1-1", "2026/01/01", "2026-01-01T00:00", " 2026-01-01", ""];
const REAL = ["2026-01-01", "2026-02-28", "2028-02-29", "2000-02-29", "2026-04-30", "2026-12-31", "1999-12-31"];

describe("isCalendarDate", () => {
  it("accepts real days, leap days included", () => {
    for (const day of REAL) expect(isCalendarDate(day), day).toBe(true);
  });

  it("refuses days that do not exist and anything not shaped YYYY-MM-DD", () => {
    for (const day of [...IMPOSSIBLE, ...MALFORMED]) expect(isCalendarDate(day), day).toBe(false);
  });

  it("is the same rule the templates use", () => {
    expect(templateIsCalendarDate).toBe(isCalendarDate);
  });
});

describe("dates that arrive in links and requests", () => {
  it("a finance report's date falls back to the default when it is not a real day", () => {
    for (const day of IMPOSSIBLE) expect(dateParam(day, "2026-03-31"), day).toBe("2026-03-31");
    expect(dateParam("2026-02-28", "2026-03-31")).toBe("2026-02-28");
    expect(dateParam(undefined, "2026-03-31")).toBe("2026-03-31");
  });

  it("an offline due date is only kept when it is a real day", () => {
    expect(isValidValue("due_at", "2026-02-31")).toBe(false);
    expect(isValidValue("start_at", "2026-04-31")).toBe(false);
    expect(isValidValue("due_at", "2026-02-28")).toBe(true);
    expect(isValidValue("due_at", null)).toBe(true);
  });

  it("schemas refuse an impossible day with their own sentence", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    const reschedule = rescheduleSchema.safeParse({ kind: "task", id, date: "2026-02-31" });
    expect(reschedule.success).toBe(false);
    expect(reschedule.error?.issues[0].message).toBe("A reschedule needs a calendar date.");
    expect(rescheduleSchema.safeParse({ kind: "task", id, date: "2026-02-28" }).success).toBe(true);
    expect(rescheduleSchema.safeParse({ kind: "task", id, date: null }).success).toBe(true);

    const series = { title: "Weekly check", recurrenceRule: "weekly", ownerId: id };
    const badSeries = taskSeriesSchema.safeParse({ ...series, startsOn: "2026-04-31" });
    expect(badSeries.success).toBe(false);
    expect(badSeries.error?.issues.map((issue) => issue.message)).toEqual(["A recurring task needs a valid start date."]);
    expect(taskSeriesSchema.safeParse({ ...series, startsOn: "2026-04-30" }).success).toBe(true);

    const classify = classifyDocumentSchema.safeParse({ documentId: id, recordDate: "2026-06-31" });
    expect(classify.success).toBe(false);
    expect(classify.error?.issues[0].message).toBe("Enter the date as YYYY-MM-DD.");
    expect(classifyDocumentSchema.safeParse({ documentId: id, recordDate: "" }).success).toBe(true);

    expect(portfolioFilterSchema.safeParse({ from: "2026-02-30" }).success).toBe(false);
    expect(portfolioFilterSchema.safeParse({ from: "2026-02-28" }).success).toBe(true);
  });
});
