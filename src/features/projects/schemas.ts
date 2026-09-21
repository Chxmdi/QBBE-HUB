import { z } from "zod";
import { requiredText } from "@/lib/schema";

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
  dueDate: z.string().optional(),
  /** A new milestone is not completed, so completion is not offered here. */
  status: z.enum(["planned", "in_progress"]).default("planned"),
});

export const updateMilestoneSchema = z.object({
  milestoneId: z.string().uuid(),
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  ownerId: optionalUuid,
  dueDate: z.string().nullable().optional(),
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
