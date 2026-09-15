"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Label, Select } from "@/components/ui/input";
import {
  programAccessRoles,
  projectAccessRoles,
  type ProgramAccessRole,
  type ProjectAccessRole,
} from "@/lib/access-capabilities";
import {
  assignTeamToProgram,
  assignTeamToProject,
  removeTeamAssignment,
} from "@/features/admin/services/team.commands";

type Option = { id: string; name: string };
type ProgramAssignment = {
  program_id: string;
  team_id: string;
  role: ProgramAccessRole;
};
type ProjectAssignment = {
  project_id: string;
  team_id: string;
  role: ProjectAccessRole;
};
type Operation = "program-save" | "project-save" | `program-remove:${string}` | `project-remove:${string}`;

const roleLabel = (role: string) => role.replaceAll("_", " ");

function currentProgramRole(
  assignments: ProgramAssignment[],
  teamId: string,
  programId: string,
): ProgramAccessRole {
  return assignments.find(
    (assignment) => assignment.team_id === teamId && assignment.program_id === programId,
  )?.role ?? "contributor";
}

function currentProjectRole(
  assignments: ProjectAssignment[],
  teamId: string,
  projectId: string,
): ProjectAccessRole {
  return assignments.find(
    (assignment) => assignment.team_id === teamId && assignment.project_id === projectId,
  )?.role ?? "contributor";
}

export function TeamAssignmentManager({
  teams,
  programs,
  projects,
  programAssignments,
  projectAssignments,
}: {
  teams: Option[];
  programs: Option[];
  projects: Option[];
  programAssignments: ProgramAssignment[];
  projectAssignments: ProjectAssignment[];
}) {
  const router = useRouter();
  const [isTransitioning, startTransition] = useTransition();
  const [operation, setOperation] = useState<Operation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [programTeamId, setProgramTeamId] = useState(teams[0]?.id ?? "");
  const [programId, setProgramId] = useState(programs[0]?.id ?? "");
  const [programRole, setProgramRole] = useState<ProgramAccessRole>(() =>
    currentProgramRole(programAssignments, teams[0]?.id ?? "", programs[0]?.id ?? ""),
  );
  const [projectTeamId, setProjectTeamId] = useState(teams[0]?.id ?? "");
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [projectRole, setProjectRole] = useState<ProjectAccessRole>(() =>
    currentProjectRole(projectAssignments, teams[0]?.id ?? "", projects[0]?.id ?? ""),
  );

  const teamNames = new Map(teams.map((team) => [team.id, team.name]));
  const programNames = new Map(programs.map((program) => [program.id, program.name]));
  const projectNames = new Map(projects.map((project) => [project.id, project.name]));
  const pending = operation !== null || isTransitioning;

  function begin(nextOperation: Operation, run: () => Promise<{ ok: boolean; error?: string }>, success: string) {
    setOperation(nextOperation);
    setError(null);
    setNotice(null);
    startTransition(async () => {
      try {
        const result = await run();
        if (!result.ok) {
          setError(result.error ?? "Could not update the team assignment.");
          return;
        }
        setNotice(success);
        router.refresh();
      } catch {
        setError("Could not update the team assignment. Reload and try again.");
      } finally {
        setOperation(null);
      }
    });
  }

  function saveProgram(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    begin(
      "program-save",
      () => assignTeamToProgram({ teamId: programTeamId, programId, role: programRole }),
      "Program team assignment saved.",
    );
  }

  function saveProject(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    begin(
      "project-save",
      () => assignTeamToProject({ teamId: projectTeamId, projectId, role: projectRole }),
      "Project team assignment saved.",
    );
  }

  function changeProgramTeam(teamId: string) {
    setProgramTeamId(teamId);
    setProgramRole(currentProgramRole(programAssignments, teamId, programId));
  }

  function changeProgram(programId: string) {
    setProgramId(programId);
    setProgramRole(currentProgramRole(programAssignments, programTeamId, programId));
  }

  function changeProjectTeam(teamId: string) {
    setProjectTeamId(teamId);
    setProjectRole(currentProjectRole(projectAssignments, teamId, projectId));
  }

  function changeProject(projectId: string) {
    setProjectId(projectId);
    setProjectRole(currentProjectRole(projectAssignments, projectTeamId, projectId));
  }

  return (
    <section aria-labelledby="team-access" className="mt-8">
      <h2 id="team-access" className="section-heading">Team access</h2>
      <p className="mt-2 text-sm text-muted">
        An assignment grants every active team member the selected role. Removing it keeps any owner, lead, direct, or other team access.
      </p>
      {error ? <p role="alert" className="mt-3 text-sm text-danger-fg">{error}</p> : null}
      {notice ? <p role="status" className="mt-3 text-sm text-success-fg">{notice}</p> : null}

      {!teams.length ? (
        <p className="card mt-4 p-5 text-sm text-muted">Create a team before assigning team access.</p>
      ) : (
        <div className="mt-4 grid gap-5 xl:grid-cols-2">
          <div className="card p-5">
            <h3 className="font-semibold">Program assignments</h3>
            {!programs.length ? (
              <p className="mt-4 text-sm text-muted">Create a program before assigning this team.</p>
            ) : null}
            <form onSubmit={saveProgram} className="mt-4 grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="program-team-assignment-team">Team</Label>
                <Select
                  id="program-team-assignment-team"
                  value={programTeamId}
                  onChange={(event) => changeProgramTeam(event.target.value)}
                  disabled={pending}
                  required
                >
                  {teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
                </Select>
              </div>
              <div>
                <Label htmlFor="program-team-assignment-program">Program</Label>
                <Select
                  id="program-team-assignment-program"
                  value={programId}
                  onChange={(event) => changeProgram(event.target.value)}
                  disabled={pending || !programs.length}
                  required
                >
                  {programs.map((program) => <option key={program.id} value={program.id}>{program.name}</option>)}
                </Select>
              </div>
              <div>
                <Label htmlFor="program-team-assignment-role">Role</Label>
                <Select
                  id="program-team-assignment-role"
                  value={programRole}
                  onChange={(event) => setProgramRole(event.target.value as ProgramAccessRole)}
                  disabled={pending}
                >
                  {programAccessRoles.map((role) => <option key={role} value={role}>{roleLabel(role)}</option>)}
                </Select>
              </div>
              <div className="flex items-end">
                <Button
                  type="submit"
                  loading={operation === "program-save"}
                  disabled={pending || !programs.length}
                  className="w-full"
                >
                  Add or update program assignment
                </Button>
              </div>
            </form>
            <AssignmentList
              empty="No program team assignments."
              rows={programAssignments.map((assignment) => ({
                key: `${assignment.program_id}:${assignment.team_id}`,
                label: `${teamNames.get(assignment.team_id) ?? "Unknown team"} · ${programNames.get(assignment.program_id) ?? "Unknown program"} · ${roleLabel(assignment.role)}`,
                remove: () => begin(
                  `program-remove:${assignment.program_id}:${assignment.team_id}`,
                  () => removeTeamAssignment("program", assignment.program_id, assignment.team_id),
                  "Program team assignment removed.",
                ),
                loading: operation === `program-remove:${assignment.program_id}:${assignment.team_id}`,
              }))}
              disabled={pending}
            />
          </div>

          <div className="card p-5">
            <h3 className="font-semibold">Project assignments</h3>
            {!projects.length ? (
              <p className="mt-4 text-sm text-muted">Create a project before assigning this team.</p>
            ) : null}
            <form onSubmit={saveProject} className="mt-4 grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="project-team-assignment-team">Team</Label>
                <Select
                  id="project-team-assignment-team"
                  value={projectTeamId}
                  onChange={(event) => changeProjectTeam(event.target.value)}
                  disabled={pending}
                  required
                >
                  {teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
                </Select>
              </div>
              <div>
                <Label htmlFor="project-team-assignment-project">Project</Label>
                <Select
                  id="project-team-assignment-project"
                  value={projectId}
                  onChange={(event) => changeProject(event.target.value)}
                  disabled={pending || !projects.length}
                  required
                >
                  {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
                </Select>
              </div>
              <div>
                <Label htmlFor="project-team-assignment-role">Role</Label>
                <Select
                  id="project-team-assignment-role"
                  value={projectRole}
                  onChange={(event) => setProjectRole(event.target.value as ProjectAccessRole)}
                  disabled={pending}
                >
                  {projectAccessRoles.map((role) => <option key={role} value={role}>{roleLabel(role)}</option>)}
                </Select>
              </div>
              <div className="flex items-end">
                <Button
                  type="submit"
                  loading={operation === "project-save"}
                  disabled={pending || !projects.length}
                  className="w-full"
                >
                  Add or update project assignment
                </Button>
              </div>
            </form>
            <AssignmentList
              empty="No project team assignments."
              rows={projectAssignments.map((assignment) => ({
                key: `${assignment.project_id}:${assignment.team_id}`,
                label: `${teamNames.get(assignment.team_id) ?? "Unknown team"} · ${projectNames.get(assignment.project_id) ?? "Unknown project"} · ${roleLabel(assignment.role)}`,
                remove: () => begin(
                  `project-remove:${assignment.project_id}:${assignment.team_id}`,
                  () => removeTeamAssignment("project", assignment.project_id, assignment.team_id),
                  "Project team assignment removed.",
                ),
                loading: operation === `project-remove:${assignment.project_id}:${assignment.team_id}`,
              }))}
              disabled={pending}
            />
          </div>
        </div>
      )}
    </section>
  );
}

function AssignmentList({
  rows,
  empty,
  disabled,
}: {
  rows: { key: string; label: string; remove: () => void; loading: boolean }[];
  empty: string;
  disabled: boolean;
}) {
  if (!rows.length) return <p className="mt-4 text-sm text-muted">{empty}</p>;
  return (
    <ul className="mt-4 divide-y divide-line border-t border-line">
      {rows.map((row) => (
        <li key={row.key} className="flex items-center justify-between gap-3 py-3 text-sm">
          <span>{row.label}</span>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            loading={row.loading}
            disabled={disabled}
            onClick={row.remove}
            aria-label={`Remove ${row.label}`}
          >
            Remove
          </Button>
        </li>
      ))}
    </ul>
  );
}
