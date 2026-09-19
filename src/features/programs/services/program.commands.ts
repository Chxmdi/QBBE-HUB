"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { hasProgramCapability } from "@/lib/access-capabilities";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requiredText } from "@/lib/schema";
import { parseLabelledLinks } from "@/lib/links";
import type { ActionResult } from "@/features/tasks/services/task.commands";

const editSchema = z.object({
  id: z.string().uuid(),
  name: requiredText("A program needs a name.", 200),
  description: z.string().trim().max(2000),
  status: z.enum(["active", "paused", "archived"]),
  color: z.enum(["neutral", "blue", "green", "amber", "rose"]).default("neutral"),
  importantLinks: z.string().trim().max(4000).optional(),
  // Empty string means "no lead"; a <select> cannot submit null.
  leadId: z.union([z.string().uuid(), z.literal("")]).optional(),
});

export async function updateProgram(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = editSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const db = await createSupabaseServerClient();
  if (!(await hasProgramCapability(db, parsed.data.id, "manage"))) {
    return { ok: false, error: "You cannot manage this program." };
  }
  const { id, name, description, status, color, importantLinks, leadId } = parsed.data;
  const links = parseLabelledLinks(importantLinks);

  const patch: Record<string, unknown> = {
    name,
    description: description || null,
    status,
    color,
    important_links: links,
  };

  // The lead is only touched when the form actually carried the field, so a
  // caller that does not manage leads cannot blank one by leaving it out.
  if (leadId !== undefined) {
    if (leadId) {
      // A lead holds `manage` on the program through app.has_program_capability,
      // so naming one grants access. Refuse anybody who is not an active member
      // of this organization rather than handing capability to a stranger.
      const { data: member } = await db
        .from("organization_membership")
        .select("user_id")
        .eq("organization_id", session.organizationId)
        .eq("user_id", leadId)
        .eq("status", "active")
        .maybeSingle();
      if (!member) {
        return { ok: false, error: "Choose an active member of this workspace as the program lead." };
      }
    }
    patch.lead_id = leadId || null;
  }

  const { data, error } = await db.from("program")
    .update(patch)
    .eq("id", id).eq("organization_id", session.organizationId)
    .select("id").maybeSingle();
  if (error || !data) return { ok: false, error: "Could not save the program. Please try again." };
  revalidatePath("/", "layout");
  return { ok: true, id };
}
