"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { useLocale } from "@/lib/i18n/client";
import type { ObjectRef } from "@/lib/objects/contracts";
import { addObjectComment } from "@/features/object-comments/services/object-comment.commands";
import { fill } from "../i18n";
import { collabText } from "../messages";
import { selectionAnchor } from "../suggestions";
import { decideSuggestion, suggestEdit } from "../services/suggestion.commands";
import type { SuggestionView } from "../services/suggestion.queries";

export interface TextSelection {
  blockId: string;
  start: number;
  end: number;
}

/** Suggest a change to, or comment on, the selected text (V1-17). */
export function SelectionActions({
  object,
  text,
  selection,
  canSuggest,
  canComment,
}: {
  object: ObjectRef;
  text: string;
  selection: TextSelection | null;
  canSuggest: boolean;
  canComment: boolean;
}) {
  const m = collabText(useLocale()).suggest;
  const router = useRouter();
  const proposedId = useId();
  const commentId = useId();
  const [proposed, setProposed] = useState("");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState<"suggest" | "comment" | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const anchor = selection ? selectionAnchor(text, selection.start, selection.end) : null;

  if (!canSuggest && !canComment) return null;

  return (
    <section aria-label={m.actionsLabel} className="card mt-3 p-4">
      {message ? (
        <p role={message.ok ? "status" : "alert"} className={message.ok ? "meta mb-2" : "mb-2 text-sm text-danger-fg"}>
          {message.text}
        </p>
      ) : null}
      {!anchor || !selection ? (
        <p className="meta">{m.selectHint}</p>
      ) : (
        <>
          <p className="mb-3 text-[13.5px]">{fill(m.selected, { text: anchor.quote })}</p>
          {canSuggest ? (
            <form
              className="mb-3 flex flex-wrap items-end gap-2"
              onSubmit={async (event) => {
                event.preventDefault();
                setBusy("suggest");
                const result = await suggestEdit({
                  object,
                  blockId: selection.blockId,
                  start: anchor.start,
                  end: anchor.end,
                  proposed,
                });
                setBusy(null);
                setMessage(result.ok ? { ok: true, text: m.sent } : { ok: false, text: result.error ?? m.errors.failed });
                if (result.ok) {
                  setProposed("");
                  router.refresh();
                }
              }}
            >
              <div className="min-w-56 flex-1">
                <label htmlFor={proposedId} className="text-[13px] font-medium">
                  {m.proposedLabel}
                </label>
                <Input id={proposedId} value={proposed} maxLength={5000} onChange={(event) => setProposed(event.target.value)} />
              </div>
              <Button type="submit" size="sm" loading={busy === "suggest"}>
                {m.suggest}
              </Button>
            </form>
          ) : null}
          {canComment ? (
            <form
              className="space-y-2"
              onSubmit={async (event) => {
                event.preventDefault();
                setBusy("comment");
                const result = await addObjectComment({
                  object,
                  blockId: selection.blockId,
                  anchor,
                  body: comment,
                });
                setBusy(null);
                setMessage(result.ok ? { ok: true, text: m.commented } : { ok: false, text: result.error ?? m.errors.failed });
                if (result.ok) {
                  setComment("");
                  router.refresh();
                }
              }}
            >
              <label htmlFor={commentId} className="text-[13px] font-medium">
                {m.commentLabel}
              </label>
              <Textarea id={commentId} value={comment} maxLength={5000} rows={2} onChange={(event) => setComment(event.target.value)} />
              <Button type="submit" size="sm" variant="secondary" loading={busy === "comment"}>
                {m.comment}
              </Button>
            </form>
          ) : null}
        </>
      )}
    </section>
  );
}

/** Open suggestions with accept, reject or withdraw (V1-17). */
export function SuggestionList({
  suggestions,
  me,
  canDecide,
}: {
  suggestions: SuggestionView[];
  me: string;
  canDecide: boolean;
}) {
  const m = collabText(useLocale()).suggest;
  const router = useRouter();
  const headingId = useId();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(id: string, decision: "accepted" | "rejected" | "withdrawn") {
    setBusy(`${id}:${decision}`);
    setError(null);
    const result = await decideSuggestion({ id, decision });
    setBusy(null);
    if (!result.ok) setError(result.error ?? m.errors.failed);
    else router.refresh();
  }

  return (
    <section aria-labelledby={headingId} className="mt-6">
      <h2 id={headingId} className="section-heading mb-2">
        {m.heading}
      </h2>
      {error ? (
        <p role="alert" className="mb-2 text-sm text-danger-fg">
          {error}
        </p>
      ) : null}
      {suggestions.length === 0 ? (
        <p className="meta">{m.none}</p>
      ) : (
        <ul className="card divide-y divide-line">
          {suggestions.map((suggestion) => {
            const name = suggestion.authorName ?? m.formerMember;
            return (
              <li key={suggestion.id} className="px-4 py-3">
                <p className="meta">{fill(m.by, { name })}</p>
                <p className="mt-1 text-[13.5px]">
                  {m.replace}{" "}
                  <del className="rounded-sm bg-danger/15 text-danger-fg">{suggestion.originalText}</del>{" "}
                  {suggestion.proposedText ? (
                    <>
                      {m.with}{" "}
                      <ins className="rounded-sm bg-success/15 text-success-fg no-underline">{suggestion.proposedText}</ins>
                    </>
                  ) : (
                    <span className="meta">({m.removeAll})</span>
                  )}
                </p>
                <div className="mt-2 flex flex-wrap gap-1">
                  {canDecide ? (
                    <>
                      <Button
                        size="sm"
                        aria-label={fill(m.acceptNamed, { name })}
                        loading={busy === `${suggestion.id}:accepted`}
                        onClick={() => void decide(suggestion.id, "accepted")}
                      >
                        {m.accept}
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        aria-label={fill(m.rejectNamed, { name })}
                        loading={busy === `${suggestion.id}:rejected`}
                        onClick={() => void decide(suggestion.id, "rejected")}
                      >
                        {m.reject}
                      </Button>
                    </>
                  ) : null}
                  {suggestion.authorId === me ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      loading={busy === `${suggestion.id}:withdrawn`}
                      onClick={() => void decide(suggestion.id, "withdrawn")}
                    >
                      {m.withdraw}
                    </Button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
