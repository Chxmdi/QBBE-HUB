"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { getLocale } from "@/lib/i18n/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { goalsEnabled } from "../flag";
import { goalsT } from "../i18n";

export interface CommandResult {
  ok: boolean;
  id?: string;
  error?: string;
}

async function translator() {
  return goalsT(await getLocale());
}

async function guard(): Promise<CommandResult | null> {
  if (await goalsEnabled()) return null;
  return { ok: false, error: (await translator())("errors.notFound") };
}

const optionalUuid = z.string().uuid().optional().or(z.literal("").transform(() => undefined));

const createSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(4000).optional(),
  programId: optionalUuid,
  ownerId: optionalUuid,
  targetOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("").transform(() => undefined)),
});

/** RLS decides who may: administrators, or managers of the chosen program. */
export async function createGoal(input: unknown): Promise<CommandResult> {
  const blocked = await guard();
  if (blocked) return blocked;
  const session = await requireSession();
  const t = await translator();
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: t("errors.invalidInput") };
  const data = parsed.data;
  const supabase = await createSupabaseServerClient();
  const { data: row, error } = await supabase
    .from("goal")
    .insert({
      organization_id: session.organizationId,
      program_id: data.programId ?? null,
      title: data.title,
      description: data.description || null,
      owner_id: data.ownerId ?? null,
      target_on: data.targetOn ?? null,
    })
    .select("id")
    .single();
  if (error || !row) return { ok: false, error: t("create.error") };
  revalidatePath("/goals");
  return { ok: true, id: row.id as string };
}

const statusSchema = z.object({ goalId: z.string().uuid(), status: z.enum(["active", "achieved", "dropped"]) });

export async function setGoalStatus(input: unknown): Promise<CommandResult> {
  const blocked = await guard();
  if (blocked) return blocked;
  await requireSession();
  const t = await translator();
  const parsed = statusSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: t("errors.invalidInput") };
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("goal")
    .update({ status: parsed.data.status })
    .eq("id", parsed.data.goalId)
    .select("id");
  if (error || !data || data.length === 0) return { ok: false, error: t("errors.notFound") };
  revalidatePath(`/goals/${parsed.data.goalId}`);
  revalidatePath("/goals");
  return { ok: true };
}

const linkSchema = z.object({
  goalId: z.string().uuid(),
  kind: z.enum(["project", "metric"]),
  refId: z.string().uuid(),
});

export async function linkToGoal(input: unknown): Promise<CommandResult> {
  const blocked = await guard();
  if (blocked) return blocked;
  await requireSession();
  const t = await translator();
  const parsed = linkSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: t("errors.invalidInput") };
  const { goalId, kind, refId } = parsed.data;
  const supabase = await createSupabaseServerClient();
  const { error } =
    kind === "project"
      ? await supabase.from("goal_project").insert({ goal_id: goalId, project_id: refId })
      : await supabase.from("goal_metric").insert({ goal_id: goalId, metric_id: refId });
  if (error && error.code !== "23505") return { ok: false, error: t("links.error") };
  revalidatePath(`/goals/${goalId}`);
  return { ok: true };
}

export async function unlinkFromGoal(input: unknown): Promise<CommandResult> {
  const blocked = await guard();
  if (blocked) return blocked;
  await requireSession();
  const t = await translator();
  const parsed = linkSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: t("errors.invalidInput") };
  const { goalId, kind, refId } = parsed.data;
  const supabase = await createSupabaseServerClient();
  const { data, error } =
    kind === "project"
      ? await supabase.from("goal_project").delete().eq("goal_id", goalId).eq("project_id", refId).select("goal_id")
      : await supabase.from("goal_metric").delete().eq("goal_id", goalId).eq("metric_id", refId).select("goal_id");
  if (error || !data || data.length === 0) return { ok: false, error: t("links.error") };
  revalidatePath(`/goals/${goalId}`);
  return { ok: true };
}
