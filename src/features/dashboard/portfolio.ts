import { z } from "zod";
import { isProjectStale } from "@/features/projects/stale";
import type { OrgRole, ProjectHealth, ProjectStage } from "@/types/entities";

export const PROJECT_STAGES = [
  "proposed",
  "approved",
  "planning",
  "active",
  "paused",
  "completed",
  "cancelled",
  "archived",
] as const satisfies readonly ProjectStage[];

export const PROJECT_HEALTHS = [
  "on_track",
  "at_risk",
  "off_track",
  "paused",
  "unknown",
] as const satisfies readonly ProjectHealth[];

const optionalUuid = z.string().uuid().optional();
const optionalDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .optional();

export const portfolioFilterSchema = z.object({
  program: optionalUuid,
  owner: optionalUuid,
  member: optionalUuid,
  health: z.enum(PROJECT_HEALTHS).optional(),
  priority: z.enum(["low", "medium", "high", "critical"]).optional(),
  stage: z.enum(PROJECT_STAGES).optional(),
  status: z.enum(PROJECT_STAGES).optional(),
  from: optionalDate,
  to: optionalDate,
  stale: z.literal("1").optional(),
  funding: optionalUuid,
});

export type PortfolioFilters = z.infer<typeof portfolioFilterSchema>;

export type DashboardLens = "leadership" | "staff" | "volunteer";

/** Leadership sees the portfolio. Volunteers do not. Staff see their own slice. */
export function dashboardLens(role: OrgRole): DashboardLens {
  if (role === "owner" || role === "admin" || role === "leadership_viewer") return "leadership";
  if (role === "volunteer" || role === "guest") return "volunteer";
  return "staff";
}

export function parsePortfolioFilters(
  input: Record<string, string | string[] | undefined>,
): PortfolioFilters {
  const one = (value: string | string[] | undefined) =>
    Array.isArray(value) ? value[0] : value;
  const raw = {
    program: one(input.program) || undefined,
    owner: one(input.owner) || undefined,
    member: one(input.member) || undefined,
    health: one(input.health) || undefined,
    priority: one(input.priority) || undefined,
    stage: one(input.stage) || undefined,
    status: one(input.status) || undefined,
    from: one(input.from) || undefined,
    to: one(input.to) || undefined,
    stale: one(input.stale) || undefined,
    funding: one(input.funding) || undefined,
  };
  const parsed = portfolioFilterSchema.safeParse(raw);
  return parsed.success ? parsed.data : {};
}

export interface PortfolioSource {
  id: string;
  name: string;
  programId: string | null;
  programName: string | null;
  ownerId: string | null;
  ownerName: string | null;
  health: ProjectHealth;
  stage: ProjectStage;
  priority: string;
  targetDate: string | null;
  progressPercent: number;
  nextMilestone: string | null;
  nextMilestoneDue: string | null;
  mainBlocker: string | null;
  lastUpdateAt: string | null;
  createdAt: string;
  reportingCadence: string | null;
  stale: boolean;
  archivedAt: string | null;
  fundingSourceId: string | null;
}

export function applyPortfolioFilters(
  rows: PortfolioSource[],
  filters: PortfolioFilters,
  memberProjectIds: ReadonlySet<string>,
): PortfolioSource[] {
  return rows.filter((row) => {
    if (filters.program && row.programId !== filters.program) return false;
    if (filters.owner && row.ownerId !== filters.owner) return false;
    if (filters.member && !memberProjectIds.has(row.id)) return false;
    if (filters.health && row.health !== filters.health) return false;
    if (filters.priority && row.priority !== filters.priority) return false;
    if (filters.stage && row.stage !== filters.stage) return false;
    if (filters.status && row.stage !== filters.status) return false;
    if (filters.stale === "1" && !row.stale) return false;
    if (filters.from && (!row.targetDate || row.targetDate < filters.from)) return false;
    if (filters.to && (!row.targetDate || row.targetDate > filters.to)) return false;
    if (filters.funding && row.fundingSourceId !== filters.funding) return false;
    return true;
  });
}

export function portfolioCounts(rows: PortfolioSource[]) {
  const active = rows.filter(
    (row) => !row.archivedAt && ["approved", "planning", "active"].includes(row.stage),
  );
  return {
    active: active.length,
    onTrack: active.filter((row) => row.health === "on_track").length,
    atRisk: active.filter((row) => row.health === "at_risk").length,
    offTrack: active.filter((row) => row.health === "off_track").length,
    paused: rows.filter((row) => row.health === "paused" || row.stage === "paused").length,
    stale: active.filter((row) => row.stale).length,
  };
}

export function markStale<T extends {
  reporting_cadence?: string | null;
  last_status_update_at?: string | null;
  created_at?: string | null;
  stage?: string | null;
  archived_at?: string | null;
}>(row: T, now: Date): boolean {
  return isProjectStale(row, now);
}

export const OVERLOAD_HOURS = 40;
export const OVERLOAD_OVERDUE = 3;

export interface WorkloadPerson {
  userId: string;
  name: string;
  active: number;
  dueSoon: number;
  overdue: number;
  estimatedHours: number | null;
  unknownEstimates: number;
  nearTermHours: number | null;
  overloaded: boolean;
}

export interface WorkloadTeam {
  teamId: string;
  name: string;
  active: number;
  dueSoon: number;
  overdue: number;
  estimatedHours: number | null;
  unknownEstimates: number;
  overloaded: boolean;
}

export function isOverloaded(person: {
  overdue: number;
  nearTermHours: number | null;
}): boolean {
  if (person.overdue >= OVERLOAD_OVERDUE) return true;
  return person.nearTermHours !== null && person.nearTermHours > OVERLOAD_HOURS;
}

export function summarizeWorkload(
  tasks: {
    assigneeId: string | null;
    assigneeName: string | null;
    dueAt: string | null;
    estimateHours: number | null;
  }[],
  today: string,
  weekOut: string,
): WorkloadPerson[] {
  const byPerson = new Map<string, WorkloadPerson & { nearTermKnown: number; nearTermUnknown: number }>();
  for (const task of tasks) {
    if (!task.assigneeId) continue;
    const current = byPerson.get(task.assigneeId) ?? {
      userId: task.assigneeId,
      name: task.assigneeName ?? "Unknown",
      active: 0,
      dueSoon: 0,
      overdue: 0,
      estimatedHours: 0,
      unknownEstimates: 0,
      nearTermHours: 0,
      overloaded: false,
      nearTermKnown: 0,
      nearTermUnknown: 0,
    };
    current.active += 1;
    if (task.dueAt && task.dueAt < today) current.overdue += 1;
    else if (task.dueAt && task.dueAt <= weekOut) current.dueSoon += 1;
    if (task.estimateHours === null) current.unknownEstimates += 1;
    else current.estimatedHours = (current.estimatedHours ?? 0) + task.estimateHours;
    if (task.dueAt && task.dueAt >= today && task.dueAt <= weekOut) {
      if (task.estimateHours === null) current.nearTermUnknown += 1;
      else {
        current.nearTermKnown += 1;
        current.nearTermHours = (current.nearTermHours ?? 0) + task.estimateHours;
      }
    }
    byPerson.set(task.assigneeId, current);
  }
  return [...byPerson.values()]
    .map((person) => {
      const nearTermHours =
        person.nearTermKnown === 0 ? null : person.nearTermHours;
      const estimatedHours =
        person.unknownEstimates === person.active ? null : person.estimatedHours;
      return {
        userId: person.userId,
        name: person.name,
        active: person.active,
        dueSoon: person.dueSoon,
        overdue: person.overdue,
        estimatedHours,
        unknownEstimates: person.unknownEstimates,
        nearTermHours,
        overloaded: isOverloaded({ overdue: person.overdue, nearTermHours }),
      };
    })
    .sort((a, b) => b.active - a.active || a.name.localeCompare(b.name));
}

export function rollupWorkloadByTeam(
  people: WorkloadPerson[],
  memberships: { teamId: string; teamName: string; userId: string }[],
): WorkloadTeam[] {
  const byTeam = new Map<string, WorkloadTeam & { knownHours: number }>();
  for (const membership of memberships) {
    const person = people.find((row) => row.userId === membership.userId);
    if (!person) continue;
    const current = byTeam.get(membership.teamId) ?? {
      teamId: membership.teamId,
      name: membership.teamName,
      active: 0,
      dueSoon: 0,
      overdue: 0,
      estimatedHours: 0,
      unknownEstimates: 0,
      overloaded: false,
      knownHours: 0,
    };
    current.active += person.active;
    current.dueSoon += person.dueSoon;
    current.overdue += person.overdue;
    current.unknownEstimates += person.unknownEstimates;
    if (person.estimatedHours !== null) current.knownHours += person.estimatedHours;
    if (person.overloaded) current.overloaded = true;
    byTeam.set(membership.teamId, current);
  }
  return [...byTeam.values()]
    .map((team) => ({
      teamId: team.teamId,
      name: team.name,
      active: team.active,
      dueSoon: team.dueSoon,
      overdue: team.overdue,
      estimatedHours: team.unknownEstimates > 0 && team.knownHours === 0 ? null : team.knownHours,
      unknownEstimates: team.unknownEstimates,
      overloaded: team.overloaded,
    }))
    .sort((a, b) => b.active - a.active || a.name.localeCompare(b.name));
}
