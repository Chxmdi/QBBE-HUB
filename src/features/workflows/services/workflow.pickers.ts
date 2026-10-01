"use server";

import { z } from "zod";
import { authorizeAdminAction } from "@/lib/auth";
import { isEnabled } from "@/lib/feature-flags";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { recordTitleSource, searchableTypes } from "../picker-options";

/**
 * Searches for the workflow pickers (U10): records by title and active
 * members by name. Through the admin's own session, so RLS and the
 * permission-safe global_search decide what comes back. Admins only, while
 * wos_workflows_v2 is on; anyone else gets an empty list.
 */

export interface PickerOption {
  id: string;
  label: string;
  description: string;
}

const recordSearchSchema = z.object({
  type: z.string().trim().min(1).max(64),
  query: z.string().trim().max(200).default(""),
});
const personSearchSchema = z.object({ query: z.string().trim().max(200).default("") });
const idsSchema = z.array(z.string().uuid()).max(50);
const recordTitleSchema = z.object({ type: z.string().trim().min(1).max(64), id: z.string().uuid() });

async function allowed(): Promise<boolean> {
  if (!(await isEnabled("wos_workflows_v2"))) return false;
  return (await authorizeAdminAction()).ok;
}

export async function searchRecords(input: unknown): Promise<PickerOption[]> {
  const parsed = recordSearchSchema.safeParse(input);
  if (!parsed.success || !(await allowed())) return [];
  if (!(searchableTypes as readonly string[]).includes(parsed.data.type)) return [];
  const db = await createSupabaseServerClient();
  // global_search takes rows from each type in turn up to p_limit, so ask for
  // enough rows that one type can fill the picker.
  const { data, error } = await db.rpc("global_search", { p_query: parsed.data.query, p_limit: 240 });
  if (error) return [];
  return ((data ?? []) as { result_type: string; id: string; title: string; snippet: string | null }[])
    .filter((row) => row.result_type === parsed.data.type)
    .slice(0, 12)
    .map((row) => ({ id: row.id, label: row.title, description: row.snippet ?? "" }));
}

export async function searchPeople(input: unknown): Promise<PickerOption[]> {
  const parsed = personSearchSchema.safeParse(input);
  if (!parsed.success) return [];
  if (!(await isEnabled("wos_workflows_v2"))) return [];
  const authorization = await authorizeAdminAction();
  if (!authorization.ok) return [];
  const db = await createSupabaseServerClient();
  const pattern = `%${parsed.data.query.replace(/[%_\\]/g, "\\$&")}%`;
  const { data } = await db
    .from("organization_membership")
    .select("user_id, user_profile:user_id!inner(id, full_name, email)")
    .eq("organization_id", authorization.session.organizationId)
    .eq("status", "active")
    .ilike("user_profile.full_name", pattern)
    .limit(12);
  return ((data ?? []) as unknown as { user_profile: { id: string; full_name: string; email: string | null } | null }[])
    .filter((row) => row.user_profile)
    .map((row) => ({ id: row.user_profile!.id, label: row.user_profile!.full_name, description: row.user_profile!.email ?? "" }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** Names for ids a saved workflow holds, so a picker can show who was chosen. */
export async function peopleByIds(input: unknown): Promise<PickerOption[]> {
  const parsed = idsSchema.safeParse(input);
  if (!parsed.success || parsed.data.length === 0) return [];
  if (!(await isEnabled("wos_workflows_v2"))) return [];
  const authorization = await authorizeAdminAction();
  if (!authorization.ok) return [];
  const db = await createSupabaseServerClient();
  const { data } = await db
    .from("organization_membership")
    .select("user_id, user_profile:user_id!inner(id, full_name, email)")
    .eq("organization_id", authorization.session.organizationId)
    .in("user_id", parsed.data);
  return ((data ?? []) as unknown as { user_profile: { id: string; full_name: string; email: string | null } | null }[])
    .filter((row) => row.user_profile)
    .map((row) => ({ id: row.user_profile!.id, label: row.user_profile!.full_name, description: row.user_profile!.email ?? "" }));
}

/** The title of one record a saved workflow names, read through RLS; null when hidden or gone. */
export async function recordTitle(input: unknown): Promise<string | null> {
  const parsed = recordTitleSchema.safeParse(input);
  if (!parsed.success || !(await allowed())) return null;
  const source = recordTitleSource[parsed.data.type as keyof typeof recordTitleSource];
  if (!source) return null;
  const db = await createSupabaseServerClient();
  const { data, error } = await db.from(source.table).select(source.title).eq("id", parsed.data.id).maybeSingle();
  if (error || !data) return null;
  const title = (data as unknown as Record<string, unknown>)[source.title];
  return typeof title === "string" && title ? title : null;
}
