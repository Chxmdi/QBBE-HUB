import { createSupabasePageClient } from "@/lib/supabase/page";
// Page reads: the page client throws on a failed query, so an outage reaches
// the error page instead of reading as "not found" or an empty list (P0-UX-05).
import type { SemanticBlockKind } from "../editor-adapter";
import { attachLiveTasks, tasksFromNotes, type LiveTask } from "../live-tasks";
import type { TaskStatus } from "@/types/entities";

export interface MeetingObject {
  id: string;
  title: string;
  purpose: string | null;
  startsAt: string;
  status: "scheduled" | "in_progress" | "completed" | "cancelled";
  notes: string | null;
  projectId: string | null;
  organizer: { id: string; name: string } | null;
}

export interface AgendaEntry {
  id: string;
  title: string;
  kind: string;
  status: string;
  timeBoxMinutes: number | null;
  owner: string | null;
}

export interface CaptureRow {
  id: string;
  kind: SemanticBlockKind;
  body: string;
  detail: string | null;
  status: "open" | "approved" | "dismissed";
  ownerId: string | null;
  ownerName: string | null;
  dueOn: string | null;
  agendaItemId: string | null;
  createdObjectType: "task" | "decision" | null;
  createdObjectId: string | null;
  authorName: string | null;
  createdAt: string;
  /** The task this capture became, read live; null while open, dismissed or not visible. */
  task: LiveTask | null;
}

export interface RecordingRow {
  id: string;
  title: string;
  createdAt: string;
}

export interface MeetingObjectView {
  meeting: MeetingObject;
  agenda: AgendaEntry[];
  captures: CaptureRow[];
  recordings: RecordingRow[];
  /** Tasks made straight from the notes (a `/task` block, a suggestion), not through a capture. */
  notesTasks: LiveTask[];
  people: { id: string; name: string }[];
  canManage: boolean;
}

export const RECORDING_TAG = "meeting-recording";

type Named = { id: string; full_name: string | null } | null;

/** One meeting with everything the object page shows. Null when RLS hides it. */
export async function getMeetingObject(meetingId: string): Promise<MeetingObjectView | null> {
  const supabase = await createSupabasePageClient();
  const { data: row } = await supabase
    .from("meeting")
    .select("id, title, purpose, starts_at, status, notes, project_id, organizer:organizer_id(id, full_name)")
    .eq("id", meetingId)
    .maybeSingle();
  if (!row) return null;
  const organizer = row.organizer as unknown as Named;

  const [agenda, captures, recordings, attendees, canManage, tasks] = await Promise.all([
    supabase
      .from("agenda_item")
      .select("id, title, kind, status, time_box_minutes, owner:owner_id(id, full_name)")
      .eq("meeting_id", meetingId)
      .order("sort_key", { ascending: true }),
    supabase
      .from("meeting_capture")
      .select(
        "id, kind, body, detail, status, owner_id, due_on, agenda_item_id, created_object_type, created_object_id, created_at, " +
          "owner:owner_id(id, full_name), author:created_by(id, full_name)",
      )
      .eq("meeting_id", meetingId)
      .order("created_at", { ascending: true }),
    supabase
      .from("document")
      .select("id, title, created_at")
      .eq("meeting_id", meetingId)
      .contains("tags", [RECORDING_TAG])
      .is("archived_at", null)
      .order("created_at", { ascending: false }),
    supabase.from("meeting_attendee").select("user:user_id(id, full_name)").eq("meeting_id", meetingId),
    supabase.rpc("can_manage_meeting", { p_meeting: meetingId }),
    // Every task this meeting produced (M7b source), as the reader may see them.
    supabase
      .from("task")
      .select("id, title, status, due_at, archived_at, assignee:assignee_id(id, full_name)")
      .eq("source_type", "meeting")
      .eq("source_id", meetingId)
      .order("created_at", { ascending: true }),
  ]);

  const liveTasks: LiveTask[] = ((tasks.data ?? []) as unknown as {
    id: string; title: string; status: TaskStatus; due_at: string | null; archived_at: string | null; assignee: Named;
  }[]).map((t) => ({
    id: t.id,
    title: t.title,
    status: t.status,
    dueOn: t.due_at,
    assigneeName: t.assignee?.full_name ?? null,
    archived: t.archived_at !== null,
  }));

  const captureLinks = ((captures.data ?? []) as unknown as { created_object_type: "task" | "decision" | null; created_object_id: string | null }[]).map(
    (c) => ({ createdObjectType: c.created_object_type, createdObjectId: c.created_object_id }),
  );

  const people = new Map<string, string>();
  if (organizer) people.set(organizer.id, organizer.full_name ?? "");
  for (const a of (attendees.data ?? []) as unknown as { user: Named }[]) {
    if (a.user) people.set(a.user.id, a.user.full_name ?? "");
  }

  return {
    meeting: {
      id: row.id as string,
      title: row.title as string,
      purpose: (row.purpose as string | null) ?? null,
      startsAt: row.starts_at as string,
      status: row.status as MeetingObject["status"],
      notes: (row.notes as string | null) ?? null,
      projectId: (row.project_id as string | null) ?? null,
      organizer: organizer ? { id: organizer.id, name: organizer.full_name ?? "" } : null,
    },
    agenda: ((agenda.data ?? []) as unknown as {
      id: string; title: string; kind: string; status: string; time_box_minutes: number | null; owner: Named;
    }[]).map((a) => ({
      id: a.id,
      title: a.title,
      kind: a.kind,
      status: a.status,
      timeBoxMinutes: a.time_box_minutes,
      owner: a.owner?.full_name ?? null,
    })),
    captures: attachLiveTasks(((captures.data ?? []) as unknown as {
      id: string; kind: SemanticBlockKind; body: string; detail: string | null;
      status: CaptureRow["status"]; owner_id: string | null; due_on: string | null;
      agenda_item_id: string | null; created_object_type: CaptureRow["createdObjectType"];
      created_object_id: string | null; created_at: string; owner: Named; author: Named;
    }[]).map((c) => ({
      id: c.id,
      kind: c.kind,
      body: c.body,
      detail: c.detail,
      status: c.status,
      ownerId: c.owner_id,
      ownerName: c.owner?.full_name ?? null,
      dueOn: c.due_on,
      agendaItemId: c.agenda_item_id,
      createdObjectType: c.created_object_type,
      createdObjectId: c.created_object_id,
      authorName: c.author?.full_name ?? null,
      createdAt: c.created_at,
    })), liveTasks),
    notesTasks: tasksFromNotes(liveTasks, captureLinks),
    recordings: ((recordings.data ?? []) as { id: string; title: string; created_at: string }[]).map((r) => ({
      id: r.id,
      title: r.title,
      createdAt: r.created_at,
    })),
    people: [...people].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
    canManage: canManage.data === true,
  };
}

export interface MeetingListRow {
  id: string;
  title: string;
  startsAt: string;
  status: MeetingObject["status"];
  organizer: string | null;
  project: string | null;
  /** How many captured items still wait for the end-of-meeting review. */
  openCaptures: number;
}

export interface MeetingObjectIndex {
  upcoming: MeetingListRow[];
  recent: MeetingListRow[];
}

const INDEX_LIMIT = 20;

type ListRow = {
  id: string;
  title: string;
  starts_at: string;
  status: MeetingObject["status"];
  organizer: Named;
  project: { id: string; name: string } | null;
  open_captures: { count: number }[] | null;
};

function toListRow(row: ListRow): MeetingListRow {
  return {
    id: row.id,
    title: row.title,
    startsAt: row.starts_at,
    status: row.status,
    organizer: row.organizer?.full_name ?? null,
    project: row.project?.name ?? null,
    openCaptures: row.open_captures?.[0]?.count ?? 0,
  };
}

/**
 * The meetings the reader may see, split around now: the next ones first,
 * then the most recent, each with how many captures still wait for review
 * (counted in the same query). RLS decides what is listed and counted; a
 * read error reaches the error page through the page client rather than
 * reading as an empty index.
 */
export async function listMeetingObjects(now: Date = new Date()): Promise<MeetingObjectIndex> {
  const supabase = await createSupabasePageClient();
  const cutoff = now.toISOString();
  const columns =
    "id, title, starts_at, status, organizer:organizer_id(id, full_name), project:project_id(id, name), open_captures:meeting_capture(count)";
  const [upcoming, recent] = await Promise.all([
    supabase
      .from("meeting")
      .select(columns)
      .eq("open_captures.status", "open")
      .gte("starts_at", cutoff)
      .neq("status", "cancelled")
      .order("starts_at")
      .limit(INDEX_LIMIT),
    supabase
      .from("meeting")
      .select(columns)
      .eq("open_captures.status", "open")
      .lt("starts_at", cutoff)
      .order("starts_at", { ascending: false })
      .limit(INDEX_LIMIT),
  ]);
  return {
    upcoming: ((upcoming.data ?? []) as unknown as ListRow[]).map(toListRow),
    recent: ((recent.data ?? []) as unknown as ListRow[]).map(toListRow),
  };
}
