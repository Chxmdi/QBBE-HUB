"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/features/tasks/services/task.commands";
import {
  createMetricSchema,
  recordMeasurementSchema,
  recordOperationSchema,
} from "@/features/outcomes/schemas";

/**
 * Recording delivery and measurement.
 *
 * No role checks here: `operation_manage`, `metric_manage` and
 * `measurement_manage` are the boundary, and a second copy of those rules in
 * TypeScript is a second place for them to drift. A volunteer's insert fails
 * at the database and returns a permission message.
 */

export async function recordOperation(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = recordOperationSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const data = parsed.data;

  const supabase = await createSupabaseServerClient();
  const { data: created, error } = await supabase
    .from("program_operation")
    .insert({
      organization_id: session.organizationId,
      program_id: data.programId,
      project_id: data.projectId || null,
      title: data.title,
      occurred_on: data.occurredOn,
      location: data.location || null,
      status: data.status,
      attendee_count: data.attendeeCount ?? null,
      volunteer_count: data.volunteerCount ?? null,
      duration_hours: data.durationHours ?? null,
      staff_hours: data.staffHours ?? null,
      led_by: data.ledBy || null,
      notes: data.notes || null,
      cancellation_reason: data.cancellationReason || null,
      created_by: session.userId,
    })
    .select("id")
    .single();

  if (error || !created) {
    return {
      ok: false,
      error: "You don't have permission to record delivery for this program.",
    };
  }

  revalidatePath(`/programs/${data.programId}`);
  return { ok: true, id: created.id as string };
}

export async function createOutcomeMetric(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = createMetricSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const data = parsed.data;

  const supabase = await createSupabaseServerClient();
  const { data: created, error } = await supabase
    .from("outcome_metric")
    .insert({
      organization_id: session.organizationId,
      program_id: data.programId,
      name: data.name,
      description: data.description || null,
      unit: data.unit,
      direction: data.direction,
      baseline: data.baseline ?? null,
      baseline_on: data.baselineOn || null,
      target: data.target ?? null,
      target_on: data.targetOn || null,
      owner_id: data.ownerId || null,
      created_by: session.userId,
    })
    .select("id")
    .single();

  if (error || !created) {
    return {
      ok: false,
      error: "You don't have permission to set outcomes for this program.",
    };
  }

  revalidatePath(`/programs/${data.programId}`);
  return { ok: true, id: created.id as string };
}

export async function recordMeasurement(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = recordMeasurementSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const data = parsed.data;

  const supabase = await createSupabaseServerClient();
  const { data: metric } = await supabase
    .from("outcome_metric")
    .select("id, program_id")
    .eq("id", data.metricId)
    .maybeSingle();

  if (!metric) {
    return { ok: false, error: "That metric is not available to you." };
  }

  const { error } = await supabase.from("outcome_measurement").insert({
    organization_id: session.organizationId,
    metric_id: data.metricId,
    measured_on: data.measuredOn,
    value: data.value,
    source: data.source || null,
    sample_size: data.sampleSize ?? null,
    note: data.note || null,
    recorded_by: session.userId,
  });

  if (error) {
    // One reading per metric per day is a unique index. A second one for the
    // same date is a correction, and saying so is more use than "save failed".
    if (error.code === "23505") {
      return {
        ok: false,
        error:
          "There is already a reading for that date. Change the date, or delete the existing one first.",
      };
    }
    return { ok: false, error: "That measurement could not be recorded." };
  }

  revalidatePath(`/programs/${metric.program_id}`);
  return { ok: true, id: data.metricId };
}

export async function retireMetric(metricId: string): Promise<ActionResult> {
  await requireSession();
  const supabase = await createSupabaseServerClient();

  const { data: updated, error } = await supabase
    .from("outcome_metric")
    .update({ retired_at: new Date().toISOString() })
    .eq("id", metricId)
    .select("id, program_id");

  if (error || (updated ?? []).length === 0) {
    return { ok: false, error: "You don't have permission to retire that metric." };
  }

  // Retired rather than deleted: the readings taken against it are evidence,
  // and a funder may ask about a measure that was dropped.
  revalidatePath(`/programs/${updated![0].program_id}`);
  return { ok: true, id: metricId };
}
