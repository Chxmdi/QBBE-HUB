"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { isEnabled } from "@/lib/feature-flags";
import { getLocale } from "@/lib/i18n/server";
import { createCan } from "@/lib/objects/can";
import { createActionRegistry } from "@/features/objects/actions/registry";
import { createSupabaseChangeSetStore } from "@/features/objects/actions/supabase-store";
import { createSupabaseObjectWriter } from "@/features/objects/actions/supabase-writer";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { appsMessages } from "../i18n";
import {
  appCapabilities,
  appCapabilityFor,
  appSlugPattern,
  starterAppDefinition,
  validateAppDefinition,
  type AppIssue,
} from "../schema";
import { canUseApp, getApp } from "./app.queries";

/**
 * App writes (V2-3). Each runs as the signed-in person: RLS on workspace_app
 * and workspace_app_grant, and the publish function, decide what is allowed.
 * Every command is off until `wos_objects` is on.
 */

export type AppResult<T = null> =
  | { ok: true; value: T }
  | { ok: false; error: string; issues?: AppIssue[] };

/** Slugs that are routes of their own under /apps. */
const RESERVED_SLUGS = new Set(["manage", "new"]);

// What the wire may carry. A Server Action is a public endpoint: the browser's
// types say nothing about what actually arrives, so every shape is checked
// here before it is read.
const uuid = z.string().uuid();
const text = z.string().max(5000);
const createSchema = z.object({ nameEn: text, nameFr: text, slug: z.string().max(100) });
const saveSchema = z.object({
  nameEn: text,
  nameFr: text,
  descriptionEn: text,
  descriptionFr: text,
  definition: z.unknown(),
});
const grantsSchema = z
  .array(z.object({ role: z.string().max(40), capabilities: z.array(z.string().max(40)).max(20) }))
  .max(20);
const runSchema = z.object({
  slug: z.string().max(100),
  actionKey: z.string().max(100),
  targets: z.array(uuid).max(500),
});

const ROLES = ["owner", "admin", "leadership_viewer", "staff", "volunteer", "guest"] as const;

async function context() {
  const session = await requireSession();
  const supabase = await createSupabaseServerClient();
  const messages = appsMessages(await getLocale());
  const enabled = await isEnabled("wos_objects", supabase);
  return { session, supabase, messages, enabled };
}

function databaseError(messages: ReturnType<typeof appsMessages>, error: { code?: string }): string {
  if (error.code === "42501") return messages.errors.forbidden;
  if (error.code === "23505") return messages.errors.slugTaken;
  return messages.errors.failed;
}

export async function createApp(input: { nameEn: string; nameFr: string; slug: string }): Promise<AppResult<{ id: string }>> {
  const { session, supabase, messages, enabled } = await context();
  if (!enabled) return { ok: false, error: messages.errors.disabled };
  const limited = await enforceRateLimit("app:write", session.userId);
  if (limited) return limited;
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: messages.errors.invalid };
  const slug = parsed.data.slug.trim();
  if (!appSlugPattern.test(slug)) return { ok: false, error: messages.errors.invalidSlug };
  if (RESERVED_SLUGS.has(slug)) return { ok: false, error: messages.errors.reservedSlug };
  const nameEn = parsed.data.nameEn.trim().slice(0, 80);
  const nameFr = parsed.data.nameFr.trim().slice(0, 80);
  if (!nameEn) return { ok: false, error: messages.errors.missingEnglish };
  if (!nameFr) return { ok: false, error: messages.errors.missingFrench };

  const { data, error } = await supabase
    .from("workspace_app")
    .insert({ organization_id: session.organizationId, slug, name_en: nameEn, name_fr: nameFr, definition: starterAppDefinition() })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: databaseError(messages, error ?? {}) };
  revalidatePath("/apps");
  return { ok: true, value: { id: data.id as string } };
}

export async function saveApp(
  id: string,
  input: { nameEn: string; nameFr: string; descriptionEn: string; descriptionFr: string; definition: unknown },
): Promise<AppResult> {
  const { session, supabase, messages, enabled } = await context();
  if (!enabled) return { ok: false, error: messages.errors.disabled };
  const limited = await enforceRateLimit("app:write", session.userId);
  if (limited) return limited;
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success || !uuid.safeParse(id).success) return { ok: false, error: messages.errors.invalid };
  const fields = parsed.data;
  const validation = validateAppDefinition(fields.definition);
  if (!validation.ok) return { ok: false, error: messages.errors.invalid, issues: validation.issues };
  if (!fields.nameEn.trim()) return { ok: false, error: messages.errors.missingEnglish };
  if (!fields.nameFr.trim()) return { ok: false, error: messages.errors.missingFrench };

  const { data, error } = await supabase
    .from("workspace_app")
    .update({
      name_en: fields.nameEn.trim().slice(0, 80),
      name_fr: fields.nameFr.trim().slice(0, 80),
      description_en: fields.descriptionEn.slice(0, 300),
      description_fr: fields.descriptionFr.slice(0, 300),
      definition: validation.app,
    })
    .eq("id", id)
    .select("id");
  if (error) return { ok: false, error: databaseError(messages, error) };
  if (!data?.length) return { ok: false, error: messages.errors.forbidden };
  revalidatePath("/apps", "layout");
  return { ok: true, value: null };
}

/** Replaces the app's role grants with the table the admin ticked. */
export async function saveRoleGrants(
  appId: string,
  grants: { role: string; capabilities: string[] }[],
): Promise<AppResult> {
  const { session, supabase, messages, enabled } = await context();
  if (!enabled) return { ok: false, error: messages.errors.disabled };
  const limited = await enforceRateLimit("app:write", session.userId);
  if (limited) return limited;
  const parsedGrants = grantsSchema.safeParse(grants);
  if (!parsedGrants.success || !uuid.safeParse(appId).success) return { ok: false, error: messages.errors.invalid };
  const clean = parsedGrants.data
    .filter((g) => (ROLES as readonly string[]).includes(g.role))
    .map((g) => ({
      role: g.role,
      capabilities: appCapabilities.filter((c) => g.capabilities.includes(c)),
    }))
    .filter((g) => g.capabilities.length > 0);

  const { error: removeError } = await supabase
    .from("workspace_app_grant")
    .delete()
    .eq("app_id", appId)
    .not("org_role", "is", null);
  if (removeError) return { ok: false, error: databaseError(messages, removeError) };
  if (clean.length) {
    const { error } = await supabase.from("workspace_app_grant").insert(
      clean.map((g) => ({
        organization_id: session.organizationId,
        app_id: appId,
        org_role: g.role,
        capabilities: g.capabilities,
      })),
    );
    if (error) return { ok: false, error: databaseError(messages, error) };
  }
  revalidatePath("/apps", "layout");
  return { ok: true, value: null };
}

export async function setAppPublished(appId: string, published: boolean): Promise<AppResult> {
  const { session, supabase, messages, enabled } = await context();
  if (!enabled) return { ok: false, error: messages.errors.disabled };
  const limited = await enforceRateLimit("app:write", session.userId);
  if (limited) return limited;
  if (!uuid.safeParse(appId).success) return { ok: false, error: messages.errors.notFound };
  const { error } = await supabase.rpc("workspace_app_set_published", { p_app: appId, p_published: published === true });
  if (error) return { ok: false, error: databaseError(messages, error) };
  revalidatePath("/apps", "layout");
  return { ok: true, value: null };
}

export async function deleteApp(appId: string): Promise<AppResult> {
  const { session, supabase, messages, enabled } = await context();
  if (!enabled) return { ok: false, error: messages.errors.disabled };
  const limited = await enforceRateLimit("app:write", session.userId);
  if (limited) return limited;
  if (!uuid.safeParse(appId).success) return { ok: false, error: messages.errors.notFound };
  const { data, error } = await supabase.from("workspace_app").delete().eq("id", appId).select("id");
  if (error) return { ok: false, error: databaseError(messages, error) };
  if (!data?.length) return { ok: false, error: messages.errors.forbidden };
  revalidatePath("/apps");
  return { ok: true, value: null };
}

/**
 * Runs one of the app's actions on the given records. Two gates: the person
 * needs the action's capability on this app, and the action registry checks
 * it again on every target (plan A8). The registry is the persisted one
 * (M13); no app-level action is registered on it yet, so a run answers "not
 * yet" honestly until the app screens wire their actions in.
 */
export async function runAppAction(slug: string, actionKey: string, targets: string[]): Promise<AppResult> {
  const { session, supabase, messages, enabled } = await context();
  const t = messages.runAction;
  if (!enabled) return { ok: false, error: messages.errors.disabled };
  const parsed = runSchema.safeParse({ slug, actionKey, targets });
  if (!parsed.success) return { ok: false, error: messages.errors.invalid };
  const app = await getApp(supabase, session.organizationId, { slug: parsed.data.slug });
  const validation = app ? validateAppDefinition(app.definition) : null;
  const action = validation?.ok ? validation.app.actions.find((a) => a.key === actionKey) : undefined;
  if (!app || !action) return { ok: false, error: messages.errors.notFound };
  if (!(await canUseApp(supabase, app.id, appCapabilityFor(action.capability)))) {
    return { ok: false, error: t.forbidden };
  }

  const registry = createActionRegistry({
    store: createSupabaseChangeSetStore(supabase),
    writer: createSupabaseObjectWriter(supabase),
  });
  const result = await registry.run(action.actionKey, { targets }, {
    actor: { kind: "person", id: session.userId },
    can: createCan(supabase),
  });
  if (result.ok) return { ok: true, value: null };
  if (result.reason === "unknown_action") return { ok: false, error: t.notYet };
  if (result.reason === "forbidden") return { ok: false, error: t.forbidden };
  return { ok: false, error: t.failed };
}
