"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { useEditorT } from "@/features/editor/i18n/client";
import type { EditorT } from "@/features/editor/i18n";
import type { EditorContent } from "@/features/editor/adapter/content";
import { diffContents } from "@/features/editor/queue/compare";
import type { SnapshotDiff, TextPart } from "@/features/versions/diff";

/**
 * What to do after a conflicting save (U3): keep this device's edits and
 * save them on top of the other person's version, take theirs and drop
 * these, or review the two block lists side by side first (read-only; the
 * choice is still one of the first two).
 */
export function ConflictDialog({
  open,
  mine,
  theirs,
  onKeepMine,
  onTakeTheirs,
  onClose,
}: {
  open: boolean;
  /** This device's newest content, read when the person asks to review. */
  mine: () => EditorContent;
  /** The server's content; undefined while it loads, null when it could not be read. */
  theirs: EditorContent | null | undefined;
  onKeepMine: () => void;
  onTakeTheirs: () => void;
  onClose: () => void;
}) {
  const t = useEditorT();
  const [diff, setDiff] = React.useState<SnapshotDiff | null>(null);
  const reviewing = diff !== null;

  return (
    <Dialog open={open} onClose={onClose} title={t("conflictDialog.title")} className={reviewing ? "w-[min(960px,calc(100vw-2rem))]" : undefined}>
      <p className="text-body-sm text-ink">{t("conflictDialog.body")}</p>
      {theirs === undefined ? (
        <p role="status" className="mt-3 text-caption text-muted">
          {t("conflictDialog.loading")}
        </p>
      ) : theirs === null ? (
        <p role="alert" className="mt-3 text-caption text-danger-fg">
          {t("conflictDialog.unavailable")}
        </p>
      ) : null}
      {diff ? <ReviewTable diff={diff} t={t} /> : null}
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        {reviewing ? (
          <Button variant="secondary" onClick={() => setDiff(null)}>
            {t("conflictDialog.back")}
          </Button>
        ) : (
          <Button variant="secondary" disabled={!theirs} onClick={() => theirs && setDiff(diffContents(theirs, mine()))}>
            {t("conflictDialog.review")}
          </Button>
        )}
        <Button variant="secondary" disabled={!theirs} onClick={onTakeTheirs}>
          {t("conflictDialog.takeTheirs")}
        </Button>
        <Button onClick={onKeepMine}>{t("conflictDialog.keepMine")}</Button>
      </div>
    </Dialog>
  );
}

function Parts({ parts, side, t }: { parts: TextPart[]; side: "before" | "after"; t: EditorT }) {
  return (
    <>
      {parts.map((part, index) => {
        if (part.kind === "same") return <span key={index}>{part.text}</span>;
        if (part.kind === "removed" && side === "before") {
          return (
            <del key={index} className="rounded-sm bg-danger/15 text-danger-fg">
              <span className="sr-only">[{t("conflictDialog.removedText")}: </span>
              {part.text}
              <span className="sr-only">]</span>
            </del>
          );
        }
        if (part.kind === "added" && side === "after") {
          return (
            <ins key={index} className="rounded-sm bg-success/15 text-success-fg no-underline">
              <span className="sr-only">[{t("conflictDialog.addedText")}: </span>
              {part.text}
              <span className="sr-only">]</span>
            </ins>
          );
        }
        return null;
      })}
    </>
  );
}

function ReviewTable({ diff, t }: { diff: SnapshotDiff; t: EditorT }) {
  const statusOf = (kind: string) =>
    kind === "added"
      ? t("conflictDialog.added")
      : kind === "removed"
        ? t("conflictDialog.removed")
        : kind === "changed"
          ? t("conflictDialog.changed")
          : t("conflictDialog.unchanged");
  const empty = <span className="text-muted">{t("conflictDialog.empty")}</span>;
  return (
    <div className="mt-4" data-testid="editor-conflict-review">
      <p role="status" className="mb-2 text-caption text-muted">
        {diff.changedCount === 0 ? t("conflictDialog.noChanges") : t("conflictDialog.changes", { count: diff.changedCount })}
      </p>
      <div className="overflow-x-auto rounded-(--radius-sm) border border-line">
        <table className="w-full table-fixed text-left text-body-sm">
          <caption className="sr-only">{t("conflictDialog.review")}</caption>
          <thead>
            <tr className="border-b border-line">
              <th scope="col" className="w-24 px-3 py-2 font-medium">{t("conflictDialog.change")}</th>
              <th scope="col" className="px-3 py-2 font-medium">{t("conflictDialog.theirs")}</th>
              <th scope="col" className="px-3 py-2 font-medium">{t("conflictDialog.mine")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {diff.blocks.map((block) => (
              <tr key={block.id} className="align-top">
                <td className="px-3 py-2">{statusOf(block.kind)}</td>
                <td className="px-3 py-2 whitespace-pre-wrap">
                  {block.kind === "changed" ? (
                    <Parts parts={block.parts} side="before" t={t} />
                  ) : block.kind === "added" ? (
                    empty
                  ) : block.kind === "removed" ? (
                    <del className="rounded-sm bg-danger/15 text-danger-fg">{block.before.text || empty}</del>
                  ) : (
                    block.before.text || empty
                  )}
                </td>
                <td className="px-3 py-2 whitespace-pre-wrap">
                  {block.kind === "changed" ? (
                    <Parts parts={block.parts} side="after" t={t} />
                  ) : block.kind === "removed" ? (
                    empty
                  ) : block.kind === "added" ? (
                    <ins className="rounded-sm bg-success/15 text-success-fg no-underline">{block.after.text || empty}</ins>
                  ) : (
                    block.after.text || empty
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
