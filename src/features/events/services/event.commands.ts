"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/features/tasks/services/task.commands";

const createEventSchema = z.object({
  name: z.string().trim().min(1, "An event needs a name.").max(200),
  description: z.string().trim().max(5000).optional(),
  programId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
  eventType: z.string().trim().max(60).optional(),
  startsAt: z.string().min(1, "Pick a start time."),
  endsAt: z.string().optional(),
  location: z.string().trim().max(300).optional(),
  volunteerNeed: z.coerce.number().int().min(0).max(500).optional(),
});

export async function createEvent(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  if (!session.isStaff) return { ok: false, error: "Staff access required." };
  const parsed = createEventSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const data = parsed.data;
  const starts = new Date(data.startsAt);
  if (Number.isNaN(starts.getTime())) return { ok: false, error: "Invalid start time." };

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
      ends_at: data.endsAt ? new Date(data.endsAt).toISOString() : null,
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

  revalidatePath("/events");
  return { ok: true, id: event.id as string };
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

  if (userId !== session.userId) {
    const { data: event } = await supabase
      .from("event")
      .select("name")
      .eq("id", eventId)
      .maybeSingle();
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
  const { error } = await supabase
    .from("event")
    .update({ status: parsed.data.status })
    .eq("id", parsed.data.eventId);
  if (error) return { ok: false, error: "Could not update the event." };
  revalidatePath(`/events/${parsed.data.eventId}`);
  revalidatePath("/events");
  return { ok: true };
}
