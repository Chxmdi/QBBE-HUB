"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { getLocale } from "@/lib/i18n/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { decisionsV2Enabled } from "../flag";
import { decisionsV2T } from "../i18n";
import { parseOptions } from "../revisit";

export interface CommandResult {
  ok: boolean;
  error?: string;
  message?: string;
}

async function translator() {
  return decisionsV2T(await getLocale());
}

async function guard(): Promise<CommandResult | null> {
  if (await decisionsV2Enabled()) return null;
  return { ok: false, error: (await translator())("errors.notFound") };
}

const text = z.string().trim().max(4000).optional();

const recordSchema = z.object({
  decisionId: z.string().uuid(),
  title: z.string().trim().min(1).max(300),
  problem: text,
  options: z.string().max(12000).optional(),
  evidence: text,
  reasoning: text,
  revisitOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .or(z.literal("").transform(() => undefined)),
});

/** Saves the full record. decision_scoped_write decides who may. */
export async function saveDecisionRecord(input: unknown): Promise<CommandResult> {
  const blocked = await guard();
  if (blocked) return blocked;
  await requireSession();
  const t = await translator();
  const parsed = recordSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: t("errors.invalidInput") };
  const data = parsed.data;

  const supabase = await createSupabaseServerClient();
  const { data: updated, error } = await supabase
    .from("decision")
    .update({
      title: data.title,
      problem: data.problem || null,
      options_considered: parseOptions(data.options ?? ""),
      evidence: data.evidence || null,
      reasoning: data.reasoning || null,
      revisit_on: data.revisitOn ?? null,
    })
    .eq("id", data.decisionId)
    .select("id, project_id");
  if (error || !updated || updated.length === 0) return { ok: false, error: t("form.error") };
  revalidatePath(`/decisions/${data.decisionId}`);
  const projectId = updated[0].project_id as string | null;
  if (projectId) revalidatePath(`/decisions/trail/${projectId}`);
  return { ok: true, message: t("form.saved") };
}

const participantSchema = z.object({ decisionId: z.string().uuid(), userId: z.string().uuid() });

export async function addDecisionParticipant(input: unknown): Promise<CommandResult> {
  const blocked = await guard();
  if (blocked) return blocked;
  await requireSession();
  const t = await translator();
  const parsed = participantSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: t("errors.invalidInput") };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("decision_participant")
    .insert({ decision_id: parsed.data.decisionId, user_id: parsed.data.userId });
  // Adding someone already there is not an error worth showing.
  if (error && error.code !== "23505") return { ok: false, error: t("participants.error") };
  revalidatePath(`/decisions/${parsed.data.decisionId}`);
  return { ok: true };
}

export async function removeDecisionParticipant(input: unknown): Promise<CommandResult> {
  const blocked = await guard();
  if (blocked) return blocked;
  await requireSession();
  const t = await translator();
  const parsed = participantSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: t("errors.invalidInput") };
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("decision_participant")
    .delete()
    .eq("decision_id", parsed.data.decisionId)
    .eq("user_id", parsed.data.userId)
    .select("user_id");
  if (error || !data || data.length === 0) return { ok: false, error: t("participants.error") };
  revalidatePath(`/decisions/${parsed.data.decisionId}`);
  return { ok: true };
}
