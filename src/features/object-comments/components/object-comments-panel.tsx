"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { useFormatters, useLocale } from "@/lib/i18n/client";
import type { ObjectRef } from "@/lib/objects/contracts";
import { fill } from "@/features/collab/i18n";
import { objectCommentsText, type ObjectCommentsText } from "../messages";
import { reactionEmoji, reactionKeys, type ReactionKey } from "../reactions";
import {
  addObjectComment,
  deleteObjectComment,
  editObjectComment,
  setObjectCommentReaction,
  setObjectCommentResolved,
  type CommentActionResult,
} from "../services/object-comment.commands";
import type { ObjectCommentsData, ObjectCommentView } from "../services/object-comment.queries";
import { CommentBody } from "./comment-body";
import { MentionComposer } from "./mention-composer";

type Filter = "open" | "resolved" | "all";

interface Shared {
  object: ObjectRef;
  blockId: string | null;
  currentUserId: string;
  isAdmin: boolean;
  canPost: boolean;
  data: ObjectCommentsData;
  m: ObjectCommentsText;
}

/**
 * Comment threads on one object, or on one block of it (M11).
 *
 * The database decides every permission; the controls here only avoid
 * offering what it would refuse: posting and reacting need the comment
 * capability, editing is the author's, deleting the author's or an
 * administrator's, and anyone who can read the thread resolves or reopens it.
 */
export function ObjectCommentsPanel({
  object,
  blockId = null,
  data,
  currentUserId,
  isAdmin,
  canPost,
}: {
  object: ObjectRef;
  blockId?: string | null;
  data: ObjectCommentsData;
  currentUserId: string;
  isAdmin: boolean;
  canPost: boolean;
}) {
  const m = objectCommentsText(useLocale());
  const headingId = useId();
  const [filter, setFilter] = useState<Filter>("open");
  const shared: Shared = { object, blockId, currentUserId, isAdmin, canPost, data, m };

  const roots = data.comments.filter((comment) => !comment.parentCommentId);
  const openCount = roots.filter((root) => !root.resolvedAt && !root.deletedAt).length;
  const shown = roots.filter((root) =>
    filter === "all" ? true : filter === "open" ? !root.resolvedAt : Boolean(root.resolvedAt),
  );
  const repliesTo = (id: string) => data.comments.filter((comment) => comment.parentCommentId === id);

  return (
    <section aria-labelledby={headingId} className="mt-6">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id={headingId} className="section-heading">
          {blockId ? m.blockHeading : m.heading}{" "}
          <span className="meta font-normal">({fill(m.openCount, { count: openCount })})</span>
        </h2>
        <fieldset className="flex items-center gap-3 text-[13px]">
          <legend className="sr-only">{m.filterLabel}</legend>
          {(["open", "resolved", "all"] as const).map((value) => (
            <label key={value} className="flex items-center gap-1">
              <input
                type="radio"
                name={`${headingId}-filter`}
                value={value}
                checked={filter === value}
                onChange={() => setFilter(value)}
              />
              {value === "open" ? m.filterOpen : value === "resolved" ? m.filterResolved : m.filterAll}
            </label>
          ))}
        </fieldset>
      </div>

      {shown.length === 0 ? (
        <p className="meta mb-4">{filter === "resolved" ? m.noneResolved : m.none}</p>
      ) : (
        <ul className="card mb-4 divide-y divide-line">
          {shown.map((root) => (
            <li
              key={root.id}
              className="px-4 py-3"
              aria-label={root.resolvedAt ? m.resolvedThread : undefined}
            >
              <CommentItem comment={root} isRoot shared={shared} />
              {repliesTo(root.id).length > 0 ? (
                <ul aria-label={m.replies} className="mt-3 space-y-3 border-l-2 border-line pl-4">
                  {repliesTo(root.id).map((reply) => (
                    <li key={reply.id}>
                      <CommentItem comment={reply} isRoot={false} shared={shared} />
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {canPost ? (
        <CommentForm shared={shared} parentCommentId={null} submitLabel={m.post} fieldLabel={m.commentLabel} />
      ) : null}
    </section>
  );
}

function useRunner(m: ObjectCommentsText) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(action: () => Promise<CommentActionResult>): Promise<boolean> {
    setBusy(true);
    setError(null);
    const result = await action();
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? m.errors.saveFailed);
      return false;
    }
    router.refresh();
    return true;
  }
  return { busy, error, run };
}

function CommentItem({
  comment,
  isRoot,
  shared,
}: {
  comment: ObjectCommentView;
  isRoot: boolean;
  shared: Shared;
}) {
  const { m, currentUserId, isAdmin, canPost, object, data } = shared;
  const format = useFormatters();
  const { busy, error, run } = useRunner(m);
  const [mode, setMode] = useState<"view" | "edit" | "reply">("view");
  const [draft, setDraft] = useState(comment.body);
  const isAuthor = comment.authorId === currentUserId;
  const editId = useId();

  if (comment.deletedAt) {
    return (
      <p id={`comment-${comment.id}`} className="meta italic">
        {m.deleted}
      </p>
    );
  }

  return (
    <article id={`comment-${comment.id}`} aria-label={`${comment.authorName}, ${format.dateTime(comment.createdAt)}`}>
      <p className="text-[12.5px] font-medium">{comment.authorName}</p>
      {comment.quote ? (
        <blockquote className="meta mt-1 border-l-2 border-accent pl-2 italic">
          <span className="sr-only">{m.onSelection} </span>
          {comment.quote}
        </blockquote>
      ) : null}
      {mode === "edit" ? (
        <form
          className="mt-1 space-y-2"
          onSubmit={async (event) => {
            event.preventDefault();
            const ok = await run(() => editObjectComment({ commentId: comment.id, object, body: draft }));
            if (ok) setMode("view");
          }}
        >
          <MentionComposer id={editId} label={m.editLabel} value={draft} onChange={setDraft} autoFocus />
          <div className="flex gap-2">
            <Button type="submit" size="sm" loading={busy}>
              {m.save}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setMode("view")}>
              {m.cancel}
            </Button>
          </div>
        </form>
      ) : (
        <CommentBody body={comment.body} mentions={data.mentions} m={m} />
      )}
      <p className="meta mt-1">
        <time dateTime={comment.createdAt}>{format.dateTime(comment.createdAt)}</time>
        {comment.editedAt ? ` · ${m.edited}` : ""}
        {isRoot && comment.resolvedAt && comment.resolvedByName
          ? ` · ${fill(m.resolvedBy, { name: comment.resolvedByName })}`
          : ""}
      </p>

      <Reactions comment={comment} shared={shared} />

      {mode === "view" ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {isRoot && canPost ? (
            <Button
              size="sm"
              variant="ghost"
              aria-label={fill(m.replyTo, { name: comment.authorName })}
              onClick={() => setMode("reply")}
            >
              {m.reply}
            </Button>
          ) : null}
          {isAuthor ? (
            <Button size="sm" variant="ghost" onClick={() => setMode("edit")}>
              {m.edit}
            </Button>
          ) : null}
          {isAuthor || isAdmin ? (
            <Button
              size="sm"
              variant="ghost"
              loading={busy}
              onClick={() => {
                if (window.confirm(m.confirmDelete)) void run(() => deleteObjectComment(comment.id));
              }}
            >
              {m.delete}
            </Button>
          ) : null}
          {isRoot ? (
            <Button
              size="sm"
              variant="secondary"
              loading={busy}
              onClick={() => void run(() => setObjectCommentResolved(comment.id, !comment.resolvedAt))}
            >
              {comment.resolvedAt ? m.reopen : m.resolve}
            </Button>
          ) : null}
        </div>
      ) : null}

      {mode === "reply" ? (
        <div className="mt-3">
          <CommentForm
            shared={shared}
            parentCommentId={comment.id}
            submitLabel={m.postReply}
            fieldLabel={fill(m.replyTo, { name: comment.authorName })}
            onDone={() => setMode("view")}
          />
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="mt-1 text-sm text-danger-fg">
          {error}
        </p>
      ) : null}
    </article>
  );
}

function Reactions({ comment, shared }: { comment: ObjectCommentView; shared: Shared }) {
  const { m, canPost } = shared;
  const { busy, error, run } = useRunner(m);
  const [picking, setPicking] = useState(false);
  const pickerId = useId();
  const name = (key: ReactionKey) => m.reactionNames[key];

  function toggle(key: ReactionKey, on: boolean) {
    void run(() => setObjectCommentReaction({ commentId: comment.id, reaction: key, on }));
  }

  if (comment.reactions.length === 0 && !canPost) return null;

  return (
    <div className="mt-2">
      <div role="group" aria-label={m.reactionsLabel} className="flex flex-wrap items-center gap-1">
        {comment.reactions.map((reaction) => (
          <button
            key={reaction.key}
            type="button"
            disabled={busy || !canPost}
            aria-pressed={reaction.mine}
            aria-label={fill(m.reactionCount, {
              reaction: name(reaction.key),
              count: reaction.count,
              names: reaction.names.join(", "),
            })}
            onClick={() => toggle(reaction.key, !reaction.mine)}
            className={
              reaction.mine
                ? "inline-flex h-7 items-center gap-1 rounded-full border border-brand bg-brand-soft px-2 text-[12.5px] text-brand-fg"
                : "inline-flex h-7 items-center gap-1 rounded-full border border-line bg-surface px-2 text-[12.5px] text-ink hover:bg-surface-soft"
            }
          >
            <span aria-hidden>{reactionEmoji[reaction.key]}</span>
            <span aria-hidden>{reaction.count}</span>
          </button>
        ))}
        {canPost ? (
          <button
            type="button"
            aria-expanded={picking}
            aria-controls={pickerId}
            onClick={() => setPicking((value) => !value)}
            className="inline-flex h-7 items-center rounded-full border border-dashed border-line px-2 text-[12.5px] text-muted hover:bg-surface-soft"
          >
            {m.addReaction}
          </button>
        ) : null}
      </div>
      <div id={pickerId} hidden={!picking} className="mt-1 flex flex-wrap gap-1">
        {reactionKeys.map((key) => {
          const mine = comment.reactions.some((reaction) => reaction.key === key && reaction.mine);
          return (
            <button
              key={key}
              type="button"
              disabled={busy}
              aria-label={mine ? fill(m.removeReaction, { reaction: name(key) }) : fill(m.reactWith, { reaction: name(key) })}
              onClick={() => {
                toggle(key, !mine);
                setPicking(false);
              }}
              className="inline-flex size-8 items-center justify-center rounded-(--radius-sm) hover:bg-surface-soft"
            >
              <span aria-hidden>{reactionEmoji[key]}</span>
            </button>
          );
        })}
      </div>
      {error ? (
        <p role="alert" className="mt-1 text-sm text-danger-fg">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function CommentForm({
  shared,
  parentCommentId,
  submitLabel,
  fieldLabel,
  onDone,
}: {
  shared: Shared;
  parentCommentId: string | null;
  submitLabel: string;
  fieldLabel: string;
  onDone?: () => void;
}) {
  const { m, object, blockId } = shared;
  const { busy, error, run } = useRunner(m);
  const [body, setBody] = useState("");
  const fieldId = useId();

  return (
    <form
      className="space-y-2"
      onSubmit={async (event) => {
        event.preventDefault();
        const ok = await run(() => addObjectComment({ object, blockId, parentCommentId, body }));
        if (ok) {
          setBody("");
          onDone?.();
        }
      }}
    >
      <MentionComposer id={fieldId} label={fieldLabel} value={body} onChange={setBody} autoFocus={Boolean(onDone)} />
      <div className="flex gap-2">
        <Button type="submit" size="sm" loading={busy}>
          {submitLabel}
        </Button>
        {onDone ? (
          <Button type="button" size="sm" variant="ghost" onClick={onDone}>
            {m.cancel}
          </Button>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="text-sm text-danger-fg">
          {error}
        </p>
      ) : null}
    </form>
  );
}
