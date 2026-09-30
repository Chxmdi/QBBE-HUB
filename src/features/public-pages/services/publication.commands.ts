"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorizeAdminAction } from "@/lib/auth";
import { isEnabled } from "@/lib/feature-flags";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getPublicPagesT } from "../i18n";
import { SLUG_PATTERN } from "./publication";

export interface PublishActionState {
  ok: boolean;
  message: string | null;
}

async function guard() {
  const t = await getPublicPagesT();
  if (!(await isEnabled("wos_public_pages"))) return { t, error: t("errors.failed") } as const;
  const authorization = await authorizeAdminAction();
  if (!authorization.ok) return { t, error: t("errors.forbidden") } as const;
  return { t } as const;
}

function failure(error: { code?: string; message?: string }, t: Awaited<ReturnType<typeof getPublicPagesT>>): PublishActionState {
  if (error.code === "23505") return { ok: false, message: t("errors.taken") };
  if (error.code === "42501" && /another owner/i.test(error.message ?? "")) return { ok: false, message: t("errors.own") };
  if (error.code === "42501") return { ok: false, message: t("errors.forbidden") };
  if (error.code === "23514") return { ok: false, message: t("errors.invalid") };
  return { ok: false, message: t("errors.failed") };
}

const requestSchema = z.object({
  sourceId: z.string().uuid(),
  slug: z.string().trim().toLowerCase().regex(SLUG_PATTERN),
  fields: z.array(z.string().min(1).max(100)).min(1).max(50),
});

/** Asks to publish; the database checks who may and what may be published. */
export async function requestPublication(_previous: PublishActionState, form: FormData): Promise<PublishActionState> {
  const checked = await guard();
  if ("error" in checked) return { ok: false, message: checked.error ?? null };
  const { t } = checked;
  const parsed = requestSchema.safeParse({
    sourceId: form.get("sourceId"),
    slug: form.get("slug") ?? "",
    fields: form.getAll("fields").map(String),
  });
  if (!parsed.success) return { ok: false, message: t("errors.invalid") };
  const db = await createSupabaseServerClient();
  const { error } = await db.rpc("publication_request", {
    object_id: parsed.data.sourceId,
    slug: parsed.data.slug,
    fields: parsed.data.fields,
  });
  if (error) return failure(error, t);
  revalidatePath("/spaces/publish");
  return { ok: true, message: t("ask.sent") };
}

const reviewSchema = z.object({
  publicationId: z.string().uuid(),
  decision: z.enum(["approve", "reject"]),
  note: z.string().trim().max(1000).optional(),
});

export async function reviewPublication(_previous: PublishActionState, form: FormData): Promise<PublishActionState> {
  const checked = await guard();
  if ("error" in checked) return { ok: false, message: checked.error ?? null };
  const { t } = checked;
  const parsed = reviewSchema.safeParse({
    publicationId: form.get("publicationId"),
    decision: form.get("decision"),
    note: form.get("note") ?? undefined,
  });
  if (!parsed.success) return { ok: false, message: t("errors.failed") };
  const db = await createSupabaseServerClient();
  const { error } = await db.rpc("publication_review", {
    publication_id: parsed.data.publicationId,
    approve: parsed.data.decision === "approve",
    note: parsed.data.note || null,
  });
  if (error) return failure(error, t);
  revalidatePath("/spaces/publish");
  return { ok: true, message: parsed.data.decision === "approve" ? t("review.approved") : t("review.rejected") };
}

/** Takes a page down at once. Allowed even with the switch off. */
export async function unpublish(_previous: PublishActionState, form: FormData): Promise<PublishActionState> {
  const t = await getPublicPagesT();
  const authorization = await authorizeAdminAction();
  if (!authorization.ok) return { ok: false, message: t("errors.forbidden") };
  const id = z.string().uuid().safeParse(form.get("publicationId"));
  if (!id.success) return { ok: false, message: t("errors.failed") };
  const db = await createSupabaseServerClient();
  const { error } = await db.rpc("publication_unpublish", { publication_id: id.data });
  if (error) return failure(error, t);
  revalidatePath("/spaces/publish");
  return { ok: true, message: t("live.unpublished") };
}
