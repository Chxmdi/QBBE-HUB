export type DatedReminder = {
  id: string;
  title: string;
  dueAt: string;
  ownerId: string | null;
  organizationId: string;
  priority?: string | null;
};

export function utcDay(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function reminderNotification(input: {
  kind: "task" | "follow_up";
  record: DatedReminder;
  today: string;
}) {
  const overdue = input.record.dueAt < input.today;
  const label = input.kind === "task" ? "Task" : "CRM follow-up";
  return {
    user_id: input.record.ownerId,
    organization_id: input.record.organizationId,
    category: "due_date",
    title: `${overdue ? "Overdue" : "Due today"}: ${input.record.title}`,
    body: overdue
      ? `${label} was due ${input.record.dueAt}.`
      : `${label} is due today.`,
    source_type: input.kind === "task" ? "task" : "crm_follow_up",
    source_id: input.record.id,
    link: input.kind === "task" ? `/my-work?task=${input.record.id}` : "/crm",
    urgency: overdue || ["high", "critical"].includes(input.record.priority ?? "") ? "high" : "normal",
    dedupe_key: overdue
      ? `reminder:${input.kind}:overdue:${input.record.id}:${input.today}`
      : `reminder:${input.kind}:due:${input.record.id}:${input.record.dueAt}`,
  };
}

export function announcementReminderKey(announcementId: string, userId: string, today: string): string {
  return `reminder:announcement:${announcementId}:${userId}:${today}`;
}
