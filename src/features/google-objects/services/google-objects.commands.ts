"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { isEnabled } from "@/lib/feature-flags";
import { getLocale } from "@/lib/i18n/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createDocumentLink } from "@/features/documents/services/document.commands";
import type { SubmitToCapture } from "@/features/google-objects/capture-contract";
import { parseDriveLink } from "@/features/google-objects/drive";
import { GOOGLE_OBJECTS_FLAG } from "@/features/google-objects/gate";
import { googleObjectsText } from "@/features/google-objects/messages";

export type GoogleResult<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

async function guard() {
  const m = googleObjectsText(await getLocale());
  return { m, blocked: (await isEnabled(GOOGLE_OBJECTS_FLAG)) ? null : m.errors.forbidden };
}

const uuid = z.string().uuid();

/**
 * A synced calendar event becomes a Hub meeting. The meeting is inserted as
 * the person, so the meeting table's own rule decides where they may create
 * one; then the event is tied to it (public.google_link_event_meeting).
 */
export async function addEventAsMeeting(linkId: string, projectId: string | null): Promise<GoogleResult<{ meetingId: string }>> {
  const { m, blocked } = await guard();
  if (blocked) return { ok: false, error: blocked };
  const session = await requireSession();
  if (!uuid.safeParse(linkId).success || (projectId !== null && !uuid.safeParse(projectId).success)) {
    return { ok: false, error: m.errors.generic };
  }
  const supabase = await createSupabaseServerClient();
  const { data: event } = await supabase
    .from("calendar_event_link")
    .select("id, title, starts_at, ends_at, html_link, meeting_id")
    .eq("id", linkId)
    .eq("user_id", session.userId)
    .maybeSingle();
  if (!event || event.meeting_id) return { ok: false, error: m.errors.forbidden };

  let programId: string | null = null;
  if (projectId) {
    const { data: project } = await supabase.from("project").select("program_id").eq("id", projectId).maybeSingle();
    programId = (project?.program_id as string | null | undefined) ?? null;
  }
  // The id is chosen here: the meeting read rule cannot see a row inside the
  // statement that inserts it, so an insert-and-return is refused.
  const meetingId = crypto.randomUUID();
  const { error } = await supabase.from("meeting").insert({
    id: meetingId,
    organization_id: session.organizationId,
    project_id: projectId,
    program_id: programId,
    title: event.title,
    organizer_id: session.userId,
    starts_at: event.starts_at,
    ends_at: event.ends_at,
    meeting_link: event.html_link,
  });
  if (error) return { ok: false, error: error.code === "42501" ? m.errors.meeting : m.errors.generic };
  const { error: linkError } = await supabase.rpc("google_link_event_meeting", { p_link_id: linkId, p_meeting_id: meetingId });
  if (linkError) return { ok: false, error: m.errors.generic };
  revalidatePath("/google");
  return { ok: true, data: { meetingId } };
}

export async function linkDriveFile(input: { url: string; title: string; projectId: string | null }): Promise<GoogleResult<{ documentId: string }>> {
  const { m, blocked } = await guard();
  if (blocked) return { ok: false, error: blocked };
  const drive = parseDriveLink(input.url);
  if (!drive) return { ok: false, error: m.errors.notDrive };
  if (!input.title.trim()) return { ok: false, error: m.errors.title };
  const result = await createDocumentLink({
    title: input.title.trim().slice(0, 200),
    url: drive.url,
    ...(input.projectId ? { projectId: input.projectId } : {}),
  });
  if (!result.ok) return { ok: false, error: result.error ?? m.errors.generic };
  revalidatePath("/google");
  return { ok: true, data: { documentId: result.id ?? "" } };
}

/** The capture contract's stand-in: writes the person's own message into capture_forward. */
const submitToCapture: SubmitToCapture = async (item) => {
  const session = await requireSession();
  const supabase = await createSupabaseServerClient();
  const id = crypto.randomUUID();
  const { error } = await supabase.from("capture_forward").insert({
    id,
    organization_id: session.organizationId,
    source: item.source,
    source_id: item.sourceId,
    title: "-",
  });
  if (!error) return { ok: true, id };
  if (error.code === "23505") return { ok: false, reason: "duplicate" };
  return { ok: false, reason: error.code === "42501" ? "forbidden" : "failed" };
};

export async function forwardToCapture(messageId: string): Promise<GoogleResult> {
  const { m, blocked } = await guard();
  if (blocked) return { ok: false, error: blocked };
  if (!uuid.safeParse(messageId).success) return { ok: false, error: m.errors.generic };
  const result = await submitToCapture({ source: "gmail", sourceId: messageId });
  if (!result.ok) {
    return { ok: false, error: result.reason === "duplicate" ? m.errors.duplicate : result.reason === "forbidden" ? m.errors.forbidden : m.errors.generic };
  }
  revalidatePath("/google");
  return { ok: true };
}
