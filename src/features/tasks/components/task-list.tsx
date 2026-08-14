"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import Link from "next/link";
import { Archive, CalendarClock, Flag, UserRound } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input, Label, Select } from "@/components/ui/input";
import { SelectionCheckbox } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { PriorityBadge, TASK_STATUS_META } from "@/components/shared/status-badges";
import { StatusSelect } from "@/features/tasks/components/status-select";
import { bulkUpdateTasks } from "@/features/tasks/services/task.commands";
import { cn, dueLabel } from "@/lib/utils";
import type { Option } from "@/features/tasks/components/task-create-dialog";
import type { Task, TaskStatus } from "@/types/entities";

type BulkAction = "status" | "assignee" | "priority" | "due" | "archive";

/**
 * Selectable task list with bulk actions (P0-TSK-05). Rows open the task
 * drawer through the `task` URL param so list context is preserved and the
 * URL stays shareable (WORK-008).
 */
export function TaskList({
  groups,
  people,
}: {
  groups: { key: string; label: string; tasks: Task[] }[];
  people: Option[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkAction, setBulkAction] = useState<BulkAction | null>(null);
  const [applying, setApplying] = useState(false);

  const allTasks = groups.flatMap((g) => g.tasks);
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
      toast(result.error ?? "Bulk update failed.", { tone: "error" });
      return;
    }
    toast(`Updated ${result.updated ?? selected.size} tasks.`);
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
          aria-label="Bulk actions"
          className="sticky top-16 z-20 mb-3 flex flex-wrap items-center gap-2 rounded-(--radius-md) border border-brand/30 bg-brand-soft px-3 py-2"
        >
          <span className="text-[13px] font-medium">
            {selected.size} selected
          </span>
          <div className="ml-auto flex flex-wrap gap-1.5">
            <Button size="sm" variant="secondary" onClick={() => setBulkAction("status")}>
              Status
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setBulkAction("assignee")}>
              <UserRound className="size-3.5" aria-hidden />
              Reassign
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setBulkAction("priority")}>
              <Flag className="size-3.5" aria-hidden />
              Priority
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setBulkAction("due")}>
              <CalendarClock className="size-3.5" aria-hidden />
              Reschedule
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setBulkAction("archive")}>
              <Archive className="size-3.5" aria-hidden />
              Archive
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              Clear
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
            label="Select all tasks"
          />
          Select all
        </label>
      ) : null}

      <div className="space-y-7">
        {groups.map((group) => {
          if (group.tasks.length === 0) return null;
          return (
            <section key={group.key} aria-labelledby={`bucket-${group.key}`}>
              <h2
                id={`bucket-${group.key}`}
                className="section-heading mb-2 flex items-center gap-2"
              >
                {group.label}
                <span className="meta font-normal">{group.tasks.length}</span>
              </h2>
              <div className="card overflow-hidden">
                {group.tasks.map((task) => {
                  const due = dueLabel(task.due_at);
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
                        label={`Select ${task.title}`}
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
                            <span>No project</span>
                          )}
                          {task.blocked_reason ? (
                            <span className="text-danger">
                              Blocked: {task.blocked_reason}
                            </span>
                          ) : null}
                        </span>
                      </button>
                      <span
                        className={cn(
                          "text-[12.5px] whitespace-nowrap",
                          due.tone === "danger"
                            ? "font-medium text-danger"
                            : due.tone === "warning"
                              ? "font-medium text-warning"
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
                        <Badge tone="neutral">Unassigned</Badge>
                      )}
                      <StatusSelect taskId={task.id} status={task.status} />
                    </div>
                  );
                })}
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
            ? `Archive ${selected.size} tasks?`
            : `Update ${selected.size} tasks`
        }
      >
        <form onSubmit={applyBulk} className="space-y-4">
          {bulkAction === "status" ? (
            <div>
              <Label htmlFor="bulk-status">New status</Label>
              <Select id="bulk-status" name="status" defaultValue="in_progress">
                {(Object.keys(TASK_STATUS_META) as TaskStatus[])
                  .filter((s) => s !== "blocked")
                  .map((s) => (
                    <option key={s} value={s}>
                      {TASK_STATUS_META[s].label}
                    </option>
                  ))}
              </Select>
              <p className="mt-1 text-[12.5px] text-muted">
                Blocked isn&apos;t available in bulk — each blocked task needs
                its own reason.
              </p>
            </div>
          ) : null}
          {bulkAction === "assignee" ? (
            <div>
              <Label htmlFor="bulk-assignee">Assign to</Label>
              <Select id="bulk-assignee" name="assigneeId" defaultValue="">
                <option value="">Unassigned</option>
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
              <Label htmlFor="bulk-priority">New priority</Label>
              <Select id="bulk-priority" name="priority" defaultValue="medium">
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </Select>
            </div>
          ) : null}
          {bulkAction === "due" ? (
            <div>
              <Label htmlFor="bulk-due">New due date</Label>
              <Input id="bulk-due" name="dueAt" type="date" />
              <p className="mt-1 text-[12.5px] text-muted">
                Leave empty to clear the due date.
              </p>
            </div>
          ) : null}
          {bulkAction === "archive" ? (
            <p className="text-[13.5px] text-muted">
              Archived tasks leave active views but keep their history and
              attribution. This can be reversed by an administrator.
            </p>
          ) : null}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={() => setBulkAction(null)}>
              Cancel
            </Button>
            <Button
              type="submit"
              loading={applying}
              variant={bulkAction === "archive" ? "danger" : "primary"}
            >
              {bulkAction === "archive" ? "Archive tasks" : "Apply to selection"}
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}

/** Filter bar whose state lives in the URL so views are shareable. */
export function TaskFilterBar({
  projects,
  activeFilters,
}: {
  projects: Option[];
  activeFilters: { status?: string; priority?: string; project?: string; q?: string };
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function setFilter(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    params.delete("task");
    const query = params.toString();
    router.replace(query ? `?${query}` : window.location.pathname, {
      scroll: false,
    });
  }

  const hasFilters = Boolean(
    activeFilters.status ||
      activeFilters.priority ||
      activeFilters.project ||
      activeFilters.q,
  );

  return (
    <div className="mb-5 flex flex-wrap items-center gap-2">
      <Input
        type="search"
        placeholder="Search my tasks…"
        aria-label="Search my tasks"
        defaultValue={activeFilters.q ?? ""}
        onChange={(e) => setFilter("q", e.target.value)}
        className="h-9 w-full sm:w-56"
      />
      <Select
        aria-label="Filter by status"
        value={activeFilters.status ?? ""}
        onChange={(e) => setFilter("status", e.target.value)}
        className="h-9 w-auto text-[13px]"
      >
        <option value="">All open statuses</option>
        {(Object.keys(TASK_STATUS_META) as TaskStatus[]).map((s) => (
          <option key={s} value={s}>
            {TASK_STATUS_META[s].label}
          </option>
        ))}
      </Select>
      <Select
        aria-label="Filter by priority"
        value={activeFilters.priority ?? ""}
        onChange={(e) => setFilter("priority", e.target.value)}
        className="h-9 w-auto text-[13px]"
      >
        <option value="">Any priority</option>
        <option value="critical">Critical</option>
        <option value="high">High</option>
        <option value="medium">Medium</option>
        <option value="low">Low</option>
      </Select>
      <Select
        aria-label="Filter by project"
        value={activeFilters.project ?? ""}
        onChange={(e) => setFilter("project", e.target.value)}
        className="h-9 w-auto max-w-48 text-[13px]"
      >
        <option value="">Any project</option>
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
      </Select>
      {hasFilters ? (
        <Link
          href="/my-work"
          className="text-[13px] font-medium text-brand hover:underline"
        >
          Clear filters
        </Link>
      ) : null}
    </div>
  );
}
