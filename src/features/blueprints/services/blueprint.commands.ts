"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { isEnabled } from "@/lib/feature-flags";
import { getLocale } from "@/lib/i18n/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { blueprintsMessages, fill } from "../i18n";
import { findConflicts } from "../plan";
import { validateBlueprint, type Blueprint, type BlueprintIssue } from "../schema";
import { applyBlueprintBuild, undoBlueprintChanges, type BuildFailure } from "./blueprint.build";
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
  if (/Only owners and admins|Only an owner or admin/.test(text)) return messages.errors.forbidden;
  if (/rollup/i.test(text) && /number property|private property|relation property/.test(text)) {
    return messages.errors.rollupNeedsNumber;
  }
  return messages.errors.failed;
}

function buildError(messages: Messages, failure: BuildFailure): string {
  if (failure.code === "propertyKindClash") return fill(messages.errors.propertyKindClash, { key: failure.key });
  if (failure.code === "propertyClash") return fill(messages.errors.propertyClash, { key: failure.key });
  if (failure.code === "relationClash") {
    return fill(messages.errors.conflict, { kind: messages.errors.conflictKinds.relation, key: failure.key });
  }
  if (failure.code === "typeNotCustom") {
    return fill(messages.errors.conflict, { kind: messages.errors.conflictKinds.type, key: failure.key });
  }
  return databaseError(messages, failure.error);
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
  const limited = await enforceRateLimit("blueprint:write", session.userId);
  if (limited) return limited;

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
  const limited = await enforceRateLimit("blueprint:build", session.userId);
  if (limited) return limited;
  const blueprint = await getBlueprint(supabase, id);
  if (!blueprint) return { ok: false, error: messages.errors.notFound };
  const validation = validateBlueprint(blueprint.definition);
  if (!validation.ok) return { ok: false, error: messages.approve.fixFirst, issues: validation.issues };

  // Building writes real structure, so refuse before writing anything when the
  // blueprint is not approved as it stands (an edit after approval sends it
  // back to draft). public.blueprint_build checks the approved hash again.
  if (blueprint.status !== "approved") return { ok: false, error: messages.errors.notApproved };

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

  return applyPlan(supabase, messages, blueprint.id, session.organizationId, validation.blueprint);
}

/**
 * Creates the blueprint's types, relations and properties for real (formulas
 * and rollups included) and records the change set. A failure part-way is
 * rolled back before it is reported; see blueprint.build.ts.
 */
async function applyPlan(
  supabase: Supabase,
  messages: Messages,
  id: string,
  organizationId: string,
  blueprint: Blueprint,
): Promise<BlueprintResult<{ changeSetId: string; count: number }>> {
  const result = await applyBlueprintBuild(supabase, { blueprintId: id, organizationId, blueprint });
  if (!result.ok) {
    const reason = buildError(messages, result.failure);
    return { ok: false, error: result.rolledBack ? reason : fill(messages.errors.buildRolledBack, { reason }) };
  }
  refresh(id);
  return { ok: true, value: { changeSetId: result.changeSetId, count: result.count } };
}

/** Removes (archives) everything the build created, newest first, then marks it undone. */
export async function undoBlueprintBuild(blueprintId: string, changeSetId: string): Promise<BlueprintResult> {
  const { supabase, messages, enabled } = await context();
  if (!enabled) return { ok: false, error: messages.errors.disabled };
  const result = await undoBlueprintChanges(supabase, changeSetId);
  if (!result.ok) {
    const reason = databaseError(messages, result.error);
    return { ok: false, error: result.restored ? reason : fill(messages.errors.undoIncomplete, { reason }) };
  }
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
