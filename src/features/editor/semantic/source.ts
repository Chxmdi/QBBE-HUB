/**
 * Where a task made from a block comes from (M7b). A block in a page records
 * the page; a block in a meeting's notes records the meeting, as a capture
 * approved in the review does; a block in a task's description records
 * nothing (there is no "task" source), so it stays `manual`.
 */
export type EditorObjectType = "page" | "task" | "meeting";

export type BlockTaskSource = { type: "page" | "meeting"; id: string };

export function blockTaskSource(objectType: EditorObjectType, objectId: string): BlockTaskSource | undefined {
  if (objectType === "page" || objectType === "meeting") return { type: objectType, id: objectId };
  return undefined;
}
