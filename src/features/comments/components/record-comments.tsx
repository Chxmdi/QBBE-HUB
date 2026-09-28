"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import {
  addRecordComment,
  deleteRecordComment,
  editRecordComment,
  resolveRecordComment,
} from "../services/comment.commands";
import { useFormatters, useT } from "@/lib/i18n/client";

export interface CommentView {
  id: string;
  body: string;
  author_id: string;
  author_name: string;
  parent_comment_id: string | null;
  created_at: string;
  edited_at: string | null;
  resolved_at: string | null;
  deleted_at: string | null;
  link_url: string | null;
  document: { id: string; title: string } | null;
}

interface Option {
  id: string;
  label: string;
}

/**
 * A thread on one record (P0-COM-01..05).
 *
 * The database decides every permission: who may edit (the author), delete
 * (the author or an administrator) and resolve (anyone who can read the
 * record). The controls shown here only avoid offering what would be refused.
 */
export function RecordComments({
  parentType,
  parentId,
  comments,
  currentUserId,
  isAdmin,
  people,
  documents,
}: {
  parentType: string;
  parentId: string;
  comments: CommentView[];
  currentUserId: string;
  isAdmin: boolean;
  people: Option[];
  documents: Option[];
}) {
  const t = useT();
  const topLevel = comments.filter((comment) => !comment.parent_comment_id);
  const replies = (id: string) =>
    comments.filter((comment) => comment.parent_comment_id === id);

  return (
    <section aria-labelledby={`comments-${parentId}`} className="mt-8">
      <h2 id={`comments-${parentId}`} className="section-heading mb-3">
        {t("comments.heading")}
      </h2>
      {topLevel.length === 0 ? (
        <p className="meta mb-4">{t("comments.none")}</p>
      ) : (
        <ul className="card mb-4 divide-y divide-line">
          {topLevel.map((comment) => (
            <li key={comment.id} className="px-4 py-3">
              <CommentItem
                comment={comment}
                currentUserId={currentUserId}
                isAdmin={isAdmin}
                canResolve
                parentType={parentType}
                parentId={parentId}
                people={people}
                documents={documents}
              />
              {replies(comment.id).length > 0 ? (
                <ul
                  aria-label={t("comments.replies")}
                  className="mt-3 space-y-3 border-l-2 border-line pl-4"
                >
                  {replies(comment.id).map((reply) => (
                    <li key={reply.id}>
                      <CommentItem
                        comment={reply}
                        currentUserId={currentUserId}
                        isAdmin={isAdmin}
                        canResolve={false}
                        parentType={parentType}
                        parentId={parentId}
                        people={people}
                        documents={documents}
                      />
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <CommentForm
        parentType={parentType}
        parentId={parentId}
        people={people}
        documents={documents}
        submitLabel={t("comments.postComment")}
      />
    </section>
  );
}

function CommentItem({
  comment,
  currentUserId,
  isAdmin,
  canResolve,
  parentType,
  parentId,
  people,
  documents,
}: {
  comment: CommentView;
  currentUserId: string;
  isAdmin: boolean;
  canResolve: boolean;
  parentType: string;
  parentId: string;
  people: Option[];
  documents: Option[];
}) {
  const router = useRouter();
  const t = useT();
  const format = useFormatters();
  const [mode, setMode] = useState<"view" | "edit" | "reply">("view");
  const [draft, setDraft] = useState(comment.body);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const isAuthor = comment.author_id === currentUserId;

  async function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(true);
    setError(null);
    const result = await action();
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? t("comments.didNotWork"));
      return false;
    }
    router.refresh();
    return true;
  }

  if (comment.deleted_at) {
    return (
      <p id={`comment-${comment.id}`} className="meta italic">
        {t("comments.deletedAt", { when: format.dateTime(comment.deleted_at) })}
      </p>
    );
  }

  return (
    <div id={`comment-${comment.id}`}>
      <p className="text-[12.5px] font-medium">{comment.author_name}</p>
      {mode === "edit" ? (
        <form
          className="mt-1 space-y-2"
          onSubmit={async (event) => {
            event.preventDefault();
            if (
              await run(() =>
                editRecordComment({ commentId: comment.id, body: draft }),
              )
            ) {
              setMode("view");
            }
          }}
        >
          <Label htmlFor={`edit-${comment.id}`} className="sr-only">
            {t("comments.editLabel")}
          </Label>
          <Textarea
            id={`edit-${comment.id}`}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            maxLength={5000}
            required
          />
          <div className="flex gap-2">
            <Button type="submit" loading={busy}>
              {t("comments.saveComment")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setMode("view")}
            >
              {t("common.cancel")}
            </Button>
          </div>
        </form>
      ) : (
        <p className="mt-0.5 text-[13.5px] whitespace-pre-wrap">
          {comment.body}
        </p>
      )}
      {comment.link_url ? (
        <a
          href={comment.link_url}
          target="_blank"
          rel="noreferrer noopener"
          className="mt-1 inline-block text-[13px] text-brand-fg hover:underline"
        >
          {comment.link_url}
        </a>
      ) : null}
      {comment.document ? (
        <p className="mt-1 text-[13px]">
          {t("comments.attached")}{" "}
          <span className="font-medium">{comment.document.title}</span>
        </p>
      ) : null}
      <p className="meta mt-1">
        {format.dateTime(comment.created_at)}
        {comment.edited_at ? t("comments.edited") : ""}
        {comment.resolved_at ? t("comments.resolved") : ""}
      </p>
      {mode === "view" ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {canResolve ? (
            <Button variant="ghost" onClick={() => setMode("reply")}>
              {t("comments.reply")}
            </Button>
          ) : null}
          {isAuthor ? (
            <Button variant="ghost" onClick={() => setMode("edit")}>
              {t("comments.edit")}
            </Button>
          ) : null}
          {isAuthor || isAdmin ? (
            <Button
              variant="ghost"
              loading={busy}
              onClick={() => {
                if (
                  window.confirm(t("comments.deleteConfirm"))
                ) {
                  void run(() => deleteRecordComment(comment.id));
                }
              }}
            >
              {t("comments.delete")}
            </Button>
          ) : null}
          {canResolve && !comment.resolved_at ? (
            <Button
              variant="secondary"
              loading={busy}
              onClick={() => void run(() => resolveRecordComment(comment.id))}
            >
              {t("comments.resolve")}
            </Button>
          ) : null}
        </div>
      ) : null}
      {mode === "reply" ? (
        <div className="mt-3">
          <CommentForm
            parentType={parentType}
            parentId={parentId}
            parentCommentId={comment.id}
            people={people}
            documents={documents}
            submitLabel={t("comments.postReply")}
            onDone={() => setMode("view")}
          />
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="mt-1 text-sm text-danger-fg">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function CommentForm({
  parentType,
  parentId,
  parentCommentId,
  people,
  documents,
  submitLabel,
  onDone,
}: {
  parentType: string;
  parentId: string;
  parentCommentId?: string;
  people: Option[];
  documents: Option[];
  submitLabel: string;
  onDone?: () => void;
}) {
  const router = useRouter();
  const t = useT();
  const [body, setBody] = useState("");
  const [mentionIds, setMentionIds] = useState<string[]>([]);
  const [linkUrl, setLinkUrl] = useState("");
  const [documentId, setDocumentId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const idBase = `${parentCommentId ?? parentId}-new`;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const result = await addRecordComment({
      parentType,
      parentId,
      parentCommentId,
      body,
      mentionIds,
      linkUrl,
      documentId,
    });
    setPending(false);
    if (!result.ok) {
      setError(result.error ?? t("comments.errors.saveFailed"));
      return;
    }
    setBody("");
    setMentionIds([]);
    setLinkUrl("");
    setDocumentId("");
    onDone?.();
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div>
        <Label htmlFor={`${idBase}-body`}>
          {parentCommentId ? t("comments.replyLabel") : t("comments.commentLabel")}
        </Label>
        <Textarea
          id={`${idBase}-body`}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder={
            parentCommentId ? t("comments.replyPlaceholder") : t("comments.commentPlaceholder")
          }
          maxLength={5000}
          required
        />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <Label htmlFor={`${idBase}-mention`}>{t("comments.mention")}</Label>
          <Select
            id={`${idBase}-mention`}
            multiple
            value={mentionIds}
            onChange={(event) =>
              setMentionIds(
                Array.from(
                  event.target.selectedOptions,
                  (option) => option.value,
                ),
              )
            }
            className="h-auto min-h-9.5"
          >
            {people.map((person) => (
              <option key={person.id} value={person.id}>
                {person.label}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor={`${idBase}-link`}>{t("comments.link")}</Label>
          <Input
            id={`${idBase}-link`}
            type="url"
            placeholder={t("comments.linkPlaceholder")}
            value={linkUrl}
            onChange={(event) => setLinkUrl(event.target.value)}
          />
        </div>
        <div>
          <Label htmlFor={`${idBase}-document`}>{t("comments.attachDocument")}</Label>
          <Select
            id={`${idBase}-document`}
            value={documentId}
            onChange={(event) => setDocumentId(event.target.value)}
          >
            <option value="">{t("comments.noDocument")}</option>
            {documents.map((document) => (
              <option key={document.id} value={document.id}>
                {document.label}
              </option>
            ))}
          </Select>
        </div>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-danger-fg">
          {error}
        </p>
      ) : null}
      <Button type="submit" loading={pending} disabled={pending}>
        {submitLabel}
      </Button>
    </form>
  );
}
