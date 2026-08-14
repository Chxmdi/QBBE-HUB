"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { slugify } from "@/lib/utils";
import type { ActionResult } from "@/features/tasks/services/task.commands";

const createTeamSchema = z.object({
  name: z.string().trim().min(1, "A team needs a name.").max(120),
  description: z.string().trim().max(500).optional(),
});

export async function createTeam(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  if (!session.isAdmin) return { ok: false, error: "Admin access required." };
  const parsed = createTeamSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const supabase = await createSupabaseServerClient();
  const { data: team, error } = await supabase
    .from("team")
    .insert({
      organization_id: session.organizationId,
      name: parsed.data.name,
      description: parsed.data.description || null,
    })
    .select("id")
    .single();
  if (error || !team) return { ok: false, error: "Could not create the team." };

  const channelSlug = `team-${slugify(parsed.data.name) || team.id.slice(0, 8)}`;
  const { data: channel } = await supabase
    .from("channel")
    .insert({
      organization_id: session.organizationId,
      name: parsed.data.name,
      slug: channelSlug,
      type: "team",
      privacy: "private",
      purpose: parsed.data.description || `Team channel for ${parsed.data.name}.`,
      owner_id: session.userId,
      created_by: session.userId,
    })
    .select("id")
    .maybeSingle();
  if (channel) {
    await supabase.from("channel_member").insert({
      channel_id: channel.id,
      user_id: session.userId,
      role: "manager",
      membership_source: "team",
    });
  }

  revalidatePath("/people");
  revalidatePath("/admin");
  revalidatePath("/channels");
  return { ok: true, id: team.id as string };
}

export async function addTeamMember(
  teamId: string,
  userId: string,
): Promise<ActionResult> {
  const session = await requireSession();
  if (!session.isAdmin) return { ok: false, error: "Admin access required." };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("team_member").insert({
    team_id: teamId,
    user_id: userId,
  });
  if (error && error.code !== "23505") {
    return { ok: false, error: "Could not add the member." };
  }
  revalidatePath("/people");
  revalidatePath("/admin");
  return { ok: true };
}

export async function removeTeamMember(
  teamId: string,
  userId: string,
): Promise<ActionResult> {
  const session = await requireSession();
  if (!session.isAdmin) return { ok: false, error: "Admin access required." };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("team_member")
    .delete()
    .eq("team_id", teamId)
    .eq("user_id", userId);
  if (error) return { ok: false, error: "Could not remove the member." };
  revalidatePath("/people");
  revalidatePath("/admin");
  return { ok: true };
}
