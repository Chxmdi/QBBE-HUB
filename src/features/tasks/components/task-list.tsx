"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Archive, CalendarClock, Flag, UserRound } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input, Label, Select } from "@/components/ui/input";
import { SelectionCheckbox } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import {
  PriorityBadge,
  priorityLabel,
  taskStatusLabel,
} from "@/components/shared/status-badges";
import { StatusSelect } from "@/features/tasks/components/status-select";
import { bulkUpdateTasks } from "@/features/tasks/services/task.commands";
import { BULK_STATUSES } from "@/features/tasks/schemas";
import { useLocale, useT } from "@/lib/i18n/client";
import { cn, dueLabel } from "@/lib/utils";
import type { Option } from "@/features/tasks/components/task-create-dialog";
import type { Task, TaskPriority } from "@/types/entities";

/** Rows drawn per group before "Show more" (#115: every row costs render time). */
export const TASK_LIST_ROW_LIMIT = 25;

const PRIORITIES: TaskPriority[] = ["low", "medium", "high", "critical"];

type BulkAction = "status" | "assignee" | "priority" | "due" | "archive";

/**
 * Selectable task list with bulk actions (P0-TSK-05). Rows open the task
 * drawer through the `task` URL param so list context is preserved and the
 * URL stays shareable (WORK-008).
 */
export function TaskList({
  groups,
  people,
  timeZone,
  showGroupHeadings = true,
}: {
  groups: { key: string; label: string; tasks: Task[] }[];
  people: Option[];
  /**
   * The organization's zone. The page groups rows by due date in this zone,
   * so the rows have to name their due dates in it too — otherwise a task can
   * sit under "Overdue" while its own row reads "Due today".
   */
  timeZone?: string;
  /** Off when the caller already titled the section, so it is not said twice. */
  showGroupHeadings?: boolean;
}) {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkAction, setBulkAction] = useState<BulkAction | null>(null);
  const [applying, setApplying] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  const shownGroups = groups.map((group) => ({
    ...group,
    shown: expanded.has(group.key)
      ? group.tasks
      : group.tasks.slice(0, TASK_LIST_ROW_LIMIT),
  }));
  // "Select all" means every row on screen: a bulk change never reaches a row
  // the person has not seen.
  const allTasks = shownGroups.flatMap((g) => g.shown);
  const allSelected = allTasks.length > 0 && selected.size === allTasks.length;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function openTask(id: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("task", id);
    router.replace(`?${params.toString()}`, { scroll: false });
  }

  async function applyBulk(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!bulkAction) return;
    const form = new FormData(e.currentTarget);
    setApplying(true);
    const result = await bulkUpdateTasks({
      taskIds: Array.from(selected),
      action: bulkAction,
      status: (form.get("status") as string) || undefined,
      assigneeId: bulkAction === "assignee" ? (form.get("assigneeId") as string) || null : undefined,
      priority: (form.get("priority") as string) || undefined,
      dueAt: bulkAction === "due" ? (form.get("dueAt") as string) || null : undefined,
    });
    setApplying(false);
    if (!result.ok) {
      toast(result.error ?? t("tasks.list.bulkFailed"), { tone: "error" });
      return;
    }
    const updated = result.updated ?? selected.size;
    toast(
      updated === 1
        ? t("tasks.list.updatedOne", { count: updated })
        : t("tasks.list.updatedOther", { count: updated }),
    );
    setSelected(new Set());
    setBulkAction(null);
    router.refresh();
  }

  return (
    <div>
      {/* Bulk action bar — appears only with a selection */}
      {selected.size > 0 ? (
        <div
          role="region"
          aria-label={t("tasks.list.bulkActions")}
          className="sticky top-16 z-(--z-sticky-content) mb-3 flex flex-wrap items-center gap-2 rounded-(--radius-md) border border-brand/30 bg-brand-soft px-3 py-2"
        >
          <span className="text-[13px] font-medium">
            {t("tasks.list.selected", { count: selected.size })}
          </span>
          <div className="ml-auto flex flex-wrap gap-1.5">
            <Button size="sm" variant="secondary" onClick={() => setBulkAction("status")}>
              {t("tasks.list.status")}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setBulkAction("assignee")}>
              <UserRound className="size-3.5" aria-hidden />
              {t("tasks.list.reassign")}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setBulkAction("priority")}>
              <Flag className="size-3.5" aria-hidden />
              {t("tasks.list.priority")}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setBulkAction("due")}>
              <CalendarClock className="size-3.5" aria-hidden />
              {t("tasks.list.reschedule")}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setBulkAction("archive")}>
              <Archive className="size-3.5" aria-hidden />
              {t("tasks.list.archive")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              {t("tasks.list.clear")}
            </Button>
          </div>
        </div>
      ) : null}

      {allTasks.length > 0 ? (
        <label className="mb-2 flex items-center gap-2 text-[12.5px] text-muted">
          <SelectionCheckbox
            checked={allSelected}
            indeterminate={selected.size > 0 && !allSelected}
            onChange={(checked) =>
              setSelected(checked ? new Set(allTasks.map((t) => t.id)) : new Set())
            }
            label={t("tasks.list.selectAllLabel")}
          />
          {t("tasks.list.selectAll")}
        </label>
      ) : null}

      <div className="space-y-7">
        {shownGroups.map((group) => {
          if (group.tasks.length === 0) return null;
          const hiddenCount = group.tasks.length - group.shown.length;
          return (
            <section
              key={group.key}
              aria-label={showGroupHeadings ? undefined : group.label}
              aria-labelledby={showGroupHeadings ? `bucket-${group.key}` : undefined}
            >
              {showGroupHeadings ? (
                <h2
                  id={`bucket-${group.key}`}
                  className="section-heading mb-2 flex items-center gap-2"
                >
                  {group.label}
                  <span className="meta font-normal">{group.tasks.length}</span>
                </h2>
              ) : null}
              <div className="card overflow-hidden">
                {group.shown.map((task) => {
                  const due = dueLabel(task.due_at, timeZone, locale);
                  const isSelected = selected.has(task.id);
                  return (
                    <div
                      key={task.id}
                      className={cn(
                        "flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-line px-3 py-2.5 last:border-b-0",
                        isSelected ? "bg-brand-soft/40" : "hover:bg-surface-soft",
                        "transition-colors duration-(--duration-fast)",
                      )}
                    >
                      <SelectionCheckbox
                        checked={isSelected}
                        onChange={() => toggle(task.id)}
                        label={t("tasks.list.selectTask", { title: task.title })}
                      />
                      <button
                        type="button"
                        onClick={() => openTask(task.id)}
                        className="min-w-0 flex-1 basis-52 text-left"
                      >
                        <span className="block truncate text-[14px] font-medium">
                          {task.title}
                        </span>
                        <span className="meta flex flex-wrap items-center gap-x-2">
                          {task.project ? (
                            <span className="truncate">{task.project.name}</span>
                          ) : (
                            <span>{t("tasks.noProject")}</span>
                          )}
                          {task.blocked_reason ? (
                            <span className="text-danger-fg">
                              {t("tasks.blockedReason", { reason: task.blocked_reason })}
                            </span>
                          ) : null}
                        </span>
                      </button>
                      <span
                        className={cn(
                          "text-[12.5px] whitespace-nowrap",
                          due.tone === "danger"
                            ? "font-medium text-danger-fg"
                            : due.tone === "warning"
                              ? "font-medium text-warning-fg"
                              : "text-muted",
                        )}
                      >
                        {due.label}
                      </span>
                      <PriorityBadge priority={task.priority} />
                      {task.assignee ? (
                        <Avatar
                          name={task.assignee.full_name}
                          src={task.assignee.avatar_url}
                          size="sm"
                        />
                      ) : (
                        <Badge tone="neutral">{t("tasks.unassigned")}</Badge>
                      )}
                      <StatusSelect taskId={task.id} taskTitle={task.title} status={task.status} />
                    </div>
                  );
                })}
                {hiddenCount > 0 ? (
                  <button
                    type="button"
                    onClick={() =>
                      setExpanded((current) => new Set(current).add(group.key))
                    }
                    className="w-full border-t border-line px-3 py-2 text-left text-[12.5px] font-medium text-brand-fg hover:bg-surface-soft"
                  >
                    {t("tasks.showMore", { count: hiddenCount })}
                  </button>
                ) : null}
              </div>
            </section>
          );
        })}
      </div>

      {/* Bulk action dialog */}
      <Dialog
        open={bulkAction !== null}
        onClose={() => setBulkAction(null)}
        title={
          bulkAction === "archive"
            ? selected.size === 1
              ? t("tasks.list.archiveTitleOne", { count: selected.size })
              : t("tasks.list.archiveTitleOther", { count: selected.size })
            : selected.size === 1
              ? t("tasks.list.updateTitleOne", { count: selected.size })
              : t("tasks.list.updateTitleOther", { count: selected.size })
        }
      >
        <form onSubmit={applyBulk} className="space-y-4">
          {bulkAction === "status" ? (
            <div>
              <Label htmlFor="bulk-status">{t("tasks.list.newStatus")}</Label>
              <Select id="bulk-status" name="status" defaultValue="in_progress">
                {BULK_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {taskStatusLabel(s, t)}
                  </option>
                ))}
              </Select>
              <p className="mt-1 text-[12.5px] text-muted">
                {t("tasks.list.bulkBlockedHint")}
              </p>
            </div>
          ) : null}
          {bulkAction === "assignee" ? (
            <div>
              <Label htmlFor="bulk-assignee">{t("tasks.list.assignTo")}</Label>
              <Select id="bulk-assignee" name="assigneeId" defaultValue="">
                <option value="">{t("tasks.unassigned")}</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </Select>
            </div>
          ) : null}
          {bulkAction === "priority" ? (
            <div>
              <Label htmlFor="bulk-priority">{t("tasks.list.newPriority")}</Label>
              <Select id="bulk-priority" name="priority" defaultValue="medium">
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {priorityLabel(p, t)}
                  </option>
                ))}
              </Select>
            </div>
          ) : null}
          {bulkAction === "due" ? (
            <div>
              <Label htmlFor="bulk-due">{t("tasks.list.newDue")}</Label>
              <Input id="bulk-due" name="dueAt" type="date" />
              <p className="mt-1 text-[12.5px] text-muted">
                {t("tasks.list.clearDueHint")}
              </p>
            </div>
          ) : null}
          {bulkAction === "archive" ? (
            <p className="text-[13.5px] text-muted">
              {t("tasks.list.archiveBody")}
            </p>
          ) : null}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={() => setBulkAction(null)}>
              {t("common.cancel")}
            </Button>
            <Button
              type="submit"
              loading={applying}
              variant={bulkAction === "archive" ? "danger" : "primary"}
            >
              {bulkAction === "archive"
                ? t("tasks.list.archiveTasks")
                : t("tasks.list.applyToSelection")}
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
