"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label, Select } from "@/components/ui/input";
import {
  programAccessRoles,
  projectAccessRoles,
  type ProgramAccessRole,
  type ProjectAccessRole,
} from "@/lib/access-capabilities";
import {
  setDirectProgramAccess,
  setDirectProjectAccess,
} from "@/features/admin/services/access-grant.commands";

type Option = { id: string; name: string };
type ProgramGrant = { program_id: string; user_id: string; role: ProgramAccessRole };
type ProjectGrant = { project_id: string; user_id: string; role: ProjectAccessRole };

const roleLabel = (role: string) => role.replaceAll("_", " ");

export function DirectAccessManager({
  members,
  programs,
  projects,
  programGrants,
  projectGrants,
}: {
  members: Option[];
  programs: Option[];
  projects: Option[];
  programGrants: ProgramGrant[];
  projectGrants: ProjectGrant[];
}) {
  const router = useRouter();
  const [programMember, setProgramMember] = useState(members[0]?.id ?? "");
  const [programId, setProgramId] = useState(programs[0]?.id ?? "");
  const [programRole, setProgramRole] = useState<ProgramAccessRole>("contributor");
  const [projectMember, setProjectMember] = useState(members[0]?.id ?? "");
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [projectRole, setProjectRole] = useState<ProjectAccessRole>("contributor");
  const [pending, setPending] = useState<"program" | "project" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const memberNames = new Map(members.map((member) => [member.id, member.name]));
  const programNames = new Map(programs.map((program) => [program.id, program.name]));
  const projectNames = new Map(projects.map((project) => [project.id, project.name]));

  async function saveProgram(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending("program");
    setError(null);
    const result = await setDirectProgramAccess({
      programId,
      userId: programMember,
      role: programRole,
    });
    setPending(null);
    if (!result.ok) return setError(result.error ?? "Could not update access.");
    router.refresh();
  }

  async function saveProject(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending("project");
    setError(null);
    const result = await setDirectProjectAccess({
      projectId,
      userId: projectMember,
      role: projectRole,
    });
    setPending(null);
    if (!result.ok) return setError(result.error ?? "Could not update access.");
    router.refresh();
  }

  async function removeProgram(grant: ProgramGrant) {
    setPending("program");
    setError(null);
    const result = await setDirectProgramAccess({
      programId: grant.program_id,
      userId: grant.user_id,
      role: null,
    });
    setPending(null);
    if (!result.ok) return setError(result.error ?? "Could not remove access.");
    router.refresh();
  }

  async function removeProject(grant: ProjectGrant) {
    setPending("project");
    setError(null);
    const result = await setDirectProjectAccess({
      projectId: grant.project_id,
      userId: grant.user_id,
      role: null,
    });
    setPending(null);
    if (!result.ok) return setError(result.error ?? "Could not remove access.");
    router.refresh();
  }

  return (
    <section aria-labelledby="direct-access" className="mt-8">
      <h2 id="direct-access" className="section-heading">Direct access</h2>
      <p className="mt-2 text-sm text-muted">
        Direct grants coexist with owner, lead, program, and team access. Removing one direct grant keeps every independent source.
      </p>
      {error ? <p role="alert" className="mt-3 text-sm text-danger-fg">{error}</p> : null}

      <div className="mt-4 grid gap-5 xl:grid-cols-2">
        <div className="card p-5">
          <h3 className="font-semibold">Program access</h3>
          <form onSubmit={saveProgram} className="mt-4 grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="program-grant-member">Member</Label>
              <Select id="program-grant-member" value={programMember} onChange={(event) => setProgramMember(event.target.value)} required>
                {members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
              </Select>
            </div>
            <div>
              <Label htmlFor="program-grant-program">Program</Label>
              <Select id="program-grant-program" value={programId} onChange={(event) => setProgramId(event.target.value)} required>
                {programs.map((program) => <option key={program.id} value={program.id}>{program.name}</option>)}
              </Select>
            </div>
            <div>
              <Label htmlFor="program-grant-role">Role</Label>
              <Select id="program-grant-role" value={programRole} onChange={(event) => setProgramRole(event.target.value as ProgramAccessRole)}>
                {programAccessRoles.map((role) => <option key={role} value={role}>{roleLabel(role)}</option>)}
              </Select>
            </div>
            <div className="flex items-end">
              <Button type="submit" loading={pending === "program"} disabled={!members.length || !programs.length} className="w-full">Save program access</Button>
            </div>
          </form>
          <GrantList
            empty="No direct program grants."
            rows={programGrants.map((grant) => ({
              key: `${grant.program_id}:${grant.user_id}`,
              label: `${memberNames.get(grant.user_id) ?? "Unknown member"} · ${programNames.get(grant.program_id) ?? "Unknown program"} · ${roleLabel(grant.role)}`,
              remove: () => removeProgram(grant),
            }))}
            disabled={pending !== null}
          />
        </div>

        <div className="card p-5">
          <h3 className="font-semibold">Project access</h3>
          <form onSubmit={saveProject} className="mt-4 grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="project-grant-member">Member</Label>
              <Select id="project-grant-member" value={projectMember} onChange={(event) => setProjectMember(event.target.value)} required>
                {members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
              </Select>
            </div>
            <div>
              <Label htmlFor="project-grant-project">Project</Label>
              <Select id="project-grant-project" value={projectId} onChange={(event) => setProjectId(event.target.value)} required>
                {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
              </Select>
            </div>
            <div>
              <Label htmlFor="project-grant-role">Role</Label>
              <Select id="project-grant-role" value={projectRole} onChange={(event) => setProjectRole(event.target.value as ProjectAccessRole)}>
                {projectAccessRoles.map((role) => <option key={role} value={role}>{roleLabel(role)}</option>)}
              </Select>
            </div>
            <div className="flex items-end">
              <Button type="submit" loading={pending === "project"} disabled={!members.length || !projects.length} className="w-full">Save project access</Button>
            </div>
          </form>
          <GrantList
            empty="No direct project grants."
            rows={projectGrants.map((grant) => ({
              key: `${grant.project_id}:${grant.user_id}`,
              label: `${memberNames.get(grant.user_id) ?? "Unknown member"} · ${projectNames.get(grant.project_id) ?? "Unknown project"} · ${roleLabel(grant.role)}`,
              remove: () => removeProject(grant),
            }))}
            disabled={pending !== null}
          />
        </div>
      </div>
    </section>
  );
}

function GrantList({
  rows,
  empty,
  disabled,
}: {
  rows: { key: string; label: string; remove: () => void }[];
  empty: string;
  disabled: boolean;
}) {
  if (!rows.length) return <p className="mt-4 text-sm text-muted">{empty}</p>;
  return (
    <ul className="mt-4 divide-y divide-line border-t border-line">
      {rows.map((row) => (
        <li key={row.key} className="flex items-center justify-between gap-3 py-3 text-sm">
          <span>{row.label}</span>
          <button type="button" onClick={row.remove} disabled={disabled} className="shrink-0 font-medium text-danger-fg hover:underline disabled:opacity-50">
            Remove
          </button>
        </li>
      ))}
    </ul>
  );
}

