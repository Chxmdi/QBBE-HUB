"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useMemo } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import {
  DUE_WINDOWS,
  TASK_PRIORITIES,
  dueWindowLabel,
  countActiveFilters,
  type TaskFilters,
} from "@/features/tasks/filters";
import {
  TASK_STATUSES,
  taskPriorityText,
  taskStatusText,
} from "@/features/tasks/schemas";
import { useT } from "@/lib/i18n/client";
import type {
  MilestoneSelectOption,
  SelectOption,
} from "@/features/tasks/services/task.queries";

export interface FilterOptions {
  projects: SelectOption[];
  people: SelectOption[];
  programs: SelectOption[];
  milestones: MilestoneSelectOption[];
  labels: SelectOption[];
}

/**
 * The complete filter set (P0-TSK-08), shared by My Work and the board so the
 * two cannot narrow work differently.
 *
 * Every control writes to the URL. That is what makes a filtered view
 * shareable and savable, and it is why the same link shown to somebody else
 * still answers to their access rather than to the sender's.
 */
export function TaskFilterBar({
  filters,
  options,
  basePath,
  showOwner = true,
}: {
  filters: TaskFilters;
  options: FilterOptions;
  basePath: string;
  /** My Work is already scoped to one person, so an owner filter is noise. */
  showOwner?: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const searchParams = useSearchParams();
  const active = countActiveFilters(filters);

  // Milestones only make sense within the chosen project; offering every one
  // in the organization would make the control useless at any real size.
  const milestones = useMemo(
    () =>
      filters.project
        ? options.milestones.filter((m) => m.projectId === filters.project)
        : options.milestones,
    [filters.project, options.milestones],
  );

  function setFilter(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    // Changing a filter changes the list underneath, so an open task drawer
    // would be showing a record the list may no longer contain.
    params.delete("task");
    if (key === "project") params.delete("milestone");
    const query = params.toString();
    router.replace(query ? `${basePath}?${query}` : basePath, { scroll: false });
  }

  return (
    <div className="mb-5 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="search"
          placeholder={t("tasks.filters.searchPlaceholder")}
          aria-label={t("tasks.filters.searchLabel")}
          defaultValue={filters.q ?? ""}
          onChange={(e) => setFilter("q", e.target.value)}
          className="h-9 w-full sm:w-52"
        />

        <Select
          aria-label={t("tasks.filters.status")}
          value={filters.status ?? ""}
          onChange={(e) => setFilter("status", e.target.value)}
          className="h-9 w-auto text-[13px]"
        >
          <option value="">{t("tasks.filters.allOpenStatuses")}</option>
          {TASK_STATUSES.map((s) => (
            <option key={s} value={s}>
              {taskStatusText(s, t)}
            </option>
          ))}
        </Select>

        <Select
          aria-label={t("tasks.filters.priority")}
          value={filters.priority ?? ""}
          onChange={(e) => setFilter("priority", e.target.value)}
          className="h-9 w-auto text-[13px]"
        >
          <option value="">{t("tasks.filters.anyPriority")}</option>
          {TASK_PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {taskPriorityText(p, t)}
            </option>
          ))}
        </Select>

        <Select
          aria-label={t("tasks.filters.due")}
          value={filters.due ?? ""}
          onChange={(e) => setFilter("due", e.target.value)}
          className="h-9 w-auto text-[13px]"
        >
          <option value="">{t("tasks.filters.anyDue")}</option>
          {DUE_WINDOWS.map((w) => (
            <option key={w} value={w}>
              {dueWindowLabel(w, t)}
            </option>
          ))}
        </Select>

        <Select
          aria-label={t("tasks.filters.program")}
          value={filters.program ?? ""}
          onChange={(e) => setFilter("program", e.target.value)}
          className="h-9 w-auto max-w-44 text-[13px]"
        >
          <option value="">{t("tasks.filters.anyProgram")}</option>
          {options.programs.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </Select>

        <Select
          aria-label={t("tasks.filters.project")}
          value={filters.project ?? ""}
          onChange={(e) => setFilter("project", e.target.value)}
          className="h-9 w-auto max-w-44 text-[13px]"
        >
          <option value="">{t("tasks.filters.anyProject")}</option>
          {options.projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </Select>

        <Select
          aria-label={t("tasks.filters.milestone")}
          value={filters.milestone ?? ""}
          onChange={(e) => setFilter("milestone", e.target.value)}
          className="h-9 w-auto max-w-44 text-[13px]"
          disabled={milestones.length === 0}
        >
          <option value="">
            {milestones.length === 0
              ? t("tasks.filters.noMilestones")
              : t("tasks.filters.anyMilestone")}
          </option>
          {milestones.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </Select>

        {showOwner ? (
          <Select
            aria-label={t("tasks.filters.owner")}
            value={filters.owner ?? ""}
            onChange={(e) => setFilter("owner", e.target.value)}
            className="h-9 w-auto max-w-44 text-[13px]"
          >
            <option value="">{t("tasks.filters.anyone")}</option>
            {options.people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </Select>
        ) : null}

        <Select
          aria-label={t("tasks.filters.label")}
          value={filters.label ?? ""}
          onChange={(e) => setFilter("label", e.target.value)}
          className="h-9 w-auto max-w-44 text-[13px]"
          disabled={options.labels.length === 0}
        >
          <option value="">
            {options.labels.length === 0
              ? t("tasks.filters.noLabels")
              : t("tasks.filters.anyLabel")}
          </option>
          {options.labels.map((l) => (
            <option key={l.id} value={l.id}>
              {l.label}
            </option>
          ))}
        </Select>

        <Select
          aria-label={t("tasks.filters.blocked")}
          value={filters.blocked ?? ""}
          onChange={(e) => setFilter("blocked", e.target.value)}
          className="h-9 w-auto text-[13px]"
        >
          <option value="">{t("tasks.filters.blockedAny")}</option>
          <option value="yes">{t("tasks.filters.blockedOnly")}</option>
          <option value="no">{t("tasks.filters.notBlocked")}</option>
        </Select>

        {active > 0 ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => router.replace(basePath, { scroll: false })}
          >
            <X className="size-3.5" aria-hidden />
            {active === 1
              ? t("tasks.filters.clearOne", { count: active })
              : t("tasks.filters.clearOther", { count: active })}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
