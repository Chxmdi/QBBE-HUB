import { z } from "zod";
import type { createSupabaseServerClient } from "@/lib/supabase/server";

export const programAccessRoles = [
  "lead",
  "manager",
  "contributor",
  "reviewer",
  "follower",
  "read_only",
] as const;

export const projectAccessRoles = [
  "project_manager",
  "contributor",
  "reviewer",
  "approver",
  "follower",
  "read_only",
] as const;

export const recordCapabilities = [
  "read",
  "manage",
  "collaborate",
  "review",
  "approve",
  "follow",
] as const;

export const programAccessRoleSchema = z.enum(programAccessRoles);
export const projectAccessRoleSchema = z.enum(projectAccessRoles);
export const recordCapabilitySchema = z.enum(recordCapabilities);

export type ProgramAccessRole = z.infer<typeof programAccessRoleSchema>;
export type ProjectAccessRole = z.infer<typeof projectAccessRoleSchema>;
export type RecordCapability = z.infer<typeof recordCapabilitySchema>;
type ServerSupabaseClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

const programCapabilities: Record<ProgramAccessRole, readonly RecordCapability[]> = {
  lead: recordCapabilities,
  manager: recordCapabilities,
  contributor: ["read", "collaborate", "follow"],
  reviewer: ["read", "review", "follow"],
  follower: ["read", "follow"],
  read_only: ["read", "follow"],
};

const projectCapabilities: Record<ProjectAccessRole, readonly RecordCapability[]> = {
  project_manager: recordCapabilities,
  contributor: ["read", "collaborate", "follow"],
  reviewer: ["read", "review", "follow"],
  approver: ["read", "review", "approve", "follow"],
  follower: ["read", "follow"],
  read_only: ["read", "follow"],
};

export function programRoleAllows(
  role: ProgramAccessRole,
  capability: RecordCapability,
): boolean {
  return programCapabilities[role].includes(capability);
}

export function projectRoleAllows(
  role: ProjectAccessRole,
  capability: RecordCapability,
): boolean {
  return projectCapabilities[role].includes(capability);
}

/** Authoritative capability predicates used by RLS and server actions. */
export async function hasProgramCapability(
  client: ServerSupabaseClient,
  programId: string,
  capability: RecordCapability,
): Promise<boolean> {
  const { data, error } = await client.rpc("has_program_capability", {
    p_program: programId,
    p_capability: capability,
  });
  return !error && data === true;
}

export async function hasProjectCapability(
  client: ServerSupabaseClient,
  projectId: string,
  capability: RecordCapability,
): Promise<boolean> {
  const { data, error } = await client.rpc("has_project_capability", {
    p_project: projectId,
    p_capability: capability,
  });
  return !error && data === true;
}
