import type { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ImportRefs } from "./import";

type Client = Pick<Awaited<ReturnType<typeof createSupabaseServerClient>>, "from">;

/**
 * The names an import may refer to, read through the viewer's own client so
 * a file can only name people, projects and programs the viewer can see.
 * The same lists feed the wizard's preview and the server's validation.
 */
export async function loadImportRefs(client: Client): Promise<ImportRefs> {
  const [{ data: members }, { data: projects }, { data: programs }, { data: milestones }] = await Promise.all([
    client
      .from("organization_membership")
      .select("user_id, status, user_profile:user_id(id, full_name, email)")
      .eq("status", "active"),
    client.from("project").select("id, name").is("archived_at", null).in("stage", ["approved", "planning", "active"]).order("name"),
    client.from("program").select("id, name").eq("status", "active").order("name"),
    client.from("milestone").select("id, name, project_id").order("sort_key"),
  ]);
  type Profile = { id: string; full_name: string; email: string } | null;
  const people = ((members ?? []) as { user_profile: Profile | Profile[] }[])
    .map((m) => (Array.isArray(m.user_profile) ? m.user_profile[0] : m.user_profile))
    .filter((p): p is NonNullable<Profile> => !!p)
    .map((p) => ({ id: p.id, name: p.full_name ?? "", email: p.email ?? "" }));
  return {
    people,
    projects: ((projects ?? []) as { id: string; name: string }[]).map((p) => ({ id: p.id, name: p.name })),
    programs: ((programs ?? []) as { id: string; name: string }[]).map((p) => ({ id: p.id, name: p.name })),
    milestones: ((milestones ?? []) as { id: string; name: string; project_id: string | null }[]).map((m) => ({
      id: m.id,
      name: m.name,
      projectId: m.project_id,
    })),
  };
}
