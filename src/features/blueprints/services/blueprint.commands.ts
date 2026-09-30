"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { isEnabled } from "@/lib/feature-flags";
import { getLocale } from "@/lib/i18n/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { blueprintsMessages, fill } from "../i18n";
import { findConflicts, planBlueprint } from "../plan";
import { validateBlueprint, type BlueprintIssue } from "../schema";
import { existingKeys, getBlueprint } from "./blueprint.queries";

/**
 * Blueprint writes (V2-2). Each runs as the signed-in person, so RLS and the
 * approve / build / undo functions decide what is allowed; the checks here only
 * give a clearer message first. Every command is off until `wos_objects` is on.
 */

export type BlueprintResult<T = null> =
  | { ok: true; value: T }
  | { ok: false; error: string; issues?: BlueprintIssue[] };

type Supabase = Awaited<ReturnType<typeof createSupabaseServerClient>>;

async function context() {
  const session = await requireSession();
  const supabase = await createSupabaseServerClient();
  const messages = blueprintsMessages(await getLocale());
  const enabled = await isEnabled("wos_objects", supabase);
  return { session, supabase, messages, enabled };
}

type Messages = ReturnType<typeof blueprintsMessages>;

/** Turns a database refusal into the sentence the person should read. */
function databaseError(messages: Messages, error: { code?: string; message?: string }): string {
  const text = error.message ?? "";
  if (error.code === "42501") return messages.errors.forbidden;
  if (error.code === "23505") {
    const clash = /already has "([^"]+)"/.exec(text);
    if (clash) return fill(messages.errors.conflict, { kind: messages.errors.conflictKinds.type, key: clash[1] });
    return messages.errors.keyTaken;
  }
  if (/Approve the blueprint/.test(text)) return messages.errors.notApproved;
  if (/already undone/.test(text)) return messages.errors.alreadyUndone;
  if (/30 days/.test(text)) return messages.errors.tooOld;
  if (/built blueprint|Undo the build/.test(text)) return messages.errors.locked;
  return messages.errors.failed;
}

function refresh(id?: string) {
  revalidatePath("/builder");
  if (id) revalidatePath(`/builder/${id}`);
}

/** Creates a draft (no id) or saves an existing one. Drafts may be invalid. */
export async function saveBlueprint(
  id: string | null,
  definition: unknown,
): Promise<BlueprintResult<{ id: string; issues: BlueprintIssue[] }>> {
  const { session, supabase, messages, enabled } = await context();
  if (!enabled) return { ok: false, error: messages.errors.disabled };

  const draft = definition as { key?: unknown; name?: { en?: unknown; fr?: unknown } };
  const key = typeof draft?.key === "string" ? draft.key : "";
  const nameEn = typeof draft?.name?.en === "string" ? draft.name.en.trim() : "";
  const nameFr = typeof draft?.name?.fr === "string" ? draft.name.fr.trim() : "";
  const validation = validateBlueprint(definition);
  const issues = validation.ok ? [] : validation.issues;
  if (!/^[a-z][a-z0-9_]{0,47}$/.test(key) || !nameEn || !nameFr) {
    return { ok: false, error: messages.errors.invalid, issues };
  }

  const row = { key, name_en: nameEn.slice(0, 120), name_fr: nameFr.slice(0, 120), definition };
  const { data, error } = id
    ? await supabase.from("blueprint").update(row).eq("id", id).select("id").maybeSingle()
    : await supabase
        .from("blueprint")
        .insert({ ...row, organization_id: session.organizationId })
        .select("id")
        .single();
  if (error) return { ok: false, error: databaseError(messages, error) };
  if (!data) return { ok: false, error: messages.errors.forbidden };
  refresh(data.id);
  return { ok: true, value: { id: data.id as string, issues } };
}

export async function approveBlueprint(id: string): Promise<BlueprintResult> {
  const { supabase, messages, enabled } = await context();
  if (!enabled) return { ok: false, error: messages.errors.disabled };
  const blueprint = await getBlueprint(supabase, id);
  if (!blueprint) return { ok: false, error: messages.errors.notFound };
  const validation = validateBlueprint(blueprint.definition);
  if (!validation.ok) return { ok: false, error: messages.approve.fixFirst, issues: validation.issues };

  const { error } = await supabase.rpc("blueprint_approve", { p_blueprint: id });
  if (error) return { ok: false, error: databaseError(messages, error) };
  refresh(id);
  return { ok: true, value: null };
}

/** Plans the approved definition and applies it as one change set. */
export async function buildBlueprint(id: string): Promise<BlueprintResult<{ changeSetId: string; count: number }>> {
  const { session, supabase, messages, enabled } = await context();
  if (!enabled) return { ok: false, error: messages.errors.disabled };
  const blueprint = await getBlueprint(supabase, id);
  if (!blueprint) return { ok: false, error: messages.errors.notFound };
  const validation = validateBlueprint(blueprint.definition);
  if (!validation.ok) return { ok: false, error: messages.approve.fixFirst, issues: validation.issues };

  const conflicts = findConflicts(
    validation.blueprint,
    await existingKeys(supabase, session.organizationId, blueprint.id),
  );
  if (conflicts.length) {
    const [first] = conflicts;
    return {
      ok: false,
      error: fill(messages.errors.conflict, { kind: messages.errors.conflictKinds[first.kind], key: first.key }),
    };
  }

  return applyPlan(supabase, messages, blueprint.id, validation.blueprint);
}

async function applyPlan(
  supabase: Supabase,
  messages: Messages,
  id: string,
  blueprint: Parameters<typeof planBlueprint>[0],
): Promise<BlueprintResult<{ changeSetId: string; count: number }>> {
  const plan = planBlueprint(blueprint);
  const { data, error } = await supabase.rpc("blueprint_build", {
    p_blueprint: id,
    p_changes: plan.changes,
    p_counts: plan.counts,
  });
  if (error || typeof data !== "string") return { ok: false, error: databaseError(messages, error ?? {}) };
  refresh(id);
  return { ok: true, value: { changeSetId: data, count: plan.changes.length } };
}

export async function undoBlueprintBuild(blueprintId: string, changeSetId: string): Promise<BlueprintResult> {
  const { supabase, messages, enabled } = await context();
  if (!enabled) return { ok: false, error: messages.errors.disabled };
  const { error } = await supabase.rpc("blueprint_undo_build", { p_change_set: changeSetId });
  if (error) return { ok: false, error: databaseError(messages, error) };
  refresh(blueprintId);
  return { ok: true, value: null };
}

export async function deleteBlueprint(id: string): Promise<BlueprintResult> {
  const { supabase, messages, enabled } = await context();
  if (!enabled) return { ok: false, error: messages.errors.disabled };
  const { data, error } = await supabase.from("blueprint").delete().eq("id", id).select("id");
  if (error) return { ok: false, error: databaseError(messages, error) };
  if (!data?.length) return { ok: false, error: messages.errors.forbidden };
  refresh();
  return { ok: true, value: null };
}
