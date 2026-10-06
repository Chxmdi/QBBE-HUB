"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { getLocale } from "@/lib/i18n/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createCan } from "@/lib/objects/can";
import { createActionRegistry } from "@/features/objects/actions/registry";
import { createSupabaseChangeSetStore } from "@/features/objects/actions/supabase-store";
import { createSupabaseObjectWriter } from "@/features/objects/actions/supabase-writer";
import { meetingsV2T } from "../i18n";
import { extractSemanticBlocks, semanticBlockKinds } from "../editor-adapter";
import { taskCreateAction } from "@/features/universal-tasks/task-create-action";
import { meetingTaskInput } from "../meeting-task";
import { planReview, summarizeSteps } from "../review";
import { RECORDING_TAG } from "./meeting-v2.queries";
import { meetingsV2Enabled } from "../flag";
import { isCalendarDate } from "@/lib/schema";

export interface CommandResult {
  ok: boolean;
  error?: string;
  id?: string;
  message?: string;
}

type Client = Awaited<ReturnType<typeof createSupabaseServerClient>>;

async function translator() {
  return meetingsV2T(await getLocale());
}

/** Every command refuses while the module is switched off, like its pages. */
async function guard(): Promise<CommandResult | null> {
  if (await meetingsV2Enabled()) return null;
  return { ok: false, error: (await translator())("errors.notFound") };
}

const uuid = z.string().uuid();
const optionalUuid = z.string().uuid().optional().or(z.literal("").transform(() => undefined));
const optionalDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(isCalendarDate)
  .optional()
  .or(z.literal("").transform(() => undefined));

const captureSchema = z.object({
  meetingId: uuid,
  kind: z.enum(semanticBlockKinds),
  body: z.string().trim().min(1).max(500),
  detail: z.string().trim().max(4000).optional(),
  ownerId: optionalUuid,
  dueOn: optionalDate,
  agendaItemId: optionalUuid,
});

export async function captureItem(input: unknown): Promise<CommandResult> {
  const blocked = await guard();
  if (blocked) return blocked;
  const session = await requireSession();
  const t = await translator();
  const limited = await enforceRateLimit("task:create", session.userId);
  if (limited) return limited;
  const parsed = captureSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: t("errors.invalidInput") };
  const data = parsed.data;

  const supabase = await createSupabaseServerClient();
  const { data: row, error } = await supabase
    .from("meeting_capture")
    .insert({
      meeting_id: data.meetingId,
      kind: data.kind,
      body: data.body,
      detail: data.detail || null,
      owner_id: data.ownerId ?? null,
      due_on: data.dueOn ?? null,
      agenda_item_id: data.agendaItemId ?? null,
      created_by: session.userId,
    })
    .select("id")
    .single();
  if (error || !row) return { ok: false, error: t("capture.error") };
  revalidatePath(`/meetings-v2/${data.meetingId}`);
  return { ok: true, id: row.id as string, message: t("capture.added") };
}

const notesSchema = z.object({ meetingId: uuid, notes: z.string().max(20000) });

/**
 * Saves the notes and captures every `/task`-style line in them. The notes
 * themselves need meeting management (the meeting's own rule); the captures
 * are written as the person saving.
 */
export async function saveNotesWithCaptures(input: unknown): Promise<CommandResult & { captured?: number; notes?: string }> {
  const blocked = await guard();
  if (blocked) return blocked;
  const session = await requireSession();
  const t = await translator();
  const parsed = notesSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: t("errors.invalidInput") };
  const { meetingId } = parsed.data;
  const { blocks, notes } = extractSemanticBlocks(parsed.data.notes);

  const supabase = await createSupabaseServerClient();
  const { data: updated, error } = await supabase
    .from("meeting")
    .update({ notes: notes || null, updated_at: new Date().toISOString() })
    .eq("id", meetingId)
    .select("id");
  if (error || !updated || updated.length === 0) return { ok: false, error: t("notes.error") };

  if (blocks.length > 0) {
    const { error: captureError } = await supabase.from("meeting_capture").insert(
      blocks.map((block) => ({
        meeting_id: meetingId,
        kind: block.kind,
        body: block.text,
        created_by: session.userId,
      })),
    );
    if (captureError) return { ok: false, error: t("capture.error") };
  }
  revalidatePath(`/meetings-v2/${meetingId}`);
  return {
    ok: true,
    captured: blocks.length,
    notes,
    message: blocks.length > 0 ? t("notes.savedWithCaptures", { count: blocks.length }) : t("notes.saved"),
  };
}

const reviewSchema = z.object({
  meetingId: uuid,
  choices: z.record(uuid, z.enum(["approve", "dismiss"])),
});

/**
 * The persisted registry (M13) with the shared task.create action: each task
 * made from a capture is recorded as a change set. Undo of a creation is not
 * offered here (the object writer applies property and link changes only).
 */
function registryFor(supabase: Client, actor: { userId: string; organizationId: string; displayName: string }) {
  const registry = createActionRegistry({
    store: createSupabaseChangeSetStore(supabase),
    writer: createSupabaseObjectWriter(supabase),
  });
  registry.register(taskCreateAction(supabase, actor));
  return registry;
}

/**
 * Applies the end-of-meeting review. Each capture is handled on its own: one
 * that fails stays open and is counted, the rest still apply. The database
 * refuses anyone but a meeting manager (app.meeting_capture_guard), and a
 * reviewed capture can never be reviewed again, so a repeated submit is safe.
 */
export async function applyMeetingReview(input: unknown): Promise<CommandResult> {
  const blocked = await guard();
  if (blocked) return blocked;
  const session = await requireSession();
  const t = await translator();
  const limited = await enforceRateLimit("task:create", session.userId);
  if (limited) return limited;
  const parsed = reviewSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: t("errors.invalidInput") };
  const { meetingId, choices } = parsed.data;

  const supabase = await createSupabaseServerClient();
  const [{ data: meeting }, { data: canManage }, { data: rows }] = await Promise.all([
    supabase.from("meeting").select("id, organization_id, project_id, program_id").eq("id", meetingId).maybeSingle(),
    supabase.rpc("can_manage_meeting", { p_meeting: meetingId }),
    supabase
      .from("meeting_capture")
      .select("id, kind, body, detail, status, owner_id, due_on")
      .eq("meeting_id", meetingId)
      .eq("status", "open"),
  ]);
  if (!meeting) return { ok: false, error: t("errors.notFound") };
  if (canManage !== true) return { ok: false, error: t("review.notOrganizer") };

  const captures = (rows ?? []) as {
    id: string; kind: "decision" | "task" | "question" | "follow_up"; body: string;
    detail: string | null; status: "open"; owner_id: string | null; due_on: string | null;
  }[];
  const byId = new Map(captures.map((c) => [c.id, c]));
  const steps = planReview(captures, choices);
  const registry = registryFor(supabase, {
    userId: session.userId,
    organizationId: session.organizationId,
    displayName: session.profile.full_name,
  });
  const context = { actor: { kind: "person" as const, id: session.userId }, can: createCan(supabase) };

  let failed = 0;
  for (const step of steps) {
    const capture = byId.get(step.captureId)!;
    let update: Record<string, unknown>;
    if (step.op === "dismiss") {
      update = { status: "dismissed" };
    } else if (step.op === "keep") {
      update = { status: "approved" };
    } else if (step.op === "create_task") {
      // The shared task.create action (M7a) makes the task and records the
      // meeting as its source; meeting_action keeps the meeting's own list
      // of actions, as the classic meeting page shows them.
      const result = await registry.run("task.create", meetingTaskInput(capture, meeting), context);
      const created = result.ok ? result.changeSet.changes[0] : null;
      if (!created || created.kind !== "create") {
        failed += 1;
        continue;
      }
      const { error: linkError } = await supabase.from("meeting_action").insert({
        meeting_id: meetingId,
        task_id: created.object.id,
        title: capture.body,
        owner_id: capture.owner_id,
        due_at: capture.due_on,
      });
      if (linkError) {
        failed += 1;
        continue;
      }
      update = { status: "approved", created_object_type: "task", created_object_id: created.object.id };
    } else {
      const { data: decision, error } = await supabase
        .from("decision")
        .insert({
          organization_id: meeting.organization_id,
          project_id: meeting.project_id,
          meeting_id: meetingId,
          title: capture.body,
          detail: capture.detail,
          decided_by: session.userId,
        })
        .select("id")
        .single();
      if (error || !decision) {
        failed += 1;
        continue;
      }
      update = { status: "approved", created_object_type: "decision", created_object_id: decision.id };
    }
    const { error } = await supabase.from("meeting_capture").update(update).eq("id", capture.id);
    if (error) failed += 1;
  }

  revalidatePath(`/meetings-v2/${meetingId}`);
  revalidatePath(`/meetings-v2/${meetingId}/review`);
  const summary = summarizeSteps(steps);
  if (failed > 0) return { ok: false, error: t("review.failed", { count: failed }) };
  return { ok: true, message: t("review.applied", summary) };
}

const recordingSchema = z.object({
  meetingId: uuid,
  title: z.string().trim().min(1).max(200),
  storagePath: z.string().trim().min(1).max(500),
  mimeType: z.string().trim().max(200).optional(),
  sizeBytes: z.coerce.number().int().min(0).max(25 * 1024 * 1024).optional(),
});

/**
 * Records an uploaded recording as a document on the meeting. The file went
 * to the private `documents` bucket first; the virus scan and download rules
 * are the document library's, and document_member_insert only lets a meeting
 * manager attach to a meeting.
 */
export async function attachMeetingRecording(input: unknown): Promise<CommandResult> {
  const blocked = await guard();
  if (blocked) return blocked;
  const session = await requireSession();
  const t = await translator();
  const limited = await enforceRateLimit("document:upload", session.userId);
  if (limited) return limited;
  const parsed = recordingSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: t("errors.invalidInput") };
  const data = parsed.data;

  const supabase = await createSupabaseServerClient();
  const { data: meeting } = await supabase
    .from("meeting")
    .select("id, organization_id")
    .eq("id", data.meetingId)
    .maybeSingle();
  if (!meeting) return { ok: false, error: t("errors.notFound") };

  const { data: doc, error } = await supabase
    .from("document")
    .insert({
      organization_id: meeting.organization_id,
      title: data.title,
      kind: "file",
      storage_path: data.storagePath,
      mime_type: data.mimeType || null,
      size_bytes: data.sizeBytes ?? null,
      meeting_id: data.meetingId,
      visibility: "organization",
      tags: [RECORDING_TAG],
      owner_id: session.userId,
      created_by: session.userId,
    })
    .select("id")
    .single();
  if (error || !doc) return { ok: false, error: t("recording.error") };
  revalidatePath(`/meetings-v2/${data.meetingId}`);
  return { ok: true, id: doc.id as string, message: t("recording.uploaded") };
}
