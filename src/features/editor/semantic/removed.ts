import { walkBlocks, type EditorContent } from "@/features/editor/adapter/content";

/** The task objects a document's task blocks point at. */
export function taskBlockIds(content: EditorContent): Set<string> {
  const ids = new Set<string>();
  for (const { block } of walkBlocks(content.blocks)) {
    const id = block.props?.objectId;
    if (block.type === "task" && typeof id === "string" && id) ids.add(id);
  }
  return ids;
}

/**
 * Tasks whose block disappeared between two versions of a document. A block
 * that moved, or that still appears elsewhere, is not removed.
 */
export function removedTaskIds(before: EditorContent, after: EditorContent): string[] {
  const now = taskBlockIds(after);
  return [...taskBlockIds(before)].filter((id) => !now.has(id));
}
