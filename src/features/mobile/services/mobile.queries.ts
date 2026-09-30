import { createSupabasePageClient } from "@/lib/supabase/page";
import { addCalendarDays, calendarDateInZone, startOfDayInstant } from "@/lib/time";

export interface PhoneTask {
  id: string;
  title: string;
  dueOn: string | null;
  project: string | null;
}

/** The signed-in person's open tasks. RLS still decides what they can see. */
export async function myOpenTasks(userId: string): Promise<PhoneTask[]> {
  const supabase = await createSupabasePageClient();
  const { data } = await supabase
    .from("task")
    .select("id, title, due_at, project:project_id(name)")
    .eq("assignee_id", userId)
    .not("status", "in", "(completed,cancelled)")
    .is("archived_at", null)
    .order("due_at", { ascending: true, nullsFirst: false })
    .limit(200);
  return ((data ?? []) as unknown as { id: string; title: string; due_at: string | null; project: { name: string } | null }[]).map(
    (t) => ({ id: t.id, title: t.title, dueOn: t.due_at, project: t.project?.name ?? null }),
  );
}

export interface PhoneMeeting {
  id: string;
  title: string;
  startsAt: string;
}

/** Meetings today that the person organizes or attends, in the organization's zone. */
export async function myMeetingsToday(userId: string, timeZone: string): Promise<PhoneMeeting[]> {
  const supabase = await createSupabasePageClient();
  const today = calendarDateInZone(new Date(), timeZone) ?? new Date().toISOString().slice(0, 10);
  const start = startOfDayInstant(today, timeZone);
  const end = startOfDayInstant(addCalendarDays(today, 1) ?? today, timeZone);
  if (!start || !end) return [];
  const from = start.toISOString();
  const to = end.toISOString();
  const [organized, attending] = await Promise.all([
    supabase.from("meeting").select("id, title, starts_at").eq("organizer_id", userId)
      .neq("status", "cancelled").gte("starts_at", from).lt("starts_at", to),
    supabase.from("meeting_attendee").select("meeting:meeting_id(id, title, starts_at, status)").eq("user_id", userId),
  ]);
  const byId = new Map<string, PhoneMeeting>();
  for (const m of (organized.data ?? []) as { id: string; title: string; starts_at: string }[]) {
    byId.set(m.id, { id: m.id, title: m.title, startsAt: m.starts_at });
  }
  for (const row of (attending.data ?? []) as unknown as { meeting: { id: string; title: string; starts_at: string; status: string } | null }[]) {
    const m = row.meeting;
    if (m && m.status !== "cancelled" && m.starts_at >= from && m.starts_at < to) {
      byId.set(m.id, { id: m.id, title: m.title, startsAt: m.starts_at });
    }
  }
  return [...byId.values()].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

export interface PhoneNotification {
  id: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

export async function myNotifications(): Promise<PhoneNotification[]> {
  const supabase = await createSupabasePageClient();
  const { data } = await supabase
    .from("notification")
    .select("id, title, body, link, read_at, created_at")
    .order("created_at", { ascending: false })
    .limit(50);
  return ((data ?? []) as { id: string; title: string; body: string | null; link: string | null; read_at: string | null; created_at: string }[]).map(
    (n) => ({ id: n.id, title: n.title, body: n.body, link: n.link, readAt: n.read_at, createdAt: n.created_at }),
  );
}

/** Projects the person can add a task to; the database has the final say. */
export async function captureProjects(): Promise<{ id: string; name: string }[]> {
  const supabase = await createSupabasePageClient();
  const { data } = await supabase
    .from("project")
    .select("id, name")
    .is("archived_at", null)
    .in("stage", ["approved", "planning", "active"])
    .order("name")
    .limit(300);
  return (data ?? []) as { id: string; name: string }[];
}
