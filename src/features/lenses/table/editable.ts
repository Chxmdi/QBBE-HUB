/**
 * Cells the table lens edits in place (M8b). Each maps to an existing command
 * (src/features/tasks/services/task.commands.ts), so validation, notifications
 * and task history stay the same as editing from the task drawer.
 */
export const EDITABLE = {
  task: {
    title: "text",
    status: "select",
    priority: "select",
    due: "date",
    assignee: "person",
    reviewer: "person",
  },
} as const satisfies Record<string, Record<string, "text" | "select" | "date" | "person">>;

export type EditableType = keyof typeof EDITABLE;
export type EditorKind = "text" | "select" | "date" | "person";

export function editorFor(type: string, property: string): EditorKind | null {
  const byType = (EDITABLE as Record<string, Record<string, EditorKind>>)[type];
  return byType?.[property] ?? null;
}
