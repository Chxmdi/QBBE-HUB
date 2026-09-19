"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requiredText } from "@/lib/schema";
import { authorizeAdminAction } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/features/tasks/services/task.commands";

const createTeamSchema = z.object({
  name: requiredText("A team needs a name.", 120),
  description: z.string().trim().max(500).optional(),
  ownerId: z.string().uuid().optional(),
});

const programAssignmentSchema = z.object({
  teamId: z.string().uuid(),
  programId: z.string().uuid(),
  role: z.enum(["lead", "manager", "contributor", "reviewer", "follower", "read_only"]),
});

const projectAssignmentSchema = z.object({
  teamId: z.string().uuid(),
  projectId: z.string().uuid(),
  role: z.enum(["project_manager", "contributor", "reviewer", "approver", "follower", "read_only"]),
});

export async function createTeam(input: unknown): Promise<ActionResult> {
  const authorization = await authorizeAdminAction();
  if (!authorization.ok) return { ok: false, error: authorization.error };
  const session = authorization.session;
  const parsed = createTeamSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const supabase = await createSupabaseServerClient();
  const { data: teamId, error } = await supabase.rpc("create_team_with_channel", {
    p_name: parsed.data.name,
    p_description: parsed.data.description || null,
    p_owner_id: parsed.data.ownerId ?? session.userId,
  });
  if (error || !teamId) {
    return {
      ok: false,
      error: error?.message.includes("active organization member")
        ? "Choose an active member of this organization as team owner."
        : "Could not create the team and its private channel.",
    };
  }

  revalidatePath("/people");
  revalidatePath("/admin");
  revalidatePath("/channels");
  revalidatePath("/channels");
  return { ok: true, id: teamId as string };
}

export async function addTeamMember(
  teamId: string,
  userId: string,
): Promise<ActionResult> {
  const authorization = await authorizeAdminAction();
  if (!authorization.ok) return { ok: false, error: authorization.error };
  const parsed = z.object({ teamId: z.string().uuid(), userId: z.string().uuid() })
    .safeParse({ teamId, userId });
  if (!parsed.success) return { ok: false, error: "Invalid team member." };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("add_team_member", {
    p_team_id: parsed.data.teamId,
    p_user_id: parsed.data.userId,
  });
  if (error) {
    return {
      ok: false,
      error: error.message.includes("active")
        ? "Only active members of this organization can join the team."
        : "Could not add the member.",
    };
  }
  revalidatePath("/people");
  revalidatePath("/admin");
  revalidatePath("/channels");
  return { ok: true };
}

export async function removeTeamMember(
  teamId: string,
  userId: string,
): Promise<ActionResult> {
  const authorization = await authorizeAdminAction();
  if (!authorization.ok) return { ok: false, error: authorization.error };
  const parsed = z.object({ teamId: z.string().uuid(), userId: z.string().uuid() })
    .safeParse({ teamId, userId });
  if (!parsed.success) return { ok: false, error: "Invalid team member." };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("remove_team_member", {
    p_team_id: parsed.data.teamId,
    p_user_id: parsed.data.userId,
  });
  if (error) {
    return {
      ok: false,
      error: error.message.includes("ownership")
        ? "Transfer team ownership before removing its owner."
        : "Could not remove the member.",
    };
  }
  revalidatePath("/people");
  revalidatePath("/admin");
  return { ok: true };
}

export async function transferTeamOwnership(
  teamId: string,
  ownerId: string,
): Promise<ActionResult> {
  const authorization = await authorizeAdminAction();
  if (!authorization.ok) return { ok: false, error: authorization.error };
  const parsed = z.object({
    teamId: z.string().uuid(),
    ownerId: z.string().uuid(),
  }).safeParse({ teamId, ownerId });
  if (!parsed.success) return { ok: false, error: "Choose a valid team owner." };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("transfer_team_ownership", {
    p_team_id: parsed.data.teamId,
    p_target_user_id: parsed.data.ownerId,
  });
  if (error) {
    return {
      ok: false,
      error: error.message.includes("active organization member")
        ? "Choose an active member of this organization."
        : "Could not transfer team ownership.",
    };
  }

  revalidatePath("/admin");
  revalidatePath("/people");
  revalidatePath("/channels");
  return { ok: true };
}

export async function assignTeamToProgram(input: unknown): Promise<ActionResult> {
  const authorization = await authorizeAdminAction();
  if (!authorization.ok) return { ok: false, error: authorization.error };
  const session = authorization.session;
  const parsed = programAssignmentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Choose a valid program and role." };
  const supabase = await createSupabaseServerClient();
  const { data: assignment, error } = await supabase
    .from("program_team_assignment")
    .upsert({
      organization_id: session.organizationId,
      team_id: parsed.data.teamId,
      program_id: parsed.data.programId,
      role: parsed.data.role,
      created_by: session.userId,
    })
    .select("team_id")
    .maybeSingle();
  if (error || !assignment) return { ok: false, error: "Could not assign the team to that program." };
  revalidatePath("/admin");
  revalidatePath("/admin/access");
  revalidatePath("/programs");
  revalidatePath("/projects");
  return { ok: true };
}

export async function assignTeamToProject(input: unknown): Promise<ActionResult> {
  const authorization = await authorizeAdminAction();
  if (!authorization.ok) return { ok: false, error: authorization.error };
  const session = authorization.session;
  const parsed = projectAssignmentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Choose a valid project and role." };
  const supabase = await createSupabaseServerClient();
  const { data: assignment, error } = await supabase
    .from("project_team_assignment")
    .upsert({
      organization_id: session.organizationId,
      team_id: parsed.data.teamId,
      project_id: parsed.data.projectId,
      role: parsed.data.role,
      created_by: session.userId,
    })
    .select("team_id")
    .maybeSingle();
  if (error || !assignment) return { ok: false, error: "Could not assign the team to that project." };
  revalidatePath("/admin");
  revalidatePath("/admin/access");
  revalidatePath("/projects");
  return { ok: true };
}

export async function removeTeamAssignment(
  scope: "program" | "project",
  scopeId: string,
  teamId: string,
): Promise<ActionResult> {
  const authorization = await authorizeAdminAction();
  if (!authorization.ok) return { ok: false, error: authorization.error };
  const session = authorization.session;
  const parsed = z.object({
    scope: z.enum(["program", "project"]),
    scopeId: z.string().uuid(),
    teamId: z.string().uuid(),
  }).safeParse({ scope, scopeId, teamId });
  if (!parsed.success) return { ok: false, error: "Invalid team assignment." };
  const supabase = await createSupabaseServerClient();
  const scopeColumn = parsed.data.scope === "program" ? "program_id" : "project_id";
  const table = parsed.data.scope === "program"
    ? "program_team_assignment"
    : "project_team_assignment";
  const { data: removed, error } = await supabase
    .from(table)
    .delete()
    .eq("organization_id", session.organizationId)
    .eq("team_id", parsed.data.teamId)
    .eq(scopeColumn, parsed.data.scopeId)
    .select("team_id")
    .maybeSingle();
  if (error || !removed) return { ok: false, error: "Could not remove the team assignment." };
  revalidatePath("/admin");
  revalidatePath("/admin/access");
  revalidatePath("/programs");
  revalidatePath("/projects");
  return { ok: true };
}
