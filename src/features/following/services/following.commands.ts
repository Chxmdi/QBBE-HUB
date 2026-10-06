"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { isEnabled } from "@/lib/feature-flags";
import { getLocale } from "@/lib/i18n/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { FOLLOWING_FLAG } from "@/features/following/gate";
import { followingText } from "@/features/following/messages";
import {
  EVENT_KINDS,
  PRESET_QUERIES,
  RULE_CHOICES,
  ruleFromChoice,
  type EventKind,
  type PresetQueryKey,
  type RuleChoice,
} from "@/features/following/rules";

export type FollowingResult = { ok: true } | { ok: false; error: string };

async function messages() {
  return followingText(await getLocale());
}

async function guard() {
  const m = await messages();
  if (!(await isEnabled(FOLLOWING_FLAG))) return { m, blocked: m.errors.forbidden };
  return { m, blocked: null };
}

const uuid = z.string().uuid();

/** Follow a task or project. The database refuses anything the person cannot see. */
export async function followObject(objectId: string, objectType: "task" | "project"): Promise<FollowingResult> {
  const { m, blocked } = await guard();
  if (blocked) return { ok: false, error: blocked };
  const session = await requireSession();
  if (!uuid.safeParse(objectId).success || !["task", "project"].includes(objectType)) {
    return { ok: false, error: m.errors.generic };
  }
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("follow_v2")
    .insert({ organization_id: session.organizationId, object_id: objectId, object_type: objectType });
  if (error) {
    if (error.code === "23505") return { ok: false, error: m.errors.already };
    return { ok: false, error: error.code === "42501" ? m.errors.cannotSee : m.errors.generic };
  }
  revalidatePath("/following");
  return { ok: true };
}

export async function followPresetQuery(key: PresetQueryKey): Promise<FollowingResult> {
  const { m, blocked } = await guard();
  if (blocked) return { ok: false, error: blocked };
  const session = await requireSession();
  if (!(key in PRESET_QUERIES)) return { ok: false, error: m.errors.generic };
  const supabase = await createSupabaseServerClient();
  const { data: existing } = await supabase.from("follow_v2").select("id").eq("label", key).limit(1);
  if (existing?.length) return { ok: false, error: m.errors.already };
  const { error } = await supabase
    .from("follow_v2")
    .insert({ organization_id: session.organizationId, query_spec: PRESET_QUERIES[key], label: key });
  if (error) return { ok: false, error: m.errors.generic };
  revalidatePath("/following");
  return { ok: true };
}

export async function unfollow(followId: string): Promise<FollowingResult> {
  const { m, blocked } = await guard();
  if (blocked) return { ok: false, error: blocked };
  await requireSession();
  if (!uuid.safeParse(followId).success) return { ok: false, error: m.errors.generic };
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("follow_v2").delete().eq("id", followId).select("id");
  if (error || !data?.length) return { ok: false, error: m.errors.generic };
  revalidatePath("/following");
  return { ok: true };
}

export async function saveFollowRules(choices: Partial<Record<EventKind, RuleChoice>>): Promise<FollowingResult> {
  const { m, blocked } = await guard();
  if (blocked) return { ok: false, error: blocked };
  const session = await requireSession();
  const rows = EVENT_KINDS.filter((kind) => RULE_CHOICES.includes(choices[kind] as RuleChoice)).map((kind) => ({
    user_id: session.userId,
    organization_id: session.organizationId,
    event_kind: kind,
    ...ruleFromChoice(choices[kind] as RuleChoice),
  }));
  if (rows.length === 0) return { ok: false, error: m.errors.generic };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("follow_rule_v2").upsert(rows, { onConflict: "user_id,event_kind" });
  if (error) return { ok: false, error: m.errors.generic };
  revalidatePath("/following");
  return { ok: true };
}
