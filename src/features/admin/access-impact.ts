import { createTranslator, type TranslateFn } from "@/lib/i18n/translate";

const ENGLISH = createTranslator("en");

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
/** `t` picks the language of the issue and source text; English by default. */
export function buildAccessImpact(input: AccessImpactInput, t: TranslateFn = ENGLISH) {
  const members = input.members.filter(m => m.organization_id === input.organizationId && m.status === "active");
  const programs = input.programs.filter(p => p.organization_id === input.organizationId);
  const projects = input.projects.filter(p => p.organization_id === input.organizationId);
  const activeIds = new Set(members.map(m => m.user_id));
  const issues: string[] = [];
  for (const p of programs) {
    if (p.status === "active" && (!p.lead_id || !activeIds.has(p.lead_id))) issues.push(t("admin.access.issues.programNeedsLead", { name: p.name }));
    if (p.status === "active" && members.some(m => m.user_id === p.lead_id && ["guest", "leadership_viewer"].includes(m.role))) issues.push(t("admin.access.issues.programReadOnlyLead", { name: p.name }));
  }
  for (const p of projects) {
    if (p.stage === "active" && !p.archived_at && (!p.owner_id || !activeIds.has(p.owner_id))) issues.push(t("admin.access.issues.projectNeedsOwner", { name: p.name }));
    if (p.stage === "active" && !p.archived_at && members.some(m => m.user_id === p.owner_id && ["guest", "leadership_viewer"].includes(m.role))) issues.push(t("admin.access.issues.projectReadOnlyOwner", { name: p.name }));
    if (p.program_id && !programs.some(program => program.id === p.program_id)) issues.push(t("admin.access.issues.projectNoParent", { name: p.name }));
  }
  const programIds = new Set(programs.map(p => p.id));
  const projectIds = new Set(projects.map(p => p.id));
  for (const m of input.programMemberships.filter(m => programIds.has(m.program_id))) {
    if (!normalizeScopeRole(m.role)) issues.push(t("admin.access.issues.programUnknownRole", { user: m.user_id, role: m.role }));
  }
  for (const m of input.projectMemberships.filter(m => projectIds.has(m.project_id))) {
    if (!normalizeScopeRole(m.role)) issues.push(t("admin.access.issues.projectUnknownRole", { user: m.user_id, role: m.role }));
  }
  return { issues, members: members.map(member => {
    const admin = ["owner", "admin"].includes(member.role);
    const portfolioViewer = member.role === "leadership_viewer";
    const readOnly = member.role === "guest" || portfolioViewer;
    const grants: ProposedGrant[] = [];
    for (const p of programs) {
      const direct = input.programMemberships.find(m => m.program_id === p.id && m.user_id === member.user_id);
      const persisted = input.programGrants?.find(g => g.program_id === p.id && g.user_id === member.user_id);
      const sources = [admin ? t("admin.access.sources.orgAdmin") : "", portfolioViewer ? t("admin.access.sources.leadershipViewer") : "", p.lead_id === member.user_id ? t("admin.access.sources.programLead") : "", direct ? t("admin.access.sources.directMembership", { role: direct.role }) : "", persisted ? t("admin.access.sources.persistedGrant", { role: persisted.role }) : ""].filter(Boolean);
      if (sources.length) grants.push({ type: "program", id: p.id, name: p.name,
        manage: !readOnly && (admin || p.lead_id === member.user_id || !!direct && ["lead", "manager"].includes(direct.role) || !!persisted && ["lead", "manager"].includes(persisted.role)), sources });
    }
    for (const p of projects) {
      const inherited = grants.find(g => g.type === "program" && g.id === p.program_id);
      const direct = input.projectMemberships.find(m => m.project_id === p.id && m.user_id === member.user_id);
      const persisted = input.projectGrants?.find(g => g.project_id === p.id && g.user_id === member.user_id);
      const sources = [admin ? t("admin.access.sources.orgAdmin") : "", portfolioViewer ? t("admin.access.sources.leadershipViewer") : "", p.owner_id === member.user_id ? t("admin.access.sources.projectOwner") : "", inherited ? t("admin.access.sources.programMembership", { name: inherited.name }) : "", direct ? t("admin.access.sources.directMembership", { role: direct.role }) : "", persisted ? t("admin.access.sources.persistedGrant", { role: persisted.role }) : ""].filter(Boolean);
      if (sources.length) grants.push({ type: "project", id: p.id, name: p.name,
        manage: !readOnly && (admin || p.owner_id === member.user_id || !!inherited?.manage || direct?.role === "manager" || persisted?.role === "project_manager"), sources });
    }
    return { userId: member.user_id, name: member.name, role: member.role, grants,
      currentReadable: programs.length + projects.length,
      losingRead: [...programs.map(p => ({ type: "program", ...p })), ...projects.map(p => ({ type: "project", ...p }))]
        .filter(p => !grants.some(g => g.type === p.type && g.id === p.id)).map(p => t("admin.access.recordLine", { type: t(p.type === "program" ? "admin.access.types.program" : "admin.access.types.project"), name: p.name })),
      losingManagement: ["owner", "admin", "staff"].includes(member.role)
        ? programs.length + projects.length - grants.filter(g => g.manage).length : 0,
    };
  }) };
}
