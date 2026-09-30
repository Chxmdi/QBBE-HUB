import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ObjectRef } from "@/lib/objects/contracts";
import { summarizeReactions, type ReactionSummary } from "../reactions";
import { splitBody } from "../mentions";
import type { CommentTarget } from "../target";

type Db = Awaited<ReturnType<typeof createSupabaseServerClient>>;

export interface ObjectCommentView {
  id: string;
  body: string;
  authorId: string;
  authorName: string;
  parentCommentId: string | null;
  blockId: string | null;
  createdAt: string;
  editedAt: string | null;
  resolvedAt: string | null;
  resolvedByName: string | null;
  deletedAt: string | null;
  reactions: ReactionSummary[];
}

export interface MentionLabel {
  kind: "person" | "object";
  id: string;
  /** Null when the reader cannot see the mentioned object. */
  label: string | null;
  type?: string;
}

export interface ObjectCommentsData {
  comments: ObjectCommentView[];
  /** Keyed `kind:id`, for rendering the mentions in every body. */
  mentions: Record<string, MentionLabel>;
}

interface CommentRow {
  id: string;
  body: string;
  author_id: string;
  parent_comment_id: string | null;
  block_id: string | null;
  created_at: string;
  edited_at: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  deleted_at: string | null;
}

/** Active members' names. Deactivated authors show as former members. */
async function memberNames(db: Db): Promise<Map<string, string>> {
  const { data } = await db
    .from("organization_membership")
    .select("user_id, user_profile:user_id(id, full_name)")
    .eq("status", "active");
  const names = new Map<string, string>();
  for (const row of (data ?? []) as unknown as {
    user_profile: { id: string; full_name: string } | null;
  }[]) {
    if (row.user_profile) names.set(row.user_profile.id, row.user_profile.full_name);
  }
  return names;
}

/**
 * Current titles of objects the reader can see. Until the object registry
 * (S1, M1a) lands, the only objects are tasks and projects; after it, this
 * reads `object.title`.
 */
async function objectTitles(db: Db, ids: string[]): Promise<Map<string, { title: string; type: string }>> {
  const titles = new Map<string, { title: string; type: string }>();
  if (ids.length === 0) return titles;
  const [{ data: tasks }, { data: projects }] = await Promise.all([
    db.from("task").select("id, title").in("id", ids),
    db.from("project").select("id, name").in("id", ids),
  ]);
  for (const row of (tasks ?? []) as { id: string; title: string }[]) {
    titles.set(row.id, { title: row.title, type: "task" });
  }
  for (const row of (projects ?? []) as { id: string; name: string }[]) {
    titles.set(row.id, { title: row.name, type: "project" });
  }
  return titles;
}

/**
 * One object's (or one block's) comments with reactions and mention labels.
 * Every read runs as the signed-in person, so RLS decides what is returned.
 */
export async function loadObjectComments(
  target: CommentTarget,
  currentUserId: string,
  formerMember: string,
): Promise<ObjectCommentsData> {
  const db = await createSupabaseServerClient();
  let query = db
    .from("record_comment")
    .select(
      "id, body, author_id, parent_comment_id, block_id, created_at, edited_at, resolved_at, resolved_by, deleted_at",
    )
    .eq("parent_type", target.parentType)
    .eq("parent_id", target.parentId)
    .order("created_at", { ascending: true })
    .limit(500);
  query = target.blockId ? query.eq("block_id", target.blockId) : query.is("block_id", null);
  const [{ data: rows }, names] = await Promise.all([query, memberNames(db)]);
  const comments = (rows ?? []) as CommentRow[];
  const ids = comments.map((comment) => comment.id);

  const [{ data: reactionRows }, { data: mentionRows }] = ids.length
    ? await Promise.all([
        db.from("record_comment_reaction").select("comment_id, user_id, reaction").in("comment_id", ids),
        db.from("record_comment_mention").select("target_kind, target_id").in("comment_id", ids),
      ])
    : [{ data: [] }, { data: [] }];

  const nameOf = (userId: string) => names.get(userId) ?? formerMember;
  const reactionsByComment = new Map<string, { reaction: string; user_id: string }[]>();
  for (const row of (reactionRows ?? []) as { comment_id: string; user_id: string; reaction: string }[]) {
    const list = reactionsByComment.get(row.comment_id) ?? [];
    list.push(row);
    reactionsByComment.set(row.comment_id, list);
  }

  // Object mentions are returned only when the reader can see the object.
  const visibleObjects = new Set(
    ((mentionRows ?? []) as { target_kind: string; target_id: string }[])
      .filter((row) => row.target_kind === "object")
      .map((row) => row.target_id),
  );
  const titles = await objectTitles(db, [...visibleObjects]);
  const mentions: Record<string, MentionLabel> = {};
  for (const comment of comments) {
    for (const segment of splitBody(comment.body)) {
      if (segment.type !== "mention") continue;
      const { kind, id, label } = segment.mention;
      const key = `${kind}:${id}`;
      if (mentions[key]) continue;
      if (kind === "person") {
        mentions[key] = { kind, id, label: names.get(id) ?? label };
      } else if (visibleObjects.has(id)) {
        const current = titles.get(id);
        mentions[key] = { kind, id, label: current?.title ?? label, type: current?.type };
      } else {
        mentions[key] = { kind, id, label: null };
      }
    }
  }

  return {
    comments: comments.map((row) => ({
      id: row.id,
      body: row.deleted_at ? "" : row.body,
      authorId: row.author_id,
      authorName: nameOf(row.author_id),
      parentCommentId: row.parent_comment_id,
      blockId: row.block_id,
      createdAt: row.created_at,
      editedAt: row.edited_at,
      resolvedAt: row.resolved_at,
      resolvedByName: row.resolved_by ? nameOf(row.resolved_by) : null,
      deletedAt: row.deleted_at,
      reactions: summarizeReactions(reactionsByComment.get(row.id) ?? [], currentUserId, nameOf),
    })),
    mentions,
  };
}

/** The object's title as the reader sees it, or null when they cannot open it. */
export async function loadObjectTitle(object: ObjectRef): Promise<string | null> {
  const db = await createSupabaseServerClient();
  const titles = await objectTitles(db, [object.id]);
  return titles.get(object.id)?.title ?? null;
}

export interface MentionCandidate {
  kind: "person" | "object";
  id: string;
  label: string;
  type?: string;
}

/** Strips characters that mean something to PostgREST's filter syntax. */
function likePattern(query: string): string {
  return `%${query.replace(/[%_,()*\\]/g, " ").trim()}%`;
}

/**
 * People in the organization and objects the reader can see whose name
 * contains the query, for the `@` picker.
 */
export async function findMentionCandidates(query: string): Promise<MentionCandidate[]> {
  const db = await createSupabaseServerClient();
  const pattern = likePattern(query.slice(0, 40));
  const [{ data: people }, { data: tasks }, { data: projects }] = await Promise.all([
    db
      .from("organization_membership")
      .select("user_id, user_profile:user_id!inner(id, full_name)")
      .eq("status", "active")
      .ilike("user_profile.full_name", pattern)
      .limit(6),
    db.from("task").select("id, title").ilike("title", pattern).order("updated_at", { ascending: false }).limit(4),
    db.from("project").select("id, name").ilike("name", pattern).order("name").limit(3),
  ]);
  return [
    ...((people ?? []) as unknown as { user_profile: { id: string; full_name: string } | null }[])
      .filter((row) => row.user_profile)
      .map((row) => ({ kind: "person" as const, id: row.user_profile!.id, label: row.user_profile!.full_name })),
    ...((tasks ?? []) as { id: string; title: string }[]).map((row) => ({
      kind: "object" as const,
      id: row.id,
      label: row.title,
      type: "task",
    })),
    ...((projects ?? []) as { id: string; name: string }[]).map((row) => ({
      kind: "object" as const,
      id: row.id,
      label: row.name,
      type: "project",
    })),
  ];
}
