import type { UniversalTaskInput } from "@/features/universal-tasks/create-task";

/**
 * The shared `task.create` input for an approved task or follow-up capture
 * (M7a's action, src/features/universal-tasks). The task lands in the
 * meeting's project (or its program when it has none), is assigned to the
 * capture's owner, and records the meeting as its source.
 */
export function meetingTaskInput(
  capture: { body: string; detail: string | null; owner_id: string | null; due_on: string | null },
  meeting: { id: string; project_id: string | null; program_id: string | null },
): UniversalTaskInput {
  return {
    title: capture.body.trim(),
    description: capture.detail ?? undefined,
    projectId: meeting.project_id ?? undefined,
    programId: meeting.project_id ? undefined : (meeting.program_id ?? undefined),
    assigneeId: capture.owner_id ?? undefined,
    dueAt: capture.due_on ?? undefined,
    source: { type: "meeting", id: meeting.id },
  };
}
