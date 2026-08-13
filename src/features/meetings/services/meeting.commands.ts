"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/features/tasks/services/task.commands";

const createMeetingSchema = z.object({
  title: z.string().trim().min(1, "A meeting needs a title.").max(200),
  purpose: z.string().trim().max(2000).optional(),
  projectId: z.string().uuid().optional(),
  startsAt: z.string().min(1, "Pick a start time."),
  durationMinutes: z.coerce.number().int().min(15).max(480).default(60),
  location: z.string().trim().max(300).optional(),
  meetingLink: z.string().trim().url().max(500).optional().or(z.literal("")),
});

export async function createMeeting(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  if (!session.isStaff) return { ok: false, error: "Staff access required." };
  const parsed = createMeetingSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const { title, purpose, projectId, startsAt, durationMinutes, location, meetingLink } =
    parsed.data;

  const starts = new Date(startsAt);
  if (Number.isNaN(starts.getTime())) {
    return { ok: false, error: "Invalid start time." };
  }
  const ends = new Date(starts.getTime() + durationMinutes * 60_000);

  const supabase = await createSupabaseServerClient();
  const { data: meeting, error } = await supabase
    .from("meeting")
    .insert({
      organization_id: session.organizationId,
      project_id: projectId ?? null,
      title,
      purpose: purpose || null,
      organizer_id: session.userId,
      starts_at: starts.toISOString(),
      ends_at: ends.toISOString(),
      location: location || null,
      meeting_link: meetingLink || null,
    })
    .select("id")
    .single();

  if (error || !meeting) return { ok: false, error: "Could not create the meeting." };

  await supabase.from("meeting_attendee").insert({
    meeting_id: meeting.id,
    user_id: session.userId,
  });

  revalidatePath("/meetings");
  return { ok: true, id: meeting.id as string };
}

const agendaSchema = z.object({
  meetingId: z.string().uuid(),
  title: z.string().trim().min(1, "Agenda items need a title.").max(300),
  kind: z.enum(["information", "discussion", "decision"]).default("discussion"),
  timeBoxMinutes: z.coerce.number().int().min(1).max(240).optional(),
});

export async function addAgendaItem(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = agendaSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const { meetingId, title, kind, timeBoxMinutes } = parsed.data;

  const supabase = await createSupabaseServerClient();
  const { count } = await supabase
    .from("agenda_item")
    .select("id", { count: "exact", head: true })
    .eq("meeting_id", meetingId);

  const { error } = await supabase.from("agenda_item").insert({
    meeting_id: meetingId,
    title,
    kind,
    time_box_minutes: timeBoxMinutes ?? null,
    sort_key: (count ?? 0) + 1,
    // Staff-proposed items are accepted immediately; others await organizer
    // review (P0-AGD-02).
    status: session.isStaff ? "accepted" : "proposed",
    proposed_by: session.userId,
    owner_id: session.userId,
  });
  if (error) return { ok: false, error: "Could not add the agenda item." };

  revalidatePath(`/meetings/${meetingId}`);
  return { ok: true };
}

const actionSchema = z.object({
  meetingId: z.string().uuid(),
  title: z.string().trim().min(1, "Actions need a description.").max(300),
  ownerId: z.string().uuid().optional(),
  dueAt: z.string().optional(),
});

/** Meeting action → assigned task with source links (CAL-004, P0-MTG-02). */
export async function addMeetingAction(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  if (!session.isStaff) return { ok: false, error: "Staff access required." };
  const parsed = actionSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const { meetingId, title, ownerId, dueAt } = parsed.data;

  const supabase = await createSupabaseServerClient();
  const { data: meeting } = await supabase
    .from("meeting")
    .select("title, project_id")
    .eq("id", meetingId)
    .maybeSingle();
  if (!meeting) return { ok: false, error: "Meeting not found." };

  const assignee = ownerId ?? session.userId;
  const { data: task, error: taskError } = await supabase
    .from("task")
    .insert({
      organization_id: session.organizationId,
      project_id: meeting.project_id,
      title,
      description: `Action from meeting “${meeting.title}”.`,
      assignee_id: assignee,
      requester_id: session.userId,
      due_at: dueAt || null,
      created_by: session.userId,
    })
    .select("id")
    .single();
  if (taskError || !task) return { ok: false, error: "Could not create the action task." };

  const { error: actionError } = await supabase.from("meeting_action").insert({
    meeting_id: meetingId,
    task_id: task.id,
    title,
    owner_id: assignee,
    due_at: dueAt || null,
  });
  if (actionError) return { ok: false, error: "Task created, but linking failed." };

  if (assignee !== session.userId) {
    await supabase.from("notification").insert({
      user_id: assignee,
      organization_id: session.organizationId,
      category: "assignment",
      title: `Meeting action assigned: ${title}`,
      body: `From “${meeting.title}”`,
      source_type: "task",
      source_id: task.id,
      link: "/my-work",
      dedupe_key: `assign:${task.id}:${assignee}`,
    });
  }

  revalidatePath(`/meetings/${meetingId}`);
  return { ok: true, id: task.id as string };
}

const decisionSchema = z.object({
  meetingId: z.string().uuid(),
  title: z.string().trim().min(1, "Decisions need a statement.").max(300),
  detail: z.string().trim().max(2000).optional(),
});

export async function recordDecision(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  if (!session.isStaff) return { ok: false, error: "Staff access required." };
  const parsed = decisionSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const { meetingId, title, detail } = parsed.data;

  const supabase = await createSupabaseServerClient();
  const { data: meeting } = await supabase
    .from("meeting")
    .select("project_id")
    .eq("id", meetingId)
    .maybeSingle();

  const { error } = await supabase.from("decision").insert({
    organization_id: session.organizationId,
    project_id: meeting?.project_id ?? null,
    meeting_id: meetingId,
    title,
    detail: detail || null,
    decided_by: session.userId,
  });
  if (error) return { ok: false, error: "Could not record the decision." };

  revalidatePath(`/meetings/${meetingId}`);
  return { ok: true };
}

const notesSchema = z.object({
  meetingId: z.string().uuid(),
  notes: z.string().trim().max(20000),
});

export async function saveMeetingNotes(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  if (!session.isStaff) return { ok: false, error: "Staff access required." };
  const parsed = notesSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input." };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("meeting")
    .update({ notes: parsed.data.notes || null })
    .eq("id", parsed.data.meetingId);
  if (error) return { ok: false, error: "Could not save notes." };
  revalidatePath(`/meetings/${parsed.data.meetingId}`);
  return { ok: true };
}

/**
 * Completes the meeting and posts a structured summary to the linked
 * channel (P0-MTG-03/04). The summary is a system message derived from
 * durable records — decisions and actions stay the source of truth.
 */
export async function completeMeeting(meetingId: string): Promise<ActionResult> {
  const session = await requireSession();
  if (!session.isStaff) return { ok: false, error: "Staff access required." };
  const supabase = await createSupabaseServerClient();

  const { data: meeting } = await supabase
    .from("meeting")
    .select("id, title, project_id, channel_id, starts_at, summary_posted_at")
    .eq("id", meetingId)
    .maybeSingle();
  if (!meeting) return { ok: false, error: "Meeting not found." };

  const [{ data: decisions }, { data: actions }] = await Promise.all([
    supabase.from("decision").select("title").eq("meeting_id", meetingId),
    supabase
      .from("meeting_action")
      .select("title, due_at, owner:owner_id(full_name)")
      .eq("meeting_id", meetingId),
  ]);

  await supabase
    .from("meeting")
    .update({ status: "completed" })
    .eq("id", meetingId);

  // Resolve a channel: explicit link, or the linked project's channel.
  let channelId = meeting.channel_id as string | null;
  if (!channelId && meeting.project_id) {
    const { data: projectChannel } = await supabase
      .from("channel")
      .select("id")
      .eq("project_id", meeting.project_id)
      .is("archived_at", null)
      .limit(1)
      .maybeSingle();
    channelId = (projectChannel?.id as string | undefined) ?? null;
  }

  if (channelId && !meeting.summary_posted_at) {
    type ActionRow = {
      title: string;
      due_at: string | null;
      owner: { full_name: string } | null;
    };
    const lines = [
      `Meeting summary — ${meeting.title}`,
      "",
      decisions && decisions.length > 0
        ? `Decisions:\n${decisions.map((d) => `• ${d.title}`).join("\n")}`
        : "Decisions: none recorded",
      "",
      actions && actions.length > 0
        ? `Actions:\n${((actions ?? []) as unknown as ActionRow[])
            .map(
              (a) =>
                `• ${a.title}${a.owner ? ` — ${a.owner.full_name}` : ""}${a.due_at ? ` (due ${a.due_at})` : ""}`,
            )
            .join("\n")}`
        : "Actions: none recorded",
    ].join("\n");

    const { error: postError } = await supabase.from("message").insert({
      organization_id: session.organizationId,
      channel_id: channelId,
      author_id: session.userId,
      body: lines,
      is_system: true,
      source_record_type: "meeting",
      source_record_id: meetingId,
    });
    if (!postError) {
      await supabase
        .from("meeting")
        .update({ summary_posted_at: new Date().toISOString() })
        .eq("id", meetingId);
    }
  }

  revalidatePath(`/meetings/${meetingId}`);
  revalidatePath("/meetings");
  return { ok: true };
}
