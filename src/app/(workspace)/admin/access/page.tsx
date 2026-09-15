import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { readAll } from "@/lib/supabase/read-all";
import { PageHeader } from "@/components/shared/page-header";
import { AdminNav } from "@/features/admin/components/admin-nav";
import { DirectAccessManager } from "@/features/admin/components/direct-access-manager";
import { TeamAssignmentManager } from "@/features/admin/components/team-assignment-control";
import { buildAccessImpact, type AccessImpactInput } from "@/features/admin/access-impact";
import type { ProgramAccessRole, ProjectAccessRole } from "@/lib/access-capabilities";

export const metadata: Metadata = { title: "Access impact" };
export const dynamic = "force-dynamic";

export default async function AccessImpactPage() {
  const session = await requireAdmin();
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
  if (failed) return <div><PageHeader title="Access impact" /><AdminNav /><p role="alert" className="card mt-6 p-5">Could not load the complete access inventory. Reload to retry. No cutover assessment is available.</p></div>;
  const impact = buildAccessImpact({ organizationId: session.organizationId,
    members: (members.data ?? []).map(m => ({ ...m, name: (m.profile as unknown as { full_name: string } | null)?.full_name ?? m.user_id })),
    programs: programs.data ?? [], projects: projects.data ?? [],
    programMemberships: programMemberships.data ?? [], projectMemberships: projectMemberships.data ?? [],
    programGrants: programGrants.data ?? [], projectGrants: projectGrants.data ?? [],
  } as AccessImpactInput);
  return <div>
    <PageHeader title="Access impact" description="Review proposed program and project access before replacing broad staff permissions." />
    <AdminNav />
    <p className="card my-6 p-5">Live grants are shown below and are already enforced for programs, projects, meetings, events, documents and reports. The member inventory still highlights owner, lead, membership and persisted-grant sources plus access that would disappear if a leftover staff path were removed. It is not an automatic backfill.</p>
    <section aria-labelledby="access-review"><h2 id="access-review" className="section-heading">Needs review</h2>
      {impact.issues.length ? <ul className="my-3 list-disc space-y-2 pl-6">{impact.issues.map((issue, i) => <li key={i}>{issue}</li>)}</ul>
        : <p className="my-3 text-sm text-muted">No missing active owners/leads or unrecognized roles found. Review each member’s proposed access below.</p>}
    </section>
    <section aria-labelledby="access-members"><h2 id="access-members" className="section-heading my-4">Active members</h2>
      {!impact.members.length ? <p>No active members found.</p> : <ul className="space-y-4">{impact.members.map(m => <li key={m.userId} className="card p-5">
        <h3 className="font-semibold">{m.name} <span className="text-sm font-normal text-muted">({m.role})</span></h3>
        <p className="my-2 text-sm">{m.grants.length} proposed readable records of {m.currentReadable} currently readable; {m.losingManagement} management grants would be removed.</p>
        <details><summary className="cursor-pointer">Proposed access and sources</summary>
          {m.grants.length ? <ul className="mt-2 list-disc space-y-1 pl-6">{m.grants.map(g => <li key={`${g.type}:${g.id}`}>{g.type}: {g.name} — {g.manage ? "Manage" : "Read; collaboration depends on role"}. Sources: {g.sources.join("; ")}</li>)}</ul> : <p className="mt-2">No explicit program/project access. Assign relevant work before cutover.</p>}
        </details>
        {m.losingRead.length ? <details className="mt-2"><summary className="cursor-pointer">Records no longer readable ({m.losingRead.length})</summary><ul className="mt-2 list-disc pl-6">{m.losingRead.map((record, i) => <li key={i}>{record}</li>)}</ul></details> : null}
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
