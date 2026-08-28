"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requiredText } from "@/lib/schema";
import { requireSession } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  createGoogleEventRecord,
  deleteGoogleEventRecord,
  updateGoogleEventRecord,
} from "@/features/calendar/services/google-calendar-write";
import { fireWorkflows } from "@/features/admin/services/workflow.runtime";
import type { ActionResult } from "@/features/tasks/services/task.commands";

const createEventSchema = z.object({
  name: requiredText("An event needs a name.", 200),
  description: z.string().trim().max(5000).optional(),
  programId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
  eventType: z.string().trim().max(60).optional(),
  startsAt: requiredText("Pick a start time."),
  endsAt: z.string().optional(),
  location: z.string().trim().max(300).optional(),
  volunteerNeed: z.coerce.number().int().min(0).max(500).optional(),
});

function eventSchedule(startsAt: string, endsAt?: string) {
  const starts = new Date(startsAt);
  if (Number.isNaN(starts.getTime())) return null;
  // Google Calendar requires an end. Keep prior optional Hub input ergonomic
  // while making the persisted event and its linked Calendar record explicit.
  const ends = endsAt ? new Date(endsAt) : new Date(starts.getTime() + 60 * 60_000);
  if (Number.isNaN(ends.getTime()) || ends.getTime() <= starts.getTime()) return null;
  return { starts, ends };
}

async function markCalendarDegraded(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  organizationId: string,
  userId: string,
  error: unknown,
  fallback: string,
) {
  await supabase
    .from("integration_connection")
    .update({
      status: "degraded",
      last_error: error instanceof Error ? error.message : fallback,
    })
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .eq("provider", "google_calendar");
}

export async function createEvent(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  if (!session.isStaff) return { ok: false, error: "Staff access required." };
  const parsed = createEventSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const data = parsed.data;
  const schedule = eventSchedule(data.startsAt, data.endsAt);
  if (!schedule) return { ok: false, error: "End time must be after the event starts." };
  const { starts, ends } = schedule;

  const supabase = await createSupabaseServerClient();
  const { data: event, error } = await supabase
    .from("event")
    .insert({
      organization_id: session.organizationId,
      program_id: data.programId ?? null,
      project_id: data.projectId ?? null,
      name: data.name,
      description: data.description || null,
      owner_id: session.userId,
      event_type: data.eventType || null,
      starts_at: starts.toISOString(),
      ends_at: ends.toISOString(),
      location: data.location || null,
      volunteer_need: data.volunteerNeed ?? null,
      created_by: session.userId,
    })
    .select("id")
    .single();

  if (error || !event) return { ok: false, error: "Could not create the event." };

  await supabase.from("activity_event").insert({
    organization_id: session.organizationId,
    actor_id: session.userId,
    verb: "created",
    source_type: "event",
    source_id: event.id,
    program_id: data.programId ?? null,
    project_id: data.projectId ?? null,
    summary: `created event “${data.name}”`,
  });

  // Local event creation remains reliable without Google, while the owner’s
  // connection reports an actionable degraded state when a linked write fails.
  try {
    await createGoogleEventRecord({
      organizationId: session.organizationId,
      userId: session.userId,
      eventId: event.id,
      title: data.name,
      description: data.description || null,
      startsAt: starts.toISOString(),
      endsAt: ends.toISOString(),
      location: data.location || null,
    });
  } catch (calendarError) {
    await markCalendarDegraded(
      supabase,
      session.organizationId,
      session.userId,
      calendarError,
      "Calendar event creation failed.",
    );
  }

  revalidatePath("/events");
  return { ok: true, id: event.id as string };
}

const updateEventSchema = z.object({
  eventId: z.string().uuid(),
  name: requiredText("An event needs a name.", 200),
  description: z.string().trim().max(5000).optional(),
  eventType: z.string().trim().max(60).optional(),
  startsAt: requiredText("Pick a start time."),
  endsAt: z.string().optional(),
  location: z.string().trim().max(300).optional(),
  volunteerNeed: z.coerce.number().int().min(0).max(500).optional(),
});

/** Updates the Hub event first, then its separately owned Google Calendar
 * record when connected. Imported overlay events are never mutated here. */
export async function updateEvent(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  if (!session.isStaff) return { ok: false, error: "Staff access required." };
  const parsed = updateEventSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const data = parsed.data;
  const schedule = eventSchedule(data.startsAt, data.endsAt);
  if (!schedule) return { ok: false, error: "End time must be after the event starts." };

  const supabase = await createSupabaseServerClient();
  const { data: existing } = await supabase
    .from("event")
    .select("id, owner_id, status")
    .eq("id", data.eventId)
    .maybeSingle();
  if (!existing) return { ok: false, error: "Event not found." };
  if (existing.status === "cancelled") return { ok: false, error: "Cancelled events cannot be changed." };

  const { error } = await supabase.from("event").update({
    name: data.name,
    description: data.description || null,
    event_type: data.eventType || null,
    starts_at: schedule.starts.toISOString(),
    ends_at: schedule.ends.toISOString(),
    location: data.location || null,
    volunteer_need: data.volunteerNeed ?? null,
  }).eq("id", existing.id);
  if (error) return { ok: false, error: "Could not update the event." };

  try {
    await updateGoogleEventRecord({
      organizationId: session.organizationId,
      userId: existing.owner_id,
      eventId: existing.id,
      title: data.name,
      description: data.description || null,
      startsAt: schedule.starts.toISOString(),
      endsAt: schedule.ends.toISOString(),
      location: data.location || null,
    });
  } catch (calendarError) {
    await markCalendarDegraded(
      supabase,
      session.organizationId,
      existing.owner_id,
      calendarError,
      "Calendar event update failed.",
    );
  }

  revalidatePath(`/events/${existing.id}`);
  revalidatePath("/events");
  revalidatePath("/calendar");
  return { ok: true, id: existing.id };
}

const assignSchema = z.object({
  eventId: z.string().uuid(),
  userId: z.string().uuid(),
  role: z.enum([
    "logistics", "communications", "volunteers", "venue",
    "content", "registration", "follow_up",
  ]),
});

/** Distinct per-area event ownership (P0-EVT-02). */
export async function assignEventRole(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  if (!session.isStaff) return { ok: false, error: "Staff access required." };
  const parsed = assignSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input." };
  const { eventId, userId, role } = parsed.data;

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("event_assignment").insert({
    event_id: eventId,
    user_id: userId,
    role,
  });
  if (error && error.code !== "23505") {
    return { ok: false, error: "Could not assign that role." };
  }

  const { data: event } = await supabase
    .from("event")
    .select("name, owner_id")
    .eq("id", eventId)
    .maybeSingle();

  // A duplicate role is already assigned. Do not emit a second notification
  // or trigger another workflow execution for the same state transition.
  if (!error && userId !== session.userId) {
    await supabase.from("notification").insert({
      user_id: userId,
      organization_id: session.organizationId,
      category: "assignment",
      title: `You own ${role.replace(/_/g, " ")} for “${event?.name ?? "an event"}”`,
      source_type: "event",
      source_id: eventId,
      link: `/events/${eventId}`,
      dedupe_key: `event-role:${eventId}:${userId}:${role}`,
    });
  }

  if (!error && event) {
    await fireWorkflows(supabase, {
      organizationId: session.organizationId,
      actorId: session.userId,
      eventType: "event_assignment_created",
      title: `A member was assigned ${role.replace(/_/g, " ")} for “${event.name}”`,
      sourceType: "event",
      sourceId: eventId,
      link: `/events/${eventId}`,
      assigneeId: userId,
      eventOwnerId: event.owner_id,
    });
  }

  revalidatePath(`/events/${eventId}`);
  return { ok: true };
}

const statusSchema = z.object({
  eventId: z.string().uuid(),
  status: z.enum(["planning", "confirmed", "in_progress", "completed", "cancelled"]),
});

export async function updateEventStatus(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  if (!session.isStaff) return { ok: false, error: "Staff access required." };
  const parsed = statusSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input." };
  const supabase = await createSupabaseServerClient();
  const { data: existing } = await supabase
    .from("event")
    .select("id, owner_id, status")
    .eq("id", parsed.data.eventId)
    .maybeSingle();
  if (!existing) return { ok: false, error: "Event not found." };
  const { error } = await supabase
    .from("event")
    .update({ status: parsed.data.status })
    .eq("id", existing.id);
  if (error) return { ok: false, error: "Could not update the event." };
  if (parsed.data.status === "cancelled" && existing.status !== "cancelled") {
    try {
      await deleteGoogleEventRecord({
        organizationId: session.organizationId,
        userId: existing.owner_id,
        eventId: existing.id,
      });
    } catch (calendarError) {
      await markCalendarDegraded(
        supabase,
        session.organizationId,
        existing.owner_id,
        calendarError,
        "Calendar event cancellation failed.",
      );
    }
  }
  revalidatePath(`/events/${existing.id}`);
  revalidatePath("/events");
  revalidatePath("/calendar");
  return { ok: true };
}
