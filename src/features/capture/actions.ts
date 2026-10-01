"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { isEnabled } from "@/lib/feature-flags";
import { getLocale } from "@/lib/i18n/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createUniversalTask } from "@/features/universal-tasks/create-task";
import { parseForwardedEmail } from "./email";
import { captureT } from "./i18n";
import { CAPTURE_COLUMNS, type CaptureItem } from "./services/capture.queries";

export interface CaptureResult {
  ok: boolean;
  error?: string;
  id?: string;
}

const FLAG = "wos_capture" as const;
const MAX_BODY = 20000;

async function context() {
  const session = await requireSession();
  const db = await createSupabaseServerClient();
  const t = captureT(await getLocale());
  const enabled = await isEnabled(FLAG, db);
  return { session, db, t, enabled };
}

/** The first non-empty line, cut to a title's length. */
function firstLine(text: string, fallback: string): string {
  const line = text.split("\n").map((part) => part.trim()).find(Boolean) ?? fallback;
  return line.length > 300 ? `${line.slice(0, 299)}…` : line;
}

const captureSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("text"), text: z.string().trim().min(1).max(MAX_BODY) }),
  z.object({
    kind: z.literal("link"),
    url: z.string().trim().max(2000).regex(/^https?:\/\/\S+$/i),
    note: z.string().trim().max(MAX_BODY).optional(),
  }),
  z.object({ kind: z.literal("email"), text: z.string().trim().min(1).max(MAX_BODY) }),
]);

/** Quick capture of a note, a link or a pasted forwarded email. */
export async function captureItem(input: unknown): Promise<CaptureResult> {
  const { session, db, t, enabled } = await context();
  if (!enabled) return { ok: false, error: t("errors.unavailable") };
  const limited = await enforceRateLimit("capture:create", session.userId);
  if (limited) return limited;
  const parsed = captureSchema.safeParse(input);
  if (!parsed.success) {
    const kind = (input as { kind?: string } | null)?.kind;
    return {
      ok: false,
      error: t(kind === "link" ? "errors.urlInvalid" : kind === "email" ? "errors.emailRequired" : "errors.textRequired"),
    };
  }
  const data = parsed.data;
  const row: Record<string, unknown> = {
    organization_id: session.organizationId,
    owner_id: session.userId,
    kind: data.kind,
  };
  if (data.kind === "text") {
    Object.assign(row, { title: firstLine(data.text, "…"), body: data.text });
  } else if (data.kind === "link") {
    Object.assign(row, { title: firstLine(data.note || data.url, data.url), url: data.url, body: data.note || null });
  } else {
    const email = parseForwardedEmail(data.text);
    Object.assign(row, {
      title: firstLine(email.subject || email.body || data.text, "…"),
      body: email.body || data.text,
      email_from: email.from,
      email_subject: email.subject,
    });
  }
  const { data: created, error } = await db.from("capture_item").insert(row).select("id").single();
  if (error || !created) return { ok: false, error: t("errors.saveFailed") };
  revalidatePath("/capture");
  return { ok: true, id: created.id as string };
}

const fileSchema = z.object({
  kind: z.enum(["file", "photo"]),
  storagePath: z.string().trim().min(1).max(500),
  fileName: z.string().trim().min(1).max(300),
  mimeType: z.string().trim().max(200).optional(),
  sizeBytes: z.number().int().min(0).max(25 * 1024 * 1024).optional(),
  /** Text read off a photo on the device. */
  text: z.string().trim().max(MAX_BODY).optional(),
});

/** Records a file or photo the browser has just uploaded. */
export async function captureFile(input: unknown): Promise<CaptureResult> {
  const { session, db, t, enabled } = await context();
  if (!enabled) return { ok: false, error: t("errors.unavailable") };
  const limited = await enforceRateLimit("capture:create", session.userId);
  if (limited) return limited;
  const parsed = fileSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: t("errors.fileRequired") };
  const data = parsed.data;
  const { data: created, error } = await db
    .from("capture_item")
    .insert({
      organization_id: session.organizationId,
      owner_id: session.userId,
      kind: data.kind,
      title: firstLine(data.fileName, data.fileName),
      body: data.text || null,
      storage_path: data.storagePath,
      file_name: data.fileName,
      mime_type: data.mimeType ?? null,
      size_bytes: data.sizeBytes ?? null,
    })
    .select("id")
    .single();
  if (error || !created) return { ok: false, error: t("errors.saveFailed") };
  revalidatePath("/capture");
  return { ok: true, id: created.id as string };
}

const fileItemSchema = z.object({
  itemId: z.string().uuid(),
  as: z.enum(["task", "document", "interaction"]),
  projectId: z.string().uuid().optional(),
  contactId: z.string().uuid().optional(),
});

/**
 * One tap to file (M18): the item becomes a task, a document or a contact
 * interaction through that record's own action, and leaves the inbox.
 */
export async function fileCapture(input: unknown): Promise<CaptureResult> {
  const { session, db, t, enabled } = await context();
  if (!enabled) return { ok: false, error: t("errors.unavailable") };
  const parsed = fileItemSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: t("errors.notFound") };
  const { itemId, as, projectId, contactId } = parsed.data;

  // RLS: only the owner reads their items.
  const { data: found } = await db
    .from("capture_item")
    .select(CAPTURE_COLUMNS)
    .eq("id", itemId)
    .eq("status", "inbox")
    .maybeSingle();
  const item = found as unknown as CaptureItem | null;
  if (!item) return { ok: false, error: t("errors.notFound") };

  const details = [item.email_from ? `From: ${item.email_from}` : null, item.url, item.body]
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 5000);

  let refId: string | null = null;
  let failure: string | undefined;

  if (as === "task") {
    const created = await createUniversalTask(
      db,
      { userId: session.userId, organizationId: session.organizationId, displayName: session.profile.full_name },
      {
        title: item.title,
        description: details || undefined,
        projectId,
        assigneeId: session.userId,
        source: { type: "capture", id: item.id },
      },
    );
    if (created.ok) refId = created.id;
    else failure = created.message ?? created.reason;
  } else if (as === "document") {
    if (item.kind === "link" && item.url) {
      const { createDocumentLink } = await import("@/features/documents/services/document.commands");
      const result = await createDocumentLink({
        title: item.title.slice(0, 200),
        url: item.url,
        description: item.body?.slice(0, 2000) || undefined,
        projectId,
      });
      if (result.ok) refId = result.id ?? null;
      else failure = result.error;
    } else if (item.storage_path) {
      const { registerUploadedDocument } = await import("@/features/documents/services/document.commands");
      const result = await registerUploadedDocument({
        title: (item.file_name ?? item.title).slice(0, 200),
        storagePath: item.storage_path,
        mimeType: item.mime_type ?? undefined,
        sizeBytes: item.size_bytes ?? undefined,
        description: item.body?.slice(0, 2000) || undefined,
        projectId,
      });
      if (result.ok) refId = result.id ?? null;
      else failure = result.error;
    } else {
      failure = t("errors.fileRequired");
    }
  } else {
    if (!contactId) return { ok: false, error: t("errors.noContact") };
    const { data: contact } = await db
      .from("crm_contact")
      .select("id, crm_organization_id")
      .eq("id", contactId)
      .maybeSingle();
    if (!contact) return { ok: false, error: t("errors.noContact") };
    const { recordInteraction } = await import("@/features/crm/services/crm.commands");
    const result = await recordInteraction({
      crmOrganizationId: contact.crm_organization_id,
      contactId: contact.id,
      interactionType: "email",
      summary: [item.email_subject ?? item.title, item.body].filter(Boolean).join("\n\n").slice(0, 5000),
    });
    if (!result.ok) failure = result.error;
  }

  if (failure !== undefined) return { ok: false, error: t("errors.fileFailed", { message: failure }) };

  const { error } = await db
    .from("capture_item")
    .update({
      status: "filed",
      filed_as: as,
      filed_ref_id: refId,
      filed_project_id: projectId ?? null,
      filed_at: new Date().toISOString(),
    })
    .eq("id", item.id);
  if (error) return { ok: false, error: t("errors.saveFailed") };
  revalidatePath("/capture");
  return { ok: true, id: refId ?? undefined };
}

/** Out of the inbox without filing. An unfiled upload is deleted with it. */
export async function dismissCapture(itemId: string): Promise<CaptureResult> {
  const { db, t, enabled } = await context();
  if (!enabled) return { ok: false, error: t("errors.unavailable") };
  if (!z.string().uuid().safeParse(itemId).success) return { ok: false, error: t("errors.notFound") };
  const { data: item } = await db
    .from("capture_item")
    .select("id, storage_path")
    .eq("id", itemId)
    .eq("status", "inbox")
    .maybeSingle();
  if (!item) return { ok: false, error: t("errors.notFound") };
  const { error } = await db.from("capture_item").update({ status: "dismissed" }).eq("id", itemId);
  if (error) return { ok: false, error: t("errors.saveFailed") };
  // The storage policy lets an owner remove their own unregistered upload.
  if (item.storage_path) await db.storage.from("documents").remove([item.storage_path as string]);
  revalidatePath("/capture");
  return { ok: true };
}
