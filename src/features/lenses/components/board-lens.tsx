"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { StatusSelect } from "@/features/tasks/components/status-select";
import { BlockedReasonDialog } from "@/features/tasks/components/blocked-reason-dialog";
import { updateTaskStatus } from "@/features/tasks/services/task.commands";
import { useLocale } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import type { CatalogProperty } from "@/lib/query/catalog";
import type { LensRow } from "@/lib/query/run";
import type { TaskStatus } from "@/types/entities";
import { useLensT } from "@/features/lenses/i18n/client";
import { TaskMeta, TaskTitleLink, textOf, refOf } from "./task-card-bits";

/** Cards drawn per column before "Show more", as on the old board. */
const CARD_LIMIT = 25;

/**
 * The board lens (M8c): the same rows as any lens, one column per option of
 * the group property (status for tasks). Cards move by the status select on
 * every card (the keyboard path) or by drag and drop; both go through the
 * existing updateTaskStatus command, blocked-reason dialog included.
 */
export function BoardLens({
  rows,
  groupProperty,
  timeZone,
}: {
  rows: LensRow[];
  groupProperty: CatalogProperty;
  timeZone: string;
}) {
  const t = useLensT();
  const locale = useLocale();
  const router = useRouter();
  const [moved, setMoved] = React.useState<Record<string, string>>({});
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());
  const [dragId, setDragId] = React.useState<string | null>(null);
  const [dropTarget, setDropTarget] = React.useState<string | null>(null);
  const [announcement, setAnnouncement] = React.useState("");
  const [askingBlocked, setAskingBlocked] = React.useState<{ id: string; title: string } | null>(null);
  const [pending, startTransition] = React.useTransition();

  const choices = groupProperty.choices ?? [];
  const label = (key: string) => {
    const c = choices.find((x) => x.key === key);
    return c ? (locale.startsWith("fr") ? c.label.fr : c.label.en) : key;
  };
  const statusOf = (row: LensRow) => moved[row.id] ?? row.group ?? textOf(row, groupProperty.key) ?? "";

  const commit = (row: LensRow, next: string, reason?: string) => {
    const before = statusOf(row);
    setMoved((m) => ({ ...m, [row.id]: next }));
    startTransition(async () => {
      const result = await updateTaskStatus(row.id, next as TaskStatus, reason);
      if (result.ok) {
        setAnnouncement(t("board.moved", { title: row.title, column: label(next) }));
        router.refresh();
      } else {
        setMoved((m) => ({ ...m, [row.id]: before }));
        setAnnouncement(t("table.saveFailed", { reason: result.error ?? t("common.loadFailed") }));
      }
    });
  };

  const move = (row: LensRow, next: string) => {
    if (next === statusOf(row)) return;
    if (next === "blocked") setAskingBlocked({ id: row.id, title: row.title });
    else commit(row, next);
  };

  const byId = new Map(rows.map((r) => [r.id, r]));

  return (
    <div>
      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>
      <div className="overflow-x-auto pb-3">
        <div className="flex gap-3">
          {choices.map((choice) => {
            const columnRows = rows.filter((r) => statusOf(r) === choice.key);
            const shown = expanded.has(choice.key) ? columnRows : columnRows.slice(0, CARD_LIMIT);
            const hidden = columnRows.length - shown.length;
            const headingId = `lens-board-${choice.key}`;
            return (
              <section
                key={choice.key}
                aria-labelledby={headingId}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDropTarget(choice.key);
                }}
                onDragLeave={() => setDropTarget(null)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDropTarget(null);
                  const row = dragId ? byId.get(dragId) : undefined;
                  if (row) move(row, choice.key);
                  setDragId(null);
                }}
                className={cn(
                  "w-72 shrink-0 rounded-(--radius-md) border border-line bg-surface-soft/50 p-2.5",
                  dropTarget === choice.key && "bg-brand-soft/60 ring-2 ring-brand/35",
                )}
              >
                <header className="mb-1 flex items-center justify-between px-1.5 py-1.5">
                  <h2 id={headingId} className="text-[12.5px] font-bold uppercase tracking-[0.06em] text-ink">
                    {label(choice.key)}
                  </h2>
                  <span className="rounded-full border border-line bg-surface px-2 py-0.5 text-[11px] font-bold text-muted">
                    {columnRows.length}
                  </span>
                </header>
                <div className="space-y-2.5">
                  {shown.map((row) => {
                    const project = refOf(row, "project");
                    const reason = textOf(row, "blocked_reason");
                    return (
                      <article
                        key={row.id}
                        data-lens-card={row.id}
                        draggable
                        onDragStart={() => setDragId(row.id)}
                        onDragEnd={() => setDragId(null)}
                        className={cn("card space-y-2.5 p-3.5", dragId === row.id && "opacity-50")}
                      >
                        <TaskTitleLink row={row} className="block text-[13.5px] leading-snug" />
                        {project?.label ? (
                          <p className="truncate text-[11.5px] font-medium text-brand-fg">{project.label}</p>
                        ) : null}
                        {reason ? (
                          <p className="rounded-(--radius-sm) border border-danger/15 bg-danger/8 px-2 py-1.5 text-[12px] text-danger-fg">
                            {reason}
                          </p>
                        ) : null}
                        <div className="border-t border-line/70 pt-2.5">
                          <TaskMeta row={row} timeZone={timeZone} />
                        </div>
                        {groupProperty.key === "status" ? (
                          <StatusSelect
                            taskId={row.id}
                            taskTitle={row.title}
                            status={statusOf(row) as TaskStatus}
                            onSelect={(next) => move(row, next)}
                          />
                        ) : null}
                      </article>
                    );
                  })}
                  {hidden > 0 ? (
                    <button
                      type="button"
                      onClick={() => setExpanded((e) => new Set(e).add(choice.key))}
                      className="w-full rounded-(--radius-sm) border border-dashed border-line bg-surface/45 px-1.5 py-2 text-center text-[12.5px] font-medium text-brand-fg hover:bg-surface"
                    >
                      {t("board.showMore", { count: hidden })}
                    </button>
                  ) : null}
                  {columnRows.length === 0 ? (
                    <p className="rounded-(--radius-sm) border border-dashed border-line px-1.5 py-5 text-center text-[12px] text-muted">
                      {t("board.emptyColumn")}
                    </p>
                  ) : null}
                </div>
              </section>
            );
          })}
        </div>
      </div>
      <BlockedReasonDialog
        open={askingBlocked !== null}
        taskTitle={askingBlocked?.title ?? null}
        busy={pending}
        onCancel={() => setAskingBlocked(null)}
        onConfirm={(reason) => {
          const target = askingBlocked ? byId.get(askingBlocked.id) : undefined;
          setAskingBlocked(null);
          if (target) commit(target, "blocked", reason);
        }}
      />
    </div>
  );
}
