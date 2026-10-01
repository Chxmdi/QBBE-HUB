import type { TaskStatus } from "@/types/entities";

/**
 * The tasks a meeting produced, read live from the task table (F3): the
 * meeting shows the task's own status, due date and owner, never the copy a
 * capture took when it was written. A task comes from the meeting when its
 * source names it (M7b), whether the end-of-meeting review made it from a
 * capture or a `/task` block in the notes made it directly.
 */
export interface LiveTask {
  id: string;
  title: string;
  status: TaskStatus;
  /** YYYY-MM-DD, or null. */
  dueOn: string | null;
  assigneeName: string | null;
  archived: boolean;
}

interface TaskCapture {
  createdObjectType: "task" | "decision" | null;
  createdObjectId: string | null;
}

/** Each approved task capture with its task, when the reader can see the task. */
export function attachLiveTasks<C extends TaskCapture>(captures: C[], tasks: LiveTask[]): (C & { task: LiveTask | null })[] {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  return captures.map((capture) => ({
    ...capture,
    task: capture.createdObjectType === "task" && capture.createdObjectId ? (byId.get(capture.createdObjectId) ?? null) : null,
  }));
}

/**
 * Tasks the meeting produced outside the review: written in the notes as a
 * `/task` block or a "Make a task" suggestion. The review lists them so it
 * shows everything the meeting created, not only what it approved.
 */
export function tasksFromNotes(tasks: LiveTask[], captures: TaskCapture[]): LiveTask[] {
  const reviewed = new Set(captures.filter((c) => c.createdObjectType === "task" && c.createdObjectId).map((c) => c.createdObjectId));
  return tasks.filter((task) => !task.archived && !reviewed.has(task.id));
}
