import { z } from "zod";
import { optionalDay, requiredText } from "@/lib/schema";
import type { TranslateFn } from "@/lib/i18n/translate";

/**
 * Milestones.
 *
 * `status` and `evidence` are the two fields worth explaining. Completing a
 * milestone requires evidence — the database says so too — because "done" with
 * nothing behind it is a claim, not a record. And `missed` is not something a
 * caller may simply assert: it is only true of a milestone whose target date
 * has passed, judged in the organization's own time zone rather than the
 * server's, which is why the command checks it and the database does not.
 */

export const MILESTONE_STATUSES = [
  "planned",
  "in_progress",
  "completed",
  "missed",
] as const;

export type MilestoneStatus = (typeof MILESTONE_STATUSES)[number];

export const MILESTONE_STATUS_LABELS: Record<MilestoneStatus, string> = {
  planned: "Planned",
  in_progress: "In progress",
  completed: "Completed",
  missed: "Missed",
};

/** A milestone status in the reader's language (#141). */
export function milestoneStatusLabel(status: MilestoneStatus, t: TranslateFn): string {
  return t(`projects.milestones.status.${status}`);
}

/** Statuses a milestone can be put into without completing it. */
export const OPEN_MILESTONE_STATUSES: MilestoneStatus[] = [
  "planned",
  "in_progress",
  "missed",
];

const optionalUuid = z.union([z.string().uuid(), z.literal("")]).optional();

export const createMilestoneSchema = z.object({
  projectId: z.string().uuid(),
  name: requiredText("A milestone needs a name.", 200),
  description: z.string().trim().max(2000).optional(),
  ownerId: optionalUuid,
  dueDate: optionalDay().optional(),
  /** A new milestone is not completed, so completion is not offered here. */
  status: z.enum(["planned", "in_progress"]).default("planned"),
});

export const updateMilestoneSchema = z.object({
  milestoneId: z.string().uuid(),
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  ownerId: optionalUuid,
  dueDate: optionalDay().nullable().optional(),
  /**
   * Completion goes through completeMilestone, which is the only path that
   * asks for evidence. Leaving it out of the edit form is what stops the
   * evidence requirement being sidestepped by editing the status directly.
   */
  status: z.enum(["planned", "in_progress", "missed"]).optional(),
  evidence: z.string().trim().max(2000).nullable().optional(),
});

export const completeMilestoneSchema = z
  .object({
    milestoneId: z.string().uuid(),
    completed: z.boolean(),
    evidence: z.string().trim().max(2000).optional(),
  })
  .refine((value) => !value.completed || Boolean(value.evidence), {
    message: "Say what shows this milestone was met.",
    path: ["evidence"],
  });

export const reorderMilestoneSchema = z.object({
  milestoneId: z.string().uuid(),
  direction: z.enum(["up", "down"]),
});

/**
 * The order a project's milestones are read in: the order somebody arranged
 * them, then by date, then by name so the result never depends on what the
 * database happened to return.
 */
export function compareMilestones(
  a: { sort_key: number; due_date: string | null; name: string },
  b: { sort_key: number; due_date: string | null; name: string },
): number {
  if (a.sort_key !== b.sort_key) return a.sort_key - b.sort_key;
  // A milestone with no date sorts after every dated one: it is unscheduled,
  // not overdue since the beginning of time.
  if (a.due_date !== b.due_date) {
    if (a.due_date === null) return 1;
    if (b.due_date === null) return -1;
    return a.due_date < b.due_date ? -1 : 1;
  }
  return a.name.localeCompare(b.name);
}

/** A new project. Kept out of the server action file so it can be tested. */
export const createProjectSchema = z.object({
  name: requiredText("A project needs a name.", 200),
  outcome: z.string().trim().max(2000).optional(),
  programId: z.string().uuid().optional(),
  ownerId: z.string().uuid().optional(),
  sponsorId: z.string().uuid().optional(),
  startDate: optionalDay().optional(),
  targetDate: optionalDay().optional(),
  priority: z.enum(["low", "medium", "high", "critical"]).default("medium"),
  health: z.enum(["on_track", "at_risk", "off_track", "paused", "unknown"]).default("unknown"),
  healthReason: z.string().trim().max(2000).optional(),
  reportingCadence: z.enum(["none", "weekly", "monthly"]).default("none"),
  fundingSourceId: z.string().uuid().optional().or(z.literal("")),
  stage: z
    .enum(["proposed", "approved", "planning", "active"])
    .default("planning"),
}).superRefine((value, ctx) => {
  if (value.stage === "active") {
    if (!value.programId || !value.outcome || !value.targetDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "An active project needs a program, outcome and target date.",
      });
    }
  }
  if ((value.health === "at_risk" || value.health === "off_track") && !value.healthReason) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Adverse health requires a reason.",
    });
  }
});

// health is deliberately absent. publishStatusUpdate is the only writer of
// project.health after creation, which is what makes P0-PRJ-04's "adverse
// health requires a reason" unbypassable through the interface. Accepting it
// here would reopen exactly that hole.
export const updateProjectSchema = z.object({
  projectId: z.string().uuid(),
  name: requiredText("A project needs a name.", 200),
  outcome: z.string().trim().max(2000).optional(),
  description: z.string().trim().max(4000).optional(),
  // Empty string means "none"; a <select> cannot submit null.
  programId: z.union([z.string().uuid(), z.literal("")]).optional(),
  ownerId: z.string().uuid({ message: "A project needs an accountable owner." }),
  sponsorId: z.union([z.string().uuid(), z.literal("")]).optional(),
  startDate: optionalDay().optional(),
  targetDate: optionalDay().optional(),
  priority: z.enum(["low", "medium", "high", "critical"]).default("medium"),
  reportingCadence: z.enum(["none", "weekly", "monthly"]).default("none"),
  fundingSourceId: z.union([z.string().uuid(), z.literal("")]).optional(),
});
