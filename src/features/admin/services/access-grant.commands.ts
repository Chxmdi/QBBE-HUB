"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionResult } from "@/features/tasks/services/task.commands";
import {
  programAccessRoleSchema,
  projectAccessRoleSchema,
} from "@/lib/access-capabilities";
import { authorizeAdminAction } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const programGrantSchema = z.object({
  programId: z.string().uuid(),
  userId: z.string().uuid(),
  role: programAccessRoleSchema.nullable(),
});

const projectGrantSchema = z.object({
  projectId: z.string().uuid(),
  userId: z.string().uuid(),
  role: projectAccessRoleSchema.nullable(),
});

export async function setDirectProgramAccess(input: unknown): Promise<ActionResult> {
  const authorization = await authorizeAdminAction();
  if (!authorization.ok) return { ok: false, error: authorization.error };
  const session = authorization.session;
  const limited = await enforceRateLimit("access-grant:program", session.userId);
  if (limited) return limited;
  const parsed = programGrantSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Choose a valid program, member, and role." };

  const db = await createSupabaseServerClient();
  const { error } = parsed.data.role === null
    ? await db.rpc("remove_program_direct_access", {
        p_program: parsed.data.programId,
        p_user: parsed.data.userId,
      })
    : await db.rpc("set_program_direct_access", {
        p_program: parsed.data.programId,
        p_user: parsed.data.userId,
        p_role: parsed.data.role,
      });
  if (error) return { ok: false, error: "Could not update direct program access." };

  revalidatePath("/admin/access");
  revalidatePath(`/programs/${parsed.data.programId}`);
  return { ok: true };
}

export async function setDirectProjectAccess(input: unknown): Promise<ActionResult> {
  const authorization = await authorizeAdminAction();
  if (!authorization.ok) return { ok: false, error: authorization.error };
  const session = authorization.session;
  const limited = await enforceRateLimit("access-grant:project", session.userId);
  if (limited) return limited;
  const parsed = projectGrantSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Choose a valid project, member, and role." };

  const db = await createSupabaseServerClient();
  const { error } = parsed.data.role === null
    ? await db.rpc("remove_project_direct_access", {
        p_project: parsed.data.projectId,
        p_user: parsed.data.userId,
      })
    : await db.rpc("set_project_direct_access", {
        p_project: parsed.data.projectId,
        p_user: parsed.data.userId,
        p_role: parsed.data.role,
      });
  if (error) return { ok: false, error: "Could not update direct project access." };

  revalidatePath("/admin/access");
  revalidatePath(`/projects/${parsed.data.projectId}`);
  return { ok: true };
}
