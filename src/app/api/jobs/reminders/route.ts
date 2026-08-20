import { NextResponse } from "next/server";
import { cronAuthorized } from "@/lib/cron-auth";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { recordJobRun } from "@/lib/job-observability";
import {
  announcementReminderKey,
  reminderNotification,
  utcDay,
  type DatedReminder,
} from "@/features/notifications/services/reminders";

export const dynamic = "force-dynamic";

const ACTIVE_TASK_STATUSES = ["not_started", "ready", "in_progress", "waiting", "blocked", "in_review"];

export async function GET(request: Request) { return POST(request); }

/** Durable due-date and acknowledgement reminders. Notification dedupe keys make
 * retries and concurrent cron invocations safe. */
export async function POST(request: Request) {
  if (!cronAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let supabase;
  try { supabase = createSupabaseServiceClient(); }
  catch { return NextResponse.json({ error: "Service role is not configured." }, { status: 503 }); }

  const now = new Date();
  const today = utcDay(now);
  const startedAt = now.toISOString();
  const [{ data: tasks, error: taskError }, { data: followUps, error: followUpError }, { data: announcements, error: announcementError }] = await Promise.all([
    supabase.from("task").select("id, title, due_at, assignee_id, organization_id, priority")
      .in("status", ACTIVE_TASK_STATUSES).not("assignee_id", "is", null).not("due_at", "is", null).lte("due_at", today).limit(300),
    supabase.from("crm_follow_up").select("id, title, due_at, owner_id, organization_id")
      .eq("status", "open").not("owner_id", "is", null).lte("due_at", today).limit(300),
    supabase.from("announcement").select("id, title, organization_id, created_by, priority, ack_deadline")
      .eq("requires_ack", true).not("ack_deadline", "is", null).lte("ack_deadline", startedAt).limit(100),
  ]);
  if (taskError || followUpError || announcementError) {
    const error = taskError?.message ?? followUpError?.message ?? announcementError?.message ?? "Could not load reminders.";
    console.error("Reminder job query failed", { error });
    return NextResponse.json({ error }, { status: 500 });
  }

  const reminders = [
    ...(tasks ?? []).map((task) => reminderNotification({ kind: "task", today, record: {
      id: task.id as string, title: task.title as string, dueAt: task.due_at as string, ownerId: task.assignee_id as string,
      organizationId: task.organization_id as string, priority: task.priority as string,
    } satisfies DatedReminder })),
    ...(followUps ?? []).map((followUp) => reminderNotification({ kind: "follow_up", today, record: {
      id: followUp.id as string, title: followUp.title as string, dueAt: followUp.due_at as string, ownerId: followUp.owner_id as string,
      organizationId: followUp.organization_id as string,
    } satisfies DatedReminder })),
  ];
  let inserted = 0;
  const record = async (organizationId: string, rows: Record<string, unknown>[]) => {
    if (!rows.length) return;
    const { data, error } = await supabase.from("notification").upsert(rows, {
      onConflict: "user_id,dedupe_key", ignoreDuplicates: true,
    }).select("id");
    if (error) throw error;
    inserted += data?.length ?? 0;
    await recordJobRun(supabase, { organizationId, jobName: "reminders", status: "succeeded", details: { candidates: rows.length, inserted: data?.length ?? 0 }, startedAt });
  };
  try {
    const reminderByOrg = new Map<string, Record<string, unknown>[]>();
    for (const reminder of reminders) {
      const rows = reminderByOrg.get(reminder.organization_id as string) ?? [];
      rows.push(reminder); reminderByOrg.set(reminder.organization_id as string, rows);
    }
    for (const [organizationId, rows] of reminderByOrg) await record(organizationId, rows);
    for (const announcement of announcements ?? []) {
      const [{ data: members, error: membersError }, { data: acknowledgments, error: acknowledgmentsError }] = await Promise.all([
        supabase.from("organization_membership").select("user_id").eq("organization_id", announcement.organization_id).eq("status", "active"),
        supabase.from("announcement_acknowledgment").select("user_id").eq("announcement_id", announcement.id),
      ]);
      if (membersError || acknowledgmentsError) {
        throw new Error(membersError?.message ?? acknowledgmentsError?.message ?? "Could not load announcement acknowledgments.");
      }
      const acknowledged = new Set((acknowledgments ?? []).map((ack) => ack.user_id as string));
      const rows = (members ?? []).map((member) => member.user_id as string)
        .filter((userId) => userId !== announcement.created_by && !acknowledged.has(userId))
        .map((userId) => ({ user_id: userId, organization_id: announcement.organization_id, category: "announcement", title: `Acknowledgment overdue: ${announcement.title}`,
          body: "Please acknowledge this required announcement.", source_type: "announcement", source_id: announcement.id, link: "/announcements",
          urgency: announcement.priority === "critical" ? "critical" : "high", dedupe_key: announcementReminderKey(announcement.id as string, userId, today) }));
      await record(announcement.organization_id as string, rows);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not store reminders.";
    console.error("Reminder job failed", { error: message });
    return NextResponse.json({ error: message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, inserted, candidates: reminders.length });
}
