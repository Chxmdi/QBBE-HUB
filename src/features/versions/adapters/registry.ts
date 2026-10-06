import type { ObjectContentAdapter } from "../content";
import { meetingContentAdapter } from "./meeting-adapter";
import { pageContentAdapter } from "./page-adapter";
import { taskContentAdapter } from "./task-adapter";

/**
 * Which adapter reads and writes each type's content: the task description as
 * one block, and the block editor's document for pages and meetings (U9).
 */
const ADAPTERS: Record<string, ObjectContentAdapter> = {
  task: taskContentAdapter,
  page: pageContentAdapter,
  meeting: meetingContentAdapter,
};

/** Types whose content is a block-editor document rather than one text field. */
export const editorDocumentTypes = ["page", "meeting"] as const;
export type EditorDocumentType = (typeof editorDocumentTypes)[number];

export function isEditorDocumentType(type: string): type is EditorDocumentType {
  return (editorDocumentTypes as readonly string[]).includes(type);
}

export function contentAdapterFor(type: string): ObjectContentAdapter | null {
  return ADAPTERS[type] ?? null;
}
