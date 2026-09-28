import type { Metadata } from "next";
import { getT } from "@/lib/i18n/server";
import { requireAdminAal2 } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { readAll } from "@/lib/supabase/read-all";
import { PageHeader } from "@/components/shared/page-header";
import { AdminNav } from "@/features/admin/components/admin-nav";
import { DirectAccessManager } from "@/features/admin/components/direct-access-manager";
import { TeamAssignmentManager } from "@/features/admin/components/team-assignment-control";
import { buildAccessImpact, type AccessImpactInput } from "@/features/admin/access-impact";
import type { ProgramAccessRole, ProjectAccessRole } from "@/lib/access-capabilities";
import { roleCodeLabel } from "@/features/admin/labels";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("admin.access.title") };
}
export const dynamic = "force-dynamic";

export default async function AccessImpactPage() {
  const session = await requireAdminAal2();
  const t = await getT();
  const db = await createSupabaseServerClient();
  const [
    members,
    programs,
    projects,
    programMemberships,
    projectMemberships,
    programGrants,
    projectGrants,
    teams,
    programTeamAssignments,
    projectTeamAssignments,
  ] = await Promise.all([
    readAll(db.from("organization_membership").select("user_id, organization_id, role, status, profile:user_id(full_name)").eq("organization_id", session.organizationId), "user_id"),
    readAll(db.from("program").select("id, organization_id, name, lead_id, status").eq("organization_id", session.organizationId)),
    readAll(db.from("project").select("id, organization_id, name, program_id, owner_id, stage, archived_at").eq("organization_id", session.organizationId)),
    readAll(db.from("program_membership").select("program_id, user_id, role, program:program_id!inner(organization_id)").eq("program.organization_id", session.organizationId).order("program_id"), "user_id"),
    readAll(db.from("project_membership").select("project_id, user_id, role, project:project_id!inner(organization_id)").eq("project.organization_id", session.organizationId).order("project_id"), "user_id"),
    readAll(db.from("program_access_grant").select("program_id, user_id, role").eq("organization_id", session.organizationId).eq("source", "direct").order("program_id"), "user_id"),
    readAll(db.from("project_access_grant").select("project_id, user_id, role").eq("organization_id", session.organizationId).eq("source", "direct").order("project_id"), "user_id"),
    readAll(db.from("team").select("id, name").eq("organization_id", session.organizationId)),
    readAll(
      db.from("program_team_assignment")
        .select("program_id, team_id, role")
        .eq("organization_id", session.organizationId)
        .order("team_id"),
      "program_id",
    ),
    readAll(
      db.from("project_team_assignment")
        .select("project_id, team_id, role")
        .eq("organization_id", session.organizationId)
        .order("team_id"),
      "project_id",
    ),
  ]);
  const failed = [
    members,
    programs,
    projects,
    programMemberships,
    projectMemberships,
    programGrants,
    projectGrants,
    teams,
    programTeamAssignments,
    projectTeamAssignments,
  ].some(r => r.error);
  if (failed) return <div><PageHeader title={t("admin.access.title")} /><AdminNav /><p role="alert" className="card mt-6 p-5">{t("admin.access.loadFailed")}</p></div>;
  const impact = buildAccessImpact({ organizationId: session.organizationId,
    members: (members.data ?? []).map(m => ({ ...m, name: (m.profile as unknown as { full_name: string } | null)?.full_name ?? m.user_id })),
    programs: programs.data ?? [], projects: projects.data ?? [],
    programMemberships: programMemberships.data ?? [], projectMemberships: projectMemberships.data ?? [],
    programGrants: programGrants.data ?? [], projectGrants: projectGrants.data ?? [],
  } as AccessImpactInput, t);
  return <div>
    <PageHeader title={t("admin.access.title")} description={t("admin.access.description")} />
    <AdminNav />
    <p className="card my-6 p-5">{t("admin.access.intro")}</p>
    <section aria-labelledby="access-review"><h2 id="access-review" className="section-heading">{t("admin.access.needsReview")}</h2>
      {impact.issues.length ? <ul className="my-3 list-disc space-y-2 pl-6">{impact.issues.map((issue, i) => <li key={i}>{issue}</li>)}</ul>
        : <p className="my-3 text-sm text-muted">{t("admin.access.noIssues")}</p>}
    </section>
    <section aria-labelledby="access-members"><h2 id="access-members" className="section-heading my-4">{t("admin.access.activeMembers")}</h2>
      {!impact.members.length ? <p>{t("admin.access.noActiveMembers")}</p> : <ul className="space-y-4">{impact.members.map(m => <li key={m.userId} className="card p-5">
        <h3 className="font-semibold">{m.name} <span className="text-sm font-normal text-muted">({roleCodeLabel(m.role, t)})</span></h3>
        <p className="my-2 text-sm">{t("admin.access.summary", { grants: m.grants.length, readable: m.currentReadable, losing: m.losingManagement })}</p>
        <details><summary className="cursor-pointer">{t("admin.access.proposed")}</summary>
          {m.grants.length ? <ul className="mt-2 list-disc space-y-1 pl-6">{m.grants.map(g => <li key={`${g.type}:${g.id}`}>{t("admin.access.grantLine", { type: t(g.type === "program" ? "admin.access.types.program" : "admin.access.types.project"), name: g.name, access: g.manage ? t("admin.access.manage") : t("admin.access.readOnly"), sources: g.sources.join("; ") })}</li>)}</ul> : <p className="mt-2">{t("admin.access.noExplicit")}</p>}
        </details>
        {m.losingRead.length ? <details className="mt-2"><summary className="cursor-pointer">{t("admin.access.noLongerReadable", { count: m.losingRead.length })}</summary><ul className="mt-2 list-disc pl-6">{m.losingRead.map((record, i) => <li key={i}>{record}</li>)}</ul></details> : null}
      </li>)}</ul>}
    </section>
    <DirectAccessManager
      members={(members.data ?? []).filter(member => member.status === "active").map(member => ({
        id: member.user_id,
        name: (member.profile as unknown as { full_name: string } | null)?.full_name ?? member.user_id,
      }))}
      programs={(programs.data ?? []).map(program => ({ id: program.id, name: program.name }))}
      projects={(projects.data ?? []).map(project => ({ id: project.id, name: project.name }))}
      programGrants={(programGrants.data ?? []) as { program_id: string; user_id: string; role: ProgramAccessRole }[]}
      projectGrants={(projectGrants.data ?? []) as { project_id: string; user_id: string; role: ProjectAccessRole }[]}
    />
    <TeamAssignmentManager
      teams={(teams.data ?? []).map(team => ({ id: team.id, name: team.name }))}
      programs={(programs.data ?? []).map(program => ({ id: program.id, name: program.name }))}
      projects={(projects.data ?? []).map(project => ({ id: project.id, name: project.name }))}
      programAssignments={(programTeamAssignments.data ?? []) as { program_id: string; team_id: string; role: ProgramAccessRole }[]}
      projectAssignments={(projectTeamAssignments.data ?? []) as { project_id: string; team_id: string; role: ProjectAccessRole }[]}
    />
  </div>;
}
