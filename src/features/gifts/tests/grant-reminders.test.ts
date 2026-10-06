import { describe, expect, it } from "vitest";
import { reminderFor } from "@/features/jobs/services/handlers/grant-report-reminders";

const now = new Date("2026-10-10T16:00:00Z");
const today = "2026-10-10";
const fresh = { last_reminder_kind: null, last_reminded_at: null };

describe("grant report reminders", () => {
  it("stays quiet until the report is within 14 days", () => {
    expect(reminderFor({ ...fresh, due_on: "2026-10-25" }, today, now)).toBeNull();
    expect(reminderFor({ ...fresh, due_on: "2026-10-24" }, today, now)).toBe("upcoming");
  });

  it("sends the upcoming reminder once, even if a day was missed", () => {
    expect(reminderFor({ ...fresh, due_on: "2026-10-12" }, today, now)).toBe("upcoming");
    expect(
      reminderFor({ due_on: "2026-10-12", last_reminder_kind: "upcoming", last_reminded_at: "2026-10-01T12:00:00Z" }, today, now),
    ).toBeNull();
  });

  it("reminds on the due date once", () => {
    expect(
      reminderFor({ due_on: today, last_reminder_kind: "upcoming", last_reminded_at: "2026-10-01T12:00:00Z" }, today, now),
    ).toBe("due");
    expect(
      reminderFor({ due_on: today, last_reminder_kind: "due", last_reminded_at: "2026-10-10T12:00:00Z" }, today, now),
    ).toBeNull();
  });

  it("repeats weekly while overdue", () => {
    expect(
      reminderFor({ due_on: "2026-10-09", last_reminder_kind: "due", last_reminded_at: "2026-10-09T12:00:00Z" }, today, now),
    ).toBe("overdue");
    expect(
      reminderFor({ due_on: "2026-10-01", last_reminder_kind: "overdue", last_reminded_at: "2026-10-07T12:00:00Z" }, today, now),
    ).toBeNull();
    expect(
      reminderFor({ due_on: "2026-09-20", last_reminder_kind: "overdue", last_reminded_at: "2026-10-03T12:00:00Z" }, today, now),
    ).toBe("overdue");
  });
});
