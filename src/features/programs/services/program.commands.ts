"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { hasProgramCapability } from "@/lib/access-capabilities";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requiredText } from "@/lib/schema";
import type { ActionResult } from "@/features/tasks/services/task.commands";

const editSchema = z.object({
  id: z.string().uuid(),
  name: requiredText("A program needs a name.", 200),
  description: z.string().trim().max(2000),
  status: z.enum(["active", "paused", "archived"]),
  color: z.enum(["neutral", "blue", "green", "amber", "rose"]).default("neutral"),
  importantLinks: z.string().trim().max(4000).optional(),
});

export async function updateProgram(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = editSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const db = await createSupabaseServerClient();
  if (!(await hasProgramCapability(db, parsed.data.id, "manage"))) {
    return { ok: false, error: "You cannot manage this program." };
  }
  const { id, name, description, status, color, importantLinks } = parsed.data;
  let links: { label: string; url: string }[] = [];
  if (importantLinks) {
    links = importantLinks
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [label, url] = line.includes("|") ? line.split("|", 2) : [line, line];
        return { label: label.trim(), url: url.trim() };
      })
      .filter((link) => /^https?:\/\//.test(link.url));
  }
  const { data, error } = await db.from("program")
    .update({
      name,
      description: description || null,
      status,
      color,
      important_links: links,
    })
    .eq("id", id).eq("organization_id", session.organizationId)
    .select("id").maybeSingle();
  if (error || !data) return { ok: false, error: "Could not save the program. Please try again." };
  revalidatePath("/", "layout");
  return { ok: true, id };
}
