"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requiredText } from "@/lib/schema";
import { requireSession } from "@/lib/auth";
import { hasProjectCapability } from "@/lib/access-capabilities";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  createGoogleMeetingEvent,
  deleteGoogleMeetingEvent,
  updateGoogleMeetingEvent,
  calendarFailureStatus,
} from "@/features/calendar/services/google-calendar-write";
import type { ActionResult } from "@/features/tasks/services/task.commands";
import { wallTimeToInstant } from "@/lib/time";
import { composeMeetingSummary } from "./meeting.summary";

const createMeetingSchema = z.object({
  title: requiredText("A meeting needs a title.", 200),
  purpose: z.string().trim().max(2000).optional(),
  projectId: z.string().uuid().optional(),
  startsAt: requiredText("Pick a start time."),
  durationMinutes: z.coerce.number().int().min(15).max(480).default(60),
  location: z.string().trim().max(300).optional(),
  meetingLink: z.string().trim().url().max(500).optional().or(z.literal("")),
  // P1-MTG-04. Each occurrence is its own meeting row sharing a series id, so
  // editing one never changes the others.
  repeat: z.enum(["none", "weekly", "fortnightly", "monthly"]).default("none"),
  occurrences: z.coerce.number().int().min(2).max(12).optional(),
});

/** The start of occurrence `index` (0-based) in wall-clock terms. */
function occurrenceStart(
  first: Date,
  repeat: "weekly" | "fortnightly" | "monthly",
  index: number,
): Date {
  const next = new Date(first.getTime());
  if (repeat === "monthly") {
    next.setUTCMonth(next.getUTCMonth() + index);
  } else {
    next.setUTCDate(next.getUTCDate() + index * (repeat === "weekly" ? 7 : 14));
  }
  return next;
}

export async function createMeeting(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = createMeetingSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input.",
    };
  }
  const {
    title,
    purpose,
    projectId,
    startsAt,
    durationMinutes,
    location,
    meetingLink,
    repeat,
  } = parsed.data;
  const count = repeat === "none" ? 1 : (parsed.data.occurrences ?? 4);

  // Read as wall-clock time in the organization's zone. A `datetime-local`
  // value carries no offset, so `new Date()` would resolve it in the server's
  // zone — UTC in production — and store an instant hours from what was typed.
  const starts = wallTimeToInstant(startsAt, session.timeZone);
  if (!starts) {
    return { ok: false, error: "Invalid start time." };
  }
  const ends = new Date(starts.getTime() + durationMinutes * 60_000);

  const supabase = await createSupabaseServerClient();
  if (projectId) {
    if (!(await hasProjectCapability(supabase, projectId, "collaborate"))) {
      return {
        ok: false,
        error: "You cannot schedule a meeting on this project.",
      };
    }
  } else if (!session.isAdmin) {
    return {
      ok: false,
      error:
        "Link the meeting to a project you can access, or ask an administrator.",
    };
  }
  // The id is chosen here rather than read back. meeting's read policy is
  // app.can_read_meeting(id), which looks the meeting up by id, and within the
  // inserting statement the new row is not yet visible to it — so
  // insert(...).select() failed row-level security for every meeting, and no
  // meeting could be created at all (#112). Nothing is read back, so nothing
  // depends on that visibility.
  const seriesId = count > 1 ? randomUUID() : null;
  const occurrences = Array.from({ length: count }, (_, index) => {
    // Occurrences are spaced in the organization's wall-clock time, so a 10:00
    // weekly meeting stays at 10:00 across a daylight-saving change.
    const wall =
      index === 0 || repeat === "none"
        ? startsAt
        : occurrenceStart(new Date(`${startsAt}Z`), repeat, index)
            .toISOString()
            .slice(0, 16);
    const start =
      index === 0
        ? starts
        : (wallTimeToInstant(wall, session.timeZone) ?? starts);
    return {
      id: randomUUID(),
      start,
      end: new Date(start.getTime() + durationMinutes * 60_000),
    };
  });
  const meeting = { id: occurrences[0].id };
  const { error } = await supabase.from("meeting").insert(
    occurrences.map((occurrence) => ({
      id: occurrence.id,
      organization_id: session.organizationId,
      project_id: projectId ?? null,
      title,
      purpose: purpose || null,
      organizer_id: session.userId,
      starts_at: occurrence.start.toISOString(),
      ends_at: occurrence.end.toISOString(),
      location: location || null,
      meeting_link: meetingLink || null,
      series_id: seriesId,
      recurrence_rule: seriesId ? `${repeat};count=${count}` : null,
    })),
  );

  if (error) return { ok: false, error: "Could not create the meeting." };

  await supabase.from("meeting_attendee").insert(
    occurrences.map((occurrence) => ({
      meeting_id: occurrence.id,
      user_id: session.userId,
    })),
  );

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
    await createGoogleMeetingEvent({
      organizationId: session.organizationId,
      userId: session.userId,
      meetingId: meeting.id,
      title,
      purpose: purpose || null,
      startsAt: starts.toISOString(),
      endsAt: ends.toISOString(),
      location: location || null,
    });
  } catch (calendarError) {
    await supabase
      .from("integration_connection")
      .update({
        status: calendarFailureStatus(calendarError, "Calendar sync failed."),
        last_error:
          calendarError instanceof Error
            ? calendarError.message
            : "Calendar sync failed.",
      })
      .eq("organization_id", session.organizationId)
      .eq("user_id", session.userId)
      .eq("provider", "google_calendar");
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
export async function addMeetingAttendee(
  input: unknown,
): Promise<ActionResult> {
  await requireSession();
  const parsed = attendeeSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input.",
    };
  }

  const supabase = await createSupabaseServerClient();
  // Inviting someone already invited is not an error worth showing anybody.
  const { error } = await supabase
    .from("meeting_attendee")
    .upsert(
      { meeting_id: parsed.data.meetingId, user_id: parsed.data.userId },
      { onConflict: "meeting_id,user_id", ignoreDuplicates: true },
    );
  if (error)
    return { ok: false, error: "Could not add that person to the meeting." };

  revalidatePath(`/meetings/${parsed.data.meetingId}`);
  return { ok: true, id: parsed.data.meetingId };
}

export async function removeMeetingAttendee(
  input: unknown,
): Promise<ActionResult> {
  await requireSession();
  const parsed = attendeeSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input.",
    };
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
    return {
      ok: false,
      error: "The organizer cannot be removed from their own meeting.",
    };
  }

  const { error } = await supabase
    .from("meeting_attendee")
    .delete()
    .eq("meeting_id", parsed.data.meetingId)
    .eq("user_id", parsed.data.userId);
  if (error)
    return {
      ok: false,
      error: "Could not remove that person from the meeting.",
    };

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
  const parsed = updateMeetingSchema.safeParse(input);
  if (!parsed.success)
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input.",
    };
  const data = parsed.data;
  const starts = wallTimeToInstant(data.startsAt, session.timeZone);
  if (!starts) return { ok: false, error: "Invalid start time." };
  const ends = new Date(starts.getTime() + data.durationMinutes * 60_000);
  const supabase = await createSupabaseServerClient();
  const { data: existing } = await supabase
    .from("meeting")
    .select("id, organizer_id, status")
    .eq("id", data.meetingId)
    .maybeSingle();
  if (!existing) return { ok: false, error: "Meeting not found." };
  if (existing.status === "completed" || existing.status === "cancelled") {
    return {
      ok: false,
      error: "Completed or cancelled meetings cannot be rescheduled.",
    };
  }
  if (existing.organizer_id !== session.userId && !session.isAdmin)
    return {
      ok: false,
      error: "Only the organizer or an admin can reschedule this meeting.",
    };
  const { error } = await supabase
    .from("meeting")
    .update({
      title: data.title,
      purpose: data.purpose || null,
      starts_at: starts.toISOString(),
      ends_at: ends.toISOString(),
      location: data.location || null,
    })
    .eq("id", data.meetingId);
  if (error) return { ok: false, error: "Could not update the meeting." };
  try {
    // Same reasoning as create: the Calendar event is updated, the organizer's
    // own meeting link is left alone.
    await updateGoogleMeetingEvent({
      // An admin may reschedule someone else's meeting; the linked Calendar
      // event and OAuth connection belong to the meeting organizer.
      organizationId: session.organizationId,
      userId: existing.organizer_id,
      meetingId: data.meetingId,
      title: data.title,
      purpose: data.purpose || null,
      startsAt: starts.toISOString(),
      endsAt: ends.toISOString(),
      location: data.location || null,
    });
  } catch (calendarError) {
    await supabase
      .from("integration_connection")
      .update({
        status: calendarFailureStatus(calendarError, "Calendar update failed."),
        last_error:
          calendarError instanceof Error
            ? calendarError.message
            : "Calendar update failed.",
      })
      .eq("organization_id", session.organizationId)
      .eq("user_id", existing.organizer_id)
      .eq("provider", "google_calendar");
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
  const parsed = cancelMeetingSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid meeting." };

  const supabase = await createSupabaseServerClient();
  const { data: existing } = await supabase
    .from("meeting")
    .select("id, organizer_id, status")
    .eq("id", parsed.data.meetingId)
    .maybeSingle();
  if (!existing) return { ok: false, error: "Meeting not found." };
  if (existing.status === "completed")
    return { ok: false, error: "Completed meetings cannot be cancelled." };
  if (existing.status === "cancelled") return { ok: true, id: existing.id };
  if (existing.organizer_id !== session.userId && !session.isAdmin) {
    return {
      ok: false,
      error: "Only the organizer or an admin can cancel this meeting.",
    };
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
        status: calendarFailureStatus(
          calendarError,
          "Calendar cancellation failed.",
        ),
        last_error:
          calendarError instanceof Error
            ? calendarError.message
            : "Calendar cancellation failed.",
      })
      .eq("organization_id", session.organizationId)
      .eq("user_id", existing.organizer_id)
      .eq("provider", "google_calendar");
  }

  revalidatePath(`/meetings/${existing.id}`);
  revalidatePath("/meetings");
  return { ok: true, id: existing.id };
}

/**
 * The records an agenda item can point at (P0-AGD-04), as `kind:uuid`. Each
 * maps to its own column so the foreign key keeps the link honest.
 */
const LINK_COLUMNS = {
  task: "linked_task_id",
  milestone: "linked_milestone_id",
  risk: "linked_risk_id",
  issue: "linked_issue_id",
  event: "linked_event_id",
  decision: "linked_decision_id",
  contact: "linked_contact_id",
} as const;
type LinkKind = keyof typeof LINK_COLUMNS;

function linkColumns(link: string | undefined): Record<string, string | null> {
  const cleared = Object.fromEntries(
    Object.values(LINK_COLUMNS).map((column) => [column, null]),
  ) as Record<string, string | null>;
  if (!link) return cleared;
  const [kind, id] = link.split(":") as [LinkKind, string];
  if (!(kind in LINK_COLUMNS) || !z.string().uuid().safeParse(id).success)
    return cleared;
  return { ...cleared, [LINK_COLUMNS[kind]]: id };
}

const agendaLink = z
  .string()
  .regex(
    /^(task|milestone|risk|issue|event|decision|contact):[0-9a-f-]{36}$/,
    "Choose a record to link.",
  )
  .optional()
  .or(z.literal(""));

const agendaSchema = z.object({
  meetingId: z.string().uuid(),
  title: requiredText("Agenda items need a title.", 300),
  kind: z.enum(["information", "discussion", "decision"]).default("discussion"),
  timeBoxMinutes: z.coerce.number().int().min(1).max(240).optional(),
  ownerId: z.string().uuid().optional().or(z.literal("")),
  desiredOutcome: z.string().trim().max(1000).optional(),
  link: agendaLink,
});

export async function addAgendaItem(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = agendaSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input.",
    };
  }
  const {
    meetingId,
    title,
    kind,
    timeBoxMinutes,
    ownerId,
    desiredOutcome,
    link,
  } = parsed.data;

  const supabase = await createSupabaseServerClient();
  const { data: meeting } = await supabase
    .from("meeting")
    .select("status")
    .eq("id", meetingId)
    .maybeSingle();
  if (!meeting) return { ok: false, error: "Meeting not found." };
  if (meeting.status === "completed" || meeting.status === "cancelled") {
    return {
      ok: false,
      error:
        "Agenda cannot be changed after a meeting is completed or cancelled.",
    };
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
    owner_id: ownerId || session.userId,
    desired_outcome: desiredOutcome || null,
    ...linkColumns(link || undefined),
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
  await requireSession();
  const parsed = triageSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input.",
    };
  }

  const supabase = await createSupabaseServerClient();
  const { data: item } = await supabase
    .from("agenda_item")
    .select("meeting_id, meeting:meeting_id(status)")
    .eq("id", parsed.data.agendaItemId)
    .maybeSingle();
  if (!item) return { ok: false, error: "Agenda item not found." };

  const meetingStatus = (
    item as unknown as { meeting: { status: string } | null }
  ).meeting?.status;
  if (meetingStatus === "cancelled") {
    return {
      ok: false,
      error: "A cancelled meeting's agenda cannot be triaged.",
    };
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
  await requireSession();
  const parsed = reorderSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input.",
    };
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
  const parsed = actionSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input.",
    };
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
    return {
      ok: false,
      error: "Actions cannot be added after a meeting is cancelled.",
    };
  }

  const assignee = ownerId ?? session.userId;
  const { data: taskId, error } = await supabase.rpc("create_meeting_action", {
    p_meeting: meetingId,
    p_title: title,
    p_owner: assignee,
    p_due: dueAt || null,
  });
  if (error || !taskId)
    return {
      ok: false,
      error: "Could not create the meeting action. No changes were saved.",
    };

  revalidatePath(`/meetings/${meetingId}`);
  return { ok: true, id: taskId as string };
}

const decisionSchema = z.object({
  meetingId: z.string().uuid(),
  title: requiredText("Decisions need a statement.", 300),
  detail: z.string().trim().max(2000).optional(),
});

export async function recordDecision(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = decisionSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input.",
    };
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
    return {
      ok: false,
      error: "Decisions cannot be recorded for a cancelled meeting.",
    };
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
  await requireSession();
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
    return {
      ok: false,
      error: "Notes cannot be changed for a cancelled meeting.",
    };
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
export async function completeMeeting(
  meetingId: string,
): Promise<ActionResult> {
  const session = await requireSession();
  const supabase = await createSupabaseServerClient();

  const { data: meeting } = await supabase
    .from("meeting")
    .select(
      "id, title, project_id, channel_id, organizer_id, starts_at, status, summary_posted_at",
    )
    .eq("id", meetingId)
    .maybeSingle();
  if (!meeting) return { ok: false, error: "Meeting not found." };
  if (meeting.status === "cancelled")
    return { ok: false, error: "Cancelled meetings cannot be completed." };

  const [decisionsResult, actionsResult, attendeesResult] = await Promise.all([
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

  if (
    [decisionsResult, actionsResult, attendeesResult].some(
      (result) => result.error,
    )
  ) {
    return {
      ok: false,
      error: "Could not load the meeting summary. Try again.",
    };
  }
  const { data: decisions } = decisionsResult;
  const { data: actions } = actionsResult;
  const { data: attendees } = attendeesResult;
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

  const { data: completedId, error: completionError } = await supabase.rpc(
    "complete_meeting",
    {
      p_meeting: meetingId,
      p_summary: lines,
    },
  );
  if (completionError || !completedId) {
    return {
      ok: false,
      error: "Could not complete the meeting and post its summary. Try again.",
    };
  }

  const { fireWorkflows } =
    await import("@/features/admin/services/workflow.runtime");
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

const editAgendaSchema = z.object({
  agendaItemId: z.string().uuid(),
  title: requiredText("Agenda items need a title.", 300),
  kind: z.enum(["information", "discussion", "decision"]),
  timeBoxMinutes: z.coerce.number().int().min(1).max(240).optional(),
  ownerId: z.string().uuid().optional().or(z.literal("")),
  desiredOutcome: z.string().trim().max(1000).optional(),
  link: agendaLink,
});

async function openAgendaItem(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  agendaItemId: string,
) {
  const { data } = await supabase
    .from("agenda_item")
    .select(
      "id, meeting_id, title, desired_outcome, status, sort_key, meeting:meeting_id(status, project_id, series_id, starts_at)",
    )
    .eq("id", agendaItemId)
    .maybeSingle();
  return data as unknown as {
    id: string;
    meeting_id: string;
    title: string;
    desired_outcome: string | null;
    status: string;
    sort_key: number;
    meeting: {
      status: string;
      project_id: string | null;
      series_id: string | null;
      starts_at: string;
    } | null;
  } | null;
}

/** Edit an item before the meeting (P0-AGD-01). Row-level security decides who. */
export async function updateAgendaItem(input: unknown): Promise<ActionResult> {
  await requireSession();
  const parsed = editAgendaSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input.",
    };
  }
  const data = parsed.data;
  const supabase = await createSupabaseServerClient();
  const item = await openAgendaItem(supabase, data.agendaItemId);
  if (!item) return { ok: false, error: "Agenda item not found." };
  if (
    item.meeting?.status === "completed" ||
    item.meeting?.status === "cancelled"
  ) {
    return {
      ok: false,
      error:
        "Agenda cannot be changed after a meeting is completed or cancelled.",
    };
  }
  const { data: updated, error } = await supabase
    .from("agenda_item")
    .update({
      title: data.title,
      kind: data.kind,
      time_box_minutes: data.timeBoxMinutes ?? null,
      ...(data.ownerId ? { owner_id: data.ownerId } : {}),
      desired_outcome: data.desiredOutcome || null,
      ...linkColumns(data.link || undefined),
    })
    .eq("id", data.agendaItemId)
    .select("id");
  if (error || !updated || updated.length === 0) {
    return { ok: false, error: "Could not update the agenda item." };
  }
  revalidatePath(`/meetings/${item.meeting_id}`);
  return { ok: true, id: data.agendaItemId };
}

/** Remove an item before the meeting (P0-AGD-01). Only the organizer can. */
export async function removeAgendaItem(
  agendaItemId: string,
): Promise<ActionResult> {
  await requireSession();
  if (!z.string().uuid().safeParse(agendaItemId).success) {
    return { ok: false, error: "Agenda item not found." };
  }
  const supabase = await createSupabaseServerClient();
  const item = await openAgendaItem(supabase, agendaItemId);
  if (!item) return { ok: false, error: "Agenda item not found." };
  if (
    item.meeting?.status === "completed" ||
    item.meeting?.status === "cancelled"
  ) {
    return {
      ok: false,
      error:
        "Agenda cannot be changed after a meeting is completed or cancelled.",
    };
  }
  const { data: removed, error } = await supabase
    .from("agenda_item")
    .delete()
    .eq("id", agendaItemId)
    .select("id");
  if (error || !removed || removed.length === 0) {
    return { ok: false, error: "Only the organizer can remove agenda items." };
  }
  revalidatePath(`/meetings/${item.meeting_id}`);
  return { ok: true, id: agendaItemId };
}

const combineSchema = z.object({
  agendaItemId: z.string().uuid(),
  targetItemId: z
    .string()
    .uuid({ message: "Choose the item to combine it into." }),
});

/**
 * Combine a proposed item into another on the same agenda (P0-AGD-03). The
 * source keeps its row, marked combined and pointing at the target, and its
 * title is folded into the target's desired outcome so nothing is lost.
 */
export async function combineAgendaItem(input: unknown): Promise<ActionResult> {
  await requireSession();
  const parsed = combineSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input.",
    };
  }
  const { agendaItemId, targetItemId } = parsed.data;
  if (agendaItemId === targetItemId) {
    return { ok: false, error: "An item cannot be combined into itself." };
  }
  const supabase = await createSupabaseServerClient();
  const [source, target] = await Promise.all([
    openAgendaItem(supabase, agendaItemId),
    openAgendaItem(supabase, targetItemId),
  ]);
  if (!source || !target || source.meeting_id !== target.meeting_id) {
    return { ok: false, error: "Both items must be on this meeting's agenda." };
  }
  if (
    source.meeting?.status === "completed" ||
    source.meeting?.status === "cancelled"
  ) {
    return {
      ok: false,
      error:
        "Agenda cannot be changed after a meeting is completed or cancelled.",
    };
  }
  const outcome = [target.desired_outcome, `Also covers: ${source.title}`]
    .filter(Boolean)
    .join("\n");
  const { error: targetError } = await supabase
    .from("agenda_item")
    .update({ desired_outcome: outcome.slice(0, 1000) })
    .eq("id", targetItemId);
  if (targetError) return { ok: false, error: "Could not combine the items." };
  const { error } = await supabase
    .from("agenda_item")
    .update({ status: "combined", combined_into_id: targetItemId })
    .eq("id", agendaItemId);
  if (error) {
    return {
      ok: false,
      error: error.message.includes("organizer")
        ? "Only the meeting organizer can combine agenda items."
        : "Could not combine the items.",
    };
  }
  revalidatePath(`/meetings/${source.meeting_id}`);
  return { ok: true, id: targetItemId };
}

const carrySchema = z.object({
  agendaItemId: z.string().uuid(),
  targetMeetingId: z
    .string()
    .uuid({ message: "Choose the meeting to carry it to." }),
});

/**
 * Carry an unfinished item to a later meeting (P1-AGD-06). A new item is added
 * there pointing back at this one, and this one is marked deferred, so both
 * agendas keep the history.
 */
export async function carryForwardAgendaItem(
  input: unknown,
): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = carrySchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input.",
    };
  }
  const { agendaItemId, targetMeetingId } = parsed.data;
  const supabase = await createSupabaseServerClient();
  const item = await openAgendaItem(supabase, agendaItemId);
  if (!item) return { ok: false, error: "Agenda item not found." };
  if (
    item.status === "done" ||
    item.status === "declined" ||
    item.status === "combined"
  ) {
    return {
      ok: false,
      error: "Only an unfinished item can be carried forward.",
    };
  }
  const { data: target } = await supabase
    .from("meeting")
    .select("id, status, starts_at")
    .eq("id", targetMeetingId)
    .maybeSingle();
  if (!target || target.id === item.meeting_id) {
    return { ok: false, error: "Choose a later meeting you can see." };
  }
  if (target.status === "completed" || target.status === "cancelled") {
    return { ok: false, error: "That meeting is already over." };
  }
  if (
    item.meeting &&
    new Date(target.starts_at as string) <= new Date(item.meeting.starts_at)
  ) {
    return { ok: false, error: "Carry an item forward to a later meeting." };
  }

  const { data: full } = await supabase
    .from("agenda_item")
    .select(
      "title, kind, owner_id, desired_outcome, time_box_minutes, linked_task_id, linked_milestone_id, linked_risk_id, linked_issue_id, linked_event_id, linked_decision_id, linked_contact_id",
    )
    .eq("id", agendaItemId)
    .single();
  const { count } = await supabase
    .from("agenda_item")
    .select("id", { count: "exact", head: true })
    .eq("meeting_id", targetMeetingId);

  const { error: insertError } = await supabase.from("agenda_item").insert({
    ...(full as Record<string, unknown>),
    meeting_id: targetMeetingId,
    sort_key: (count ?? 0) + 1,
    status: session.isStaff ? "accepted" : "proposed",
    proposed_by: session.userId,
    carried_from_id: agendaItemId,
  });
  if (insertError)
    return { ok: false, error: "Could not carry the item forward." };

  if (item.status !== "deferred") {
    await supabase
      .from("agenda_item")
      .update({ status: "deferred" })
      .eq("id", agendaItemId);
  }
  revalidatePath(`/meetings/${item.meeting_id}`);
  revalidatePath(`/meetings/${targetMeetingId}`);
  return { ok: true, id: targetMeetingId };
}
