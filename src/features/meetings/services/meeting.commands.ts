"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requiredText } from "@/lib/schema";
import { requireSession } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  createGoogleMeetingEvent,
  deleteGoogleMeetingEvent,
  updateGoogleMeetingEvent,
} from "@/features/calendar/services/google-calendar-write";
import type { ActionResult } from "@/features/tasks/services/task.commands";
import { composeMeetingSummary } from "./meeting.summary";

const createMeetingSchema = z.object({
  title: requiredText("A meeting needs a title.", 200),
  purpose: z.string().trim().max(2000).optional(),
  projectId: z.string().uuid().optional(),
  startsAt: requiredText("Pick a start time."),
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

  // Calendar sync is additive: local operations stay available if Google is
  // unavailable, and the connection carries an actionable recovery state.
  try {
    // Deliberately does not touch `meeting_link`. Google returns `htmlLink`,
    // which is the Calendar event page — not a conferencing URL — and this
    // used to overwrite whatever the organizer had typed. Paste a Zoom link
    // with Calendar connected and it was gone, with "Join meeting" quietly
    // sending everybody to Google instead. CAL-005 requires the field stay
    // provider-agnostic, and a field the integration silently rewrites is not.
    // The Calendar URL already has its own home in `calendar_event_link`.
    await createGoogleMeetingEvent({ organizationId: session.organizationId, userId: session.userId, meetingId: meeting.id, title, purpose: purpose || null, startsAt: starts.toISOString(), endsAt: ends.toISOString(), location: location || null });
  } catch (calendarError) {
    await supabase.from("integration_connection").update({ status: "error", last_error: calendarError instanceof Error ? calendarError.message : "Calendar sync failed." }).eq("organization_id", session.organizationId).eq("user_id", session.userId).eq("provider", "google_calendar");
  }

  revalidatePath("/meetings");
  return { ok: true, id: meeting.id as string };
}

const attendeeSchema = z.object({
  meetingId: z.string().uuid(),
  userId: z.string().uuid({ message: "Choose a person to invite." }),
});

/**
 * Invite someone to a meeting.
 *
 * `meeting_attendee` and its policies have existed since the first operations
 * migration, and `app.can_read_meeting` grants read to staff, the organizer,
 * *or an attendee* — a branch covered by ten allow/deny assertions. Nothing
 * ever wrote a row through it: the only insert in the codebase was the
 * organizer adding themselves at creation. So the attendee branch was
 * unreachable in production, and a non-staff invitee could never see a meeting
 * they had been invited to, because they could never become an invitee.
 *
 * Authorization is `meeting_attendee_staff_write` (`app.can_manage_meeting`,
 * which resolves to organization staff). The session check here is for the
 * error message; RLS is what actually decides.
 */
export async function addMeetingAttendee(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  if (!session.isStaff) return { ok: false, error: "Staff access required." };
  const parsed = attendeeSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const supabase = await createSupabaseServerClient();
  // Inviting someone already invited is not an error worth showing anybody.
  const { error } = await supabase
    .from("meeting_attendee")
    .upsert(
      { meeting_id: parsed.data.meetingId, user_id: parsed.data.userId },
      { onConflict: "meeting_id,user_id", ignoreDuplicates: true },
    );
  if (error) return { ok: false, error: "Could not add that person to the meeting." };

  revalidatePath(`/meetings/${parsed.data.meetingId}`);
  return { ok: true, id: parsed.data.meetingId };
}

export async function removeMeetingAttendee(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  if (!session.isStaff) return { ok: false, error: "Staff access required." };
  const parsed = attendeeSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const supabase = await createSupabaseServerClient();
  const { data: meeting } = await supabase
    .from("meeting")
    .select("organizer_id")
    .eq("id", parsed.data.meetingId)
    .maybeSingle();

  // Removing the organizer would leave a meeting whose own convener cannot
  // read it unless they happen to be staff — and would silently strip the
  // notes and decisions from their view of it.
  if (meeting?.organizer_id === parsed.data.userId) {
    return { ok: false, error: "The organizer cannot be removed from their own meeting." };
  }

  const { error } = await supabase
    .from("meeting_attendee")
    .delete()
    .eq("meeting_id", parsed.data.meetingId)
    .eq("user_id", parsed.data.userId);
  if (error) return { ok: false, error: "Could not remove that person from the meeting." };

  revalidatePath(`/meetings/${parsed.data.meetingId}`);
  return { ok: true, id: parsed.data.meetingId };
}

const updateMeetingSchema = z.object({
  meetingId: z.string().uuid(),
  title: requiredText("A meeting needs a title.", 200),
  purpose: z.string().trim().max(2000).optional(),
  startsAt: requiredText("Pick a start time."),
  durationMinutes: z.coerce.number().int().min(15).max(480),
  location: z.string().trim().max(300).optional(),
});

/** Reschedules the Hub record first, then updates its separately linked
 * Google event without touching attendee-managed Calendar fields. */
export async function updateMeeting(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  if (!session.isStaff) return { ok: false, error: "Staff access required." };
  const parsed = updateMeetingSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const data = parsed.data;
  const starts = new Date(data.startsAt);
  if (Number.isNaN(starts.getTime())) return { ok: false, error: "Invalid start time." };
  const ends = new Date(starts.getTime() + data.durationMinutes * 60_000);
  const supabase = await createSupabaseServerClient();
  const { data: existing } = await supabase.from("meeting")
    .select("id, organizer_id, status")
    .eq("id", data.meetingId)
    .maybeSingle();
  if (!existing) return { ok: false, error: "Meeting not found." };
  if (existing.status === "completed" || existing.status === "cancelled") {
    return { ok: false, error: "Completed or cancelled meetings cannot be rescheduled." };
  }
  if (existing.organizer_id !== session.userId && !session.isAdmin) return { ok: false, error: "Only the organizer or an admin can reschedule this meeting." };
  const { error } = await supabase.from("meeting").update({
    title: data.title, purpose: data.purpose || null, starts_at: starts.toISOString(),
    ends_at: ends.toISOString(), location: data.location || null,
  }).eq("id", data.meetingId);
  if (error) return { ok: false, error: "Could not update the meeting." };
  try {
    // Same reasoning as create: the Calendar event is updated, the organizer's
    // own meeting link is left alone.
    await updateGoogleMeetingEvent({
      // An admin may reschedule someone else's meeting; the linked Calendar
      // event and OAuth connection belong to the meeting organizer.
      organizationId: session.organizationId, userId: existing.organizer_id, meetingId: data.meetingId,
      title: data.title, purpose: data.purpose || null, startsAt: starts.toISOString(),
      endsAt: ends.toISOString(), location: data.location || null,
    });
  } catch (calendarError) {
    await supabase.from("integration_connection").update({
      status: "degraded",
      last_error: calendarError instanceof Error ? calendarError.message : "Calendar update failed.",
    }).eq("organization_id", session.organizationId).eq("user_id", existing.organizer_id).eq("provider", "google_calendar");
  }
  revalidatePath(`/meetings/${data.meetingId}`);
  revalidatePath("/meetings");
  return { ok: true, id: data.meetingId };
}

const cancelMeetingSchema = z.object({ meetingId: z.string().uuid() });

/** Cancels the Hub meeting first so it never remains actionable after a user
 * cancellation. Its Hub-owned Calendar event is then removed; a failure keeps
 * the link for recovery and marks the organizer's Calendar connection degraded. */
export async function cancelMeeting(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  if (!session.isStaff) return { ok: false, error: "Staff access required." };
  const parsed = cancelMeetingSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid meeting." };

  const supabase = await createSupabaseServerClient();
  const { data: existing } = await supabase
    .from("meeting")
    .select("id, organizer_id, status")
    .eq("id", parsed.data.meetingId)
    .maybeSingle();
  if (!existing) return { ok: false, error: "Meeting not found." };
  if (existing.status === "completed") return { ok: false, error: "Completed meetings cannot be cancelled." };
  if (existing.status === "cancelled") return { ok: true, id: existing.id };
  if (existing.organizer_id !== session.userId && !session.isAdmin) {
    return { ok: false, error: "Only the organizer or an admin can cancel this meeting." };
  }

  const { error } = await supabase
    .from("meeting")
    .update({ status: "cancelled", meeting_link: null })
    .eq("id", existing.id);
  if (error) return { ok: false, error: "Could not cancel the meeting." };

  try {
    await deleteGoogleMeetingEvent({
      organizationId: session.organizationId,
      userId: existing.organizer_id,
      meetingId: existing.id,
    });
  } catch (calendarError) {
    await supabase
      .from("integration_connection")
      .update({
        status: "degraded",
        last_error: calendarError instanceof Error ? calendarError.message : "Calendar cancellation failed.",
      })
      .eq("organization_id", session.organizationId)
      .eq("user_id", existing.organizer_id)
      .eq("provider", "google_calendar");
  }

  revalidatePath(`/meetings/${existing.id}`);
  revalidatePath("/meetings");
  return { ok: true, id: existing.id };
}

const agendaSchema = z.object({
  meetingId: z.string().uuid(),
  title: requiredText("Agenda items need a title.", 300),
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
  const { data: meeting } = await supabase
    .from("meeting")
    .select("status")
    .eq("id", meetingId)
    .maybeSingle();
  if (!meeting) return { ok: false, error: "Meeting not found." };
  if (meeting.status === "completed" || meeting.status === "cancelled") {
    return { ok: false, error: "Agenda cannot be changed after a meeting is completed or cancelled." };
  }
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

/**
 * The organizer's half of P0-AGD-02.
 *
 * `status` values are constrained in the database, and a trigger refuses a
 * status change from anyone who cannot manage the meeting — including the
 * person who proposed the item, who can still edit its wording. The zod enum
 * here exists so a mistyped value is a readable message rather than a
 * constraint violation; the database is what actually decides.
 */
const AGENDA_DECISIONS = ["accepted", "deferred", "declined", "done"] as const;

const triageSchema = z.object({
  agendaItemId: z.string().uuid(),
  decision: z.enum(AGENDA_DECISIONS, {
    errorMap: () => ({ message: "Choose accept, defer, decline or done." }),
  }),
});

export async function triageAgendaItem(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  if (!session.isStaff) return { ok: false, error: "Staff access required." };
  const parsed = triageSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const supabase = await createSupabaseServerClient();
  const { data: item } = await supabase
    .from("agenda_item")
    .select("meeting_id, meeting:meeting_id(status)")
    .eq("id", parsed.data.agendaItemId)
    .maybeSingle();
  if (!item) return { ok: false, error: "Agenda item not found." };

  const meetingStatus = (item as unknown as { meeting: { status: string } | null }).meeting
    ?.status;
  if (meetingStatus === "cancelled") {
    return { ok: false, error: "A cancelled meeting's agenda cannot be triaged." };
  }

  const { error } = await supabase
    .from("agenda_item")
    .update({ status: parsed.data.decision })
    .eq("id", parsed.data.agendaItemId);
  if (error) return { ok: false, error: "Could not update the agenda item." };

  revalidatePath(`/meetings/${item.meeting_id as string}`);
  return { ok: true, id: parsed.data.agendaItemId };
}

const reorderSchema = z.object({
  agendaItemId: z.string().uuid(),
  direction: z.enum(["up", "down"]),
});

/**
 * Reorder, the other half of the requirement's verb list.
 *
 * `sort_key` is a float precisely so an item can be slotted between two others
 * without renumbering the rest, so a move swaps this item's key with its
 * neighbour's rather than rewriting the column.
 */
export async function moveAgendaItem(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  if (!session.isStaff) return { ok: false, error: "Staff access required." };
  const parsed = reorderSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const supabase = await createSupabaseServerClient();
  const { data: item } = await supabase
    .from("agenda_item")
    .select("id, meeting_id, sort_key")
    .eq("id", parsed.data.agendaItemId)
    .maybeSingle();
  if (!item) return { ok: false, error: "Agenda item not found." };

  const goingUp = parsed.data.direction === "up";
  const { data: neighbour } = await supabase
    .from("agenda_item")
    .select("id, sort_key")
    .eq("meeting_id", item.meeting_id as string)
    [goingUp ? "lt" : "gt"]("sort_key", item.sort_key as number)
    .order("sort_key", { ascending: !goingUp })
    .limit(1)
    .maybeSingle();

  // Already at the end it was heading for. Not an error worth a message.
  if (!neighbour) return { ok: true, id: parsed.data.agendaItemId };

  const [{ error: firstError }, { error: secondError }] = await Promise.all([
    supabase
      .from("agenda_item")
      .update({ sort_key: neighbour.sort_key as number })
      .eq("id", item.id as string),
    supabase
      .from("agenda_item")
      .update({ sort_key: item.sort_key as number })
      .eq("id", neighbour.id as string),
  ]);
  if (firstError || secondError) {
    return { ok: false, error: "Could not reorder the agenda." };
  }

  revalidatePath(`/meetings/${item.meeting_id as string}`);
  return { ok: true, id: parsed.data.agendaItemId };
}

const actionSchema = z.object({
  meetingId: z.string().uuid(),
  title: requiredText("Actions need a description.", 300),
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
    .select("title, project_id, status")
    .eq("id", meetingId)
    .maybeSingle();
  if (!meeting) return { ok: false, error: "Meeting not found." };
  if (meeting.status === "cancelled") {
    return { ok: false, error: "Actions cannot be added after a meeting is cancelled." };
  }

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
  title: requiredText("Decisions need a statement.", 300),
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
    .select("project_id, status")
    .eq("id", meetingId)
    .maybeSingle();
  if (!meeting) return { ok: false, error: "Meeting not found." };
  if (meeting.status === "cancelled") {
    return { ok: false, error: "Decisions cannot be recorded for a cancelled meeting." };
  }

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
  const { data: meeting } = await supabase
    .from("meeting")
    .select("status")
    .eq("id", parsed.data.meetingId)
    .maybeSingle();
  if (!meeting) return { ok: false, error: "Meeting not found." };
  if (meeting.status === "cancelled") {
    return { ok: false, error: "Notes cannot be changed for a cancelled meeting." };
  }
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
    .select("id, title, project_id, channel_id, organizer_id, starts_at, status, summary_posted_at")
    .eq("id", meetingId)
    .maybeSingle();
  if (!meeting) return { ok: false, error: "Meeting not found." };
  if (meeting.status === "cancelled") return { ok: false, error: "Cancelled meetings cannot be completed." };
  if (meeting.status === "completed") return { ok: true, id: meeting.id };

  const [{ data: decisions }, { data: actions }, { data: attendees }] = await Promise.all([
    supabase.from("decision").select("title").eq("meeting_id", meetingId),
    supabase
      .from("meeting_action")
      .select("title, due_at, owner:owner_id(full_name)")
      .eq("meeting_id", meetingId),
    supabase
      .from("meeting_attendee")
      .select("user:user_id(full_name)")
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
    type AttendeeRow = { user: { full_name: string } | null };

    const lines = composeMeetingSummary({
      title: meeting.title,
      attendees: ((attendees ?? []) as unknown as AttendeeRow[]).map((a) => ({
        fullName: a.user?.full_name ?? null,
      })),
      decisions: (decisions ?? []).map((d) => ({ title: d.title as string })),
      actions: ((actions ?? []) as unknown as ActionRow[]).map((a) => ({
        title: a.title,
        dueAt: a.due_at,
        ownerName: a.owner?.full_name ?? null,
      })),
    });

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

  const { fireWorkflows } = await import("@/features/admin/services/workflow.runtime");
  await fireWorkflows(supabase, {
    organizationId: session.organizationId,
    actorId: session.userId,
    eventType: "meeting_completed",
    title: meeting.title as string,
    sourceType: "meeting",
    sourceId: meetingId,
    link: `/meetings/${meetingId}`,
    assigneeId: (meeting.organizer_id as string | null) ?? null,
  });

  revalidatePath(`/meetings/${meetingId}`);
  revalidatePath("/meetings");
  return { ok: true };
}
