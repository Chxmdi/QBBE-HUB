import { z } from "zod";
import type { LocalizedText } from "@/lib/objects/contracts";

/**
 * The workflow actions' keys, labels and input shapes, with no server code, so
 * the workflow screen can offer them. The actions themselves are in actions.ts.
 */

export const taskStatuses = [
  "not_started",
  "ready",
  "in_progress",
  "waiting",
  "blocked",
  "in_review",
  "completed",
  "cancelled",
] as const;
export const taskPriorities = ["low", "medium", "high", "critical"] as const;

const uuid = z.string().uuid();

export const actionInputSchemas = {
  "task.set_status": z.object({ taskId: uuid, status: z.enum(taskStatuses) }).strict(),
  "task.set_priority": z.object({ taskId: uuid, priority: z.enum(taskPriorities) }).strict(),
  "task.assign": z.object({ taskId: uuid, assigneeId: uuid.nullable() }).strict(),
  "notification.send": z.object({
    userId: uuid,
    title: z.string().trim().min(1).max(200),
    link: z.string().trim().max(500).regex(/^\/(?!\/)/, "A link must start with a single /.").optional(),
  }).strict(),
} as const;

export type WorkflowActionKey = keyof typeof actionInputSchemas;
export const workflowActionKeys = Object.keys(actionInputSchemas) as WorkflowActionKey[];

export const workflowActionLabels: Record<WorkflowActionKey, LocalizedText> = {
  "task.set_status": { en: "Set a task's status", fr: "Changer le statut d’une tâche" },
  "task.set_priority": { en: "Set a task's priority", fr: "Changer la priorité d’une tâche" },
  "task.assign": { en: "Assign a task", fr: "Assigner une tâche" },
  "notification.send": { en: "Notify a person", fr: "Aviser une personne" },
};
