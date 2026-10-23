"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { taskDrawerHref } from "@/features/tasks/task-url";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { PriorityBadge } from "@/components/shared/status-badges";
import { useLocale, useT } from "@/lib/i18n/client";
import { cn, dueLabel } from "@/lib/utils";
import type { LensRow, RefValue } from "@/lib/query/run";
import type { TaskPriority } from "@/types/entities";

/** Pieces shared by the board card and the list row for a task from a lens. */

export function refOf(row: LensRow, key: string): RefValue | null {
  const v = row.values[key];
  return v && typeof v === "object" && "id" in v ? v : null;
}

export function textOf(row: LensRow, key: string): string | null {
  const v = row.values[key];
  return typeof v === "string" && v !== "" ? v : null;
}

/** Opens the task drawer on My Work, the same place the old screens open it. */
export function taskHref(id: string): string {
  return `/my-work?task=${id}`;
}

export function TaskTitleLink({ row, className, inPlace = false }: { row: LensRow; className?: string; inPlace?: boolean }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const href = inPlace ? taskDrawerHref(pathname, searchParams.toString(), row.id) : taskHref(row.id);
  return (
    <Link href={href} scroll={false} onClick={(event) => {
      if (!inPlace || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      window.history.pushState(null, "", href + window.location.hash);
    }} className={cn("font-semibold text-ink hover:text-brand-fg", className)}>
      {row.title}
    </Link>
  );
}

export function TaskMeta({ row, timeZone }: { row: LensRow; timeZone: string }) {
  const t = useT();
  const locale = useLocale();
  const priority = textOf(row, "priority") as TaskPriority | null;
  const dueAt = textOf(row, "due");
  const assignee = refOf(row, "assignee");
  const due = dueAt ? dueLabel(dueAt, timeZone, locale) : null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {priority ? <PriorityBadge priority={priority} /> : null}
      {due ? (
        <span
          className={cn(
            "text-[11.5px]",
            due.tone === "danger" ? "font-semibold text-danger-fg" : due.tone === "warning" ? "font-semibold text-warning-fg" : "text-muted",
          )}
        >
          {due.label}
        </span>
      ) : null}
      <span className="ml-auto">
        {assignee?.label ? (
          <Avatar name={assignee.label} size="xs" />
        ) : (
          <Badge tone="neutral">{t("tasks.unassigned")}</Badge>
        )}
      </span>
    </div>
  );
}
