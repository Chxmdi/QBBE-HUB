/** Proposed program/project access only. This is not the live authorization boundary. */
export type ScopeRole = "lead" | "manager" | "contributor" | "reviewer" | "approver" | "volunteer" | "read_only" | "follower";
export function normalizeScopeRole(role: string): ScopeRole | null {
  if (role === "member") return "contributor";
  if (role === "guest") return "read_only";
  return ["lead", "manager", "contributor", "reviewer", "approver", "volunteer", "read_only", "follower"].includes(role)
    ? role as ScopeRole : null;
}
export interface AccessImpactInput {
  organizationId: string;
  members: { user_id: string; organization_id: string; role: string; status: string; name: string }[];
  programs: { id: string; organization_id: string; name: string; lead_id: string | null; status: string }[];
  projects: { id: string; organization_id: string; name: string; program_id: string | null; owner_id: string | null; stage: string; archived_at: string | null }[];
  programMemberships: { program_id: string; user_id: string; role: string }[];
  projectMemberships: { project_id: string; user_id: string; role: string }[];
  programGrants?: { program_id: string; user_id: string; role: string }[];
  projectGrants?: { project_id: string; user_id: string; role: string }[];
}
export interface ProposedGrant {
  type: "program" | "project";
  id: string;
  name: string;
  manage: boolean;
  sources: string[];
}
export function buildAccessImpact(input: AccessImpactInput) {
  const members = input.members.filter(m => m.organization_id === input.organizationId && m.status === "active");
  const programs = input.programs.filter(p => p.organization_id === input.organizationId);
  const projects = input.projects.filter(p => p.organization_id === input.organizationId);
  const activeIds = new Set(members.map(m => m.user_id));
  const issues: string[] = [];
  for (const p of programs) {
    if (p.status === "active" && (!p.lead_id || !activeIds.has(p.lead_id))) issues.push(`Program “${p.name}” needs an active program lead.`);
    if (p.status === "active" && members.some(m => m.user_id === p.lead_id && ["guest", "leadership_viewer"].includes(m.role))) issues.push(`Program “${p.name}” has a read-only organization member as lead; review management responsibility.`);
  }
  for (const p of projects) {
    if (p.stage === "active" && !p.archived_at && (!p.owner_id || !activeIds.has(p.owner_id))) issues.push(`Project “${p.name}” needs an active owner.`);
    if (p.stage === "active" && !p.archived_at && members.some(m => m.user_id === p.owner_id && ["guest", "leadership_viewer"].includes(m.role))) issues.push(`Project “${p.name}” has a read-only organization member as owner; review management responsibility.`);
    if (p.program_id && !programs.some(program => program.id === p.program_id)) issues.push(`Project “${p.name}” has an unavailable parent program.`);
  }
  const programIds = new Set(programs.map(p => p.id));
  const projectIds = new Set(projects.map(p => p.id));
  for (const m of input.programMemberships.filter(m => programIds.has(m.program_id))) {
    if (!normalizeScopeRole(m.role)) issues.push(`Program membership for ${m.user_id} has unrecognized role “${m.role}”; review before cutover.`);
  }
  for (const m of input.projectMemberships.filter(m => projectIds.has(m.project_id))) {
    if (!normalizeScopeRole(m.role)) issues.push(`Project membership for ${m.user_id} has unrecognized role “${m.role}”; review before cutover.`);
  }
  return { issues, members: members.map(member => {
    const admin = ["owner", "admin"].includes(member.role);
    const portfolioViewer = member.role === "leadership_viewer";
    const readOnly = member.role === "guest" || portfolioViewer;
    const grants: ProposedGrant[] = [];
    for (const p of programs) {
      const direct = input.programMemberships.find(m => m.program_id === p.id && m.user_id === member.user_id);
      const persisted = input.programGrants?.find(g => g.program_id === p.id && g.user_id === member.user_id);
      const sources = [admin ? "organization administrator" : "", portfolioViewer ? "leadership portfolio viewer" : "", p.lead_id === member.user_id ? "program lead" : "", direct ? `direct membership (${direct.role})` : "", persisted ? `persisted grant (${persisted.role})` : ""].filter(Boolean);
      if (sources.length) grants.push({ type: "program", id: p.id, name: p.name,
        manage: !readOnly && (admin || p.lead_id === member.user_id || !!direct && ["lead", "manager"].includes(direct.role) || !!persisted && ["lead", "manager"].includes(persisted.role)), sources });
    }
    for (const p of projects) {
      const inherited = grants.find(g => g.type === "program" && g.id === p.program_id);
      const direct = input.projectMemberships.find(m => m.project_id === p.id && m.user_id === member.user_id);
      const persisted = input.projectGrants?.find(g => g.project_id === p.id && g.user_id === member.user_id);
      const sources = [admin ? "organization administrator" : "", portfolioViewer ? "leadership portfolio viewer" : "", p.owner_id === member.user_id ? "project owner" : "", inherited ? `program membership: ${inherited.name}` : "", direct ? `direct membership (${direct.role})` : "", persisted ? `persisted grant (${persisted.role})` : ""].filter(Boolean);
      if (sources.length) grants.push({ type: "project", id: p.id, name: p.name,
        manage: !readOnly && (admin || p.owner_id === member.user_id || !!inherited?.manage || direct?.role === "manager" || persisted?.role === "project_manager"), sources });
    }
    return { userId: member.user_id, name: member.name, role: member.role, grants,
      currentReadable: programs.length + projects.length,
      losingRead: [...programs.map(p => ({ type: "program", ...p })), ...projects.map(p => ({ type: "project", ...p }))]
        .filter(p => !grants.some(g => g.type === p.type && g.id === p.id)).map(p => `${p.type}: ${p.name}`),
      losingManagement: ["owner", "admin", "staff"].includes(member.role)
        ? programs.length + projects.length - grants.filter(g => g.manage).length : 0,
    };
  }) };
}
