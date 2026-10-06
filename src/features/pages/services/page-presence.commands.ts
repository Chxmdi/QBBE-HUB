"use server";

import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { isEnabled } from "@/lib/feature-flags";
import { enforceRateLimit } from "@/lib/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { parsePresenceRows, type PagePresencePerson } from "./page-presence";

/**
 * Who has a page open (wave 2, C1). Behind both wos_pages and wos_editor:
 * with either off, nothing is recorded or listed. The database functions
 * make the access checks (page_presence_touch refuses anyone who cannot open
 * the page; the read policy hides anyone who cannot), and nothing here
 * widens them.
 */

const pageId = z.string().uuid();
const tabId = z.string().uuid();
const touchInput = z.object({ pageId, tabId, editing: z.boolean() });

export type PresenceResult =
  | { ok: true; people: PagePresencePerson[] }
  | { ok: false; reason: "off" | "invalid" | "refused" | "rateLimited" | "failed" };

async function switchesOn(): Promise<boolean> {
  const [pages, editor] = await Promise.all([isEnabled("wos_pages"), isEnabled("wos_editor")]);
  return pages && editor;
}

/** "I still have this page open in this tab", then the current list. */
export async function touchPagePresence(input: unknown): Promise<PresenceResult> {
  if (!(await switchesOn())) return { ok: false, reason: "off" };
  const session = await requireSession();
  const parsed = touchInput.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "invalid" };
  // A heartbeat every few seconds per open tab; this only stops a loop. Its
  // own bucket under the editor's ceiling, so it never eats into saves.
  const limited = await enforceRateLimit("editor:save", `page-presence:${session.userId}`);
  if (limited) return { ok: false, reason: "rateLimited" };
  const db = await createSupabaseServerClient();
  const { error } = await db.rpc("page_presence_touch", {
    p_page: parsed.data.pageId,
    p_tab: parsed.data.tabId,
    p_editing: parsed.data.editing,
  });
  if (error) return { ok: false, reason: error.code === "42501" ? "refused" : "failed" };
  return listPeople(db, parsed.data.pageId);
}

async function listPeople(db: Awaited<ReturnType<typeof createSupabaseServerClient>>, id: string): Promise<PresenceResult> {
  const { data, error } = await db.rpc("page_presence_list", { p_page: id });
  if (error) return { ok: false, reason: "failed" };
  return { ok: true, people: parsePresenceRows(data) };
}
