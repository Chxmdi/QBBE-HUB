import { describe, expect, it } from "vitest";
import { announcementReminderKey, reminderNotification, utcDay } from "@/features/notifications/services/reminders";

describe("scheduled reminder helpers", () => {
  it("uses stable UTC date keys for same-day reminders", () => {
    expect(utcDay(new Date("2026-08-18T23:30:00-04:00"))).toBe("2026-08-19");
    expect(announcementReminderKey("announcement-1", "user-1", "2026-08-19"))
      .toBe("reminder:announcement:announcement-1:user-1:2026-08-19");
  });

  it("makes overdue reminders daily but due-today reminders once per due date", () => {
    const record = { id: "task-1", title: "Prepare agenda", dueAt: "2026-08-18", ownerId: "user-1", organizationId: "org-1", priority: "medium" };
    expect(reminderNotification({ kind: "task", record, today: "2026-08-18" })).toMatchObject({
      title: "Due today: Prepare agenda", dedupe_key: "reminder:task:due:task-1:2026-08-18", urgency: "normal",
    });
    expect(reminderNotification({ kind: "task", record, today: "2026-08-19" })).toMatchObject({
      title: "Overdue: Prepare agenda", dedupe_key: "reminder:task:overdue:task-1:2026-08-19", urgency: "high",
    });
  });
});
