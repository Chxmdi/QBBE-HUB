import type { ObjectRef, ObjectTypeKey } from "@/lib/objects/contracts";

/**
 * Where an object's comments live in record_comment (M11).
 *
 * Native records that already had comments keep their own parent type, so a
 * task has one thread whether it is opened from My work or as an object.
 * Pages have their own parent type too (U9), whose access is the page's rule
 * (app.can_page). Everything else (custom types, native types without
 * comments of their own) uses the `object` parent type, whose access is
 * app.can.
 */
const NATIVE_COMMENT_PARENTS: Partial<Record<ObjectTypeKey, string>> = {
  task: "task",
  project: "project",
  event: "event",
  meeting: "meeting",
  risk: "risk",
  contact: "contact",
  page: "page",
};

export const commentParentTypes = [
  "project",
  "task",
  "milestone",
  "event",
  "meeting",
  "agenda_item",
  "risk",
  "issue",
  "update",
  "organization",
  "contact",
  "opportunity",
  "object",
  "page",
] as const;
export type CommentParentType = (typeof commentParentTypes)[number];

export interface CommentTarget {
  parentType: CommentParentType;
  parentId: string;
  /** Set when the thread is pinned to one block of the object's content. */
  blockId: string | null;
}

export function commentTargetFor(object: ObjectRef, blockId: string | null = null): CommentTarget {
  const parentType = (NATIVE_COMMENT_PARENTS[object.type] ?? "object") as CommentParentType;
  return { parentType, parentId: object.id, blockId };
}

/**
 * The page that shows an object's comments, for notification links. A page's
 * comments live under the page itself (U9), on the block's own thread when
 * the comment is on a block. Other objects use the collaboration screen
 * behind the Workspace OS editor switch until they get their own page.
 */
export function objectCommentsPath(object: ObjectRef, commentId?: string, blockId?: string | null): string {
  if (object.type === "page") {
    const query = blockId ? `?block=${encodeURIComponent(blockId)}` : "";
    return `/pages/${object.id}${query}#${commentId ? `comment-${commentId}` : "page-collab"}`;
  }
  const base = `/collab/objects/${object.id}?type=${encodeURIComponent(object.type)}`;
  return commentId ? `${base}#comment-${commentId}` : base;
}
