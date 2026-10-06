"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getLocale } from "@/lib/i18n/server";
import { contentAdapterFor } from "@/features/versions/adapters/registry";
import { objectRefSchema } from "@/features/versions/schema";
import { collabText, type CollabText } from "../messages";
import { applySuggestion } from "../suggestions";

export interface SuggestionResult {
  ok: boolean;
  error?: string;
}

const blockId = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);

function refusal(message: string | undefined, m: CollabText["suggest"]["errors"]): string {
  if (!message) return m.failed;
  if (message.includes("locked")) return m.locked;
  if (message.includes("already decided")) return m.decided;
  if (message.includes("row-level security") || message.includes("Only ")) return m.forbidden;
  return m.failed;
}

const createSchema = z.object({
  object: objectRefSchema,
  blockId,
  start: z.number().int().min(0),
  end: z.number().int().min(0),
  proposed: z.string().max(5000),
});

/**
 * Proposes replacing the selected text. The original words are read on the
 * server from the object's current content, never taken from the browser.
 */
export async function suggestEdit(input: unknown): Promise<SuggestionResult> {
  const session = await requireSession();
  const m = collabText(await getLocale()).suggest.errors;
  const parsed = createSchema.safeParse(input);
  if (!parsed.success || parsed.data.end < parsed.data.start) return { ok: false, error: m.failed };
  const { object, start, end, proposed } = parsed.data;
  const adapter = contentAdapterFor(object.type);
  const snapshot = adapter ? await adapter.read(object) : null;
  const block = snapshot?.content.blocks.find((candidate) => candidate.id === parsed.data.blockId);
  if (!block || end > block.text.length) return { ok: false, error: m.changed };
  const original = block.text.slice(start, end);
  if (original === proposed) return { ok: false, error: m.nothing };

  const db = await createSupabaseServerClient();
  const { error } = await db.from("object_suggestion").insert({
    organization_id: session.organizationId,
    object_id: object.id,
    object_type: object.type,
    block_id: block.id,
    start_offset: start,
    end_offset: end,
    original_text: original,
    proposed_text: proposed,
    author_id: session.userId,
  });
  if (error) return { ok: false, error: refusal(error.message, m) };
  revalidatePath("/collab", "layout");
  return { ok: true };
}

const decideSchema = z.object({
  id: z.string().uuid(),
  decision: z.enum(["accepted", "rejected", "withdrawn"]),
});

interface SuggestionRow {
  id: string;
  object_id: string;
  object_type: string;
  block_id: string;
  start_offset: number;
  end_offset: number;
  original_text: string;
  proposed_text: string;
}

/**
 * Accepting checks the text still fits first, then records the decision
 * (which checks the edit capability and the lock), then writes the new text
 * through the object's adapter. Rejecting and withdrawing only record.
 */
export async function decideSuggestion(input: unknown): Promise<SuggestionResult> {
  await requireSession();
  const m = collabText(await getLocale()).suggest.errors;
  const parsed = decideSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: m.failed };
  const db = await createSupabaseServerClient();

  let nextText: string | null = null;
  let suggestion: SuggestionRow | null = null;
  if (parsed.data.decision === "accepted") {
    const { data } = await db
      .from("object_suggestion")
      .select("id, object_id, object_type, block_id, start_offset, end_offset, original_text, proposed_text")
      .eq("id", parsed.data.id)
      .maybeSingle();
    suggestion = (data as SuggestionRow | null) ?? null;
    if (!suggestion) return { ok: false, error: m.failed };
    const adapter = contentAdapterFor(suggestion.object_type);
    const snapshot = adapter ? await adapter.read({ id: suggestion.object_id, type: suggestion.object_type }) : null;
    const block = snapshot?.content.blocks.find((candidate) => candidate.id === suggestion!.block_id);
    if (!block) return { ok: false, error: m.changed };
    const applied = applySuggestion(block.text, {
      start: suggestion.start_offset,
      end: suggestion.end_offset,
      originalText: suggestion.original_text,
      proposedText: suggestion.proposed_text,
    });
    if (!applied.ok) return { ok: false, error: m.changed };
    nextText = applied.text;
  }

  const { error } = await db.rpc("decide_suggestion", {
    p_suggestion: parsed.data.id,
    p_decision: parsed.data.decision,
  });
  if (error) return { ok: false, error: refusal(error.message, m) };

  if (suggestion && nextText !== null) {
    const object = { id: suggestion.object_id, type: suggestion.object_type };
    const adapter = contentAdapterFor(object.type)!;
    const snapshot = await adapter.read(object);
    if (!snapshot) return { ok: false, error: m.failed };
    try {
      await adapter.writeContent(object, {
        ...snapshot.content,
        blocks: snapshot.content.blocks.map((block) =>
          block.id === suggestion!.block_id ? { ...block, text: nextText! } : block,
        ),
      });
    } catch {
      return { ok: false, error: m.failed };
    }
  }
  revalidatePath("/collab", "layout");
  return { ok: true };
}
