"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useMemo } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import {
  DUE_WINDOWS,
  DUE_WINDOW_LABELS,
  TASK_PRIORITIES,
  countActiveFilters,
  type TaskFilters,
} from "@/features/tasks/filters";
import { TASK_STATUSES, TASK_STATUS_LABELS } from "@/features/tasks/schemas";
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
          placeholder="Search tasks…"
          aria-label="Search tasks by title"
          defaultValue={filters.q ?? ""}
          onChange={(e) => setFilter("q", e.target.value)}
          className="h-9 w-full sm:w-52"
        />

        <Select
          aria-label="Filter by status"
          value={filters.status ?? ""}
          onChange={(e) => setFilter("status", e.target.value)}
          className="h-9 w-auto text-[13px]"
        >
          <option value="">All open statuses</option>
          {TASK_STATUSES.map((s) => (
            <option key={s} value={s}>
              {TASK_STATUS_LABELS[s]}
            </option>
          ))}
        </Select>

        <Select
          aria-label="Filter by priority"
          value={filters.priority ?? ""}
          onChange={(e) => setFilter("priority", e.target.value)}
          className="h-9 w-auto text-[13px]"
        >
          <option value="">Any priority</option>
          {TASK_PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {p.charAt(0).toUpperCase() + p.slice(1)}
            </option>
          ))}
        </Select>

        <Select
          aria-label="Filter by due date"
          value={filters.due ?? ""}
          onChange={(e) => setFilter("due", e.target.value)}
          className="h-9 w-auto text-[13px]"
        >
          <option value="">Any due date</option>
          {DUE_WINDOWS.map((w) => (
            <option key={w} value={w}>
              {DUE_WINDOW_LABELS[w]}
            </option>
          ))}
        </Select>

        <Select
          aria-label="Filter by program"
          value={filters.program ?? ""}
          onChange={(e) => setFilter("program", e.target.value)}
          className="h-9 w-auto max-w-44 text-[13px]"
        >
          <option value="">Any program</option>
          {options.programs.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </Select>

        <Select
          aria-label="Filter by project"
          value={filters.project ?? ""}
          onChange={(e) => setFilter("project", e.target.value)}
          className="h-9 w-auto max-w-44 text-[13px]"
        >
          <option value="">Any project</option>
          {options.projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </Select>

        <Select
          aria-label="Filter by milestone"
          value={filters.milestone ?? ""}
          onChange={(e) => setFilter("milestone", e.target.value)}
          className="h-9 w-auto max-w-44 text-[13px]"
          disabled={milestones.length === 0}
        >
          <option value="">
            {milestones.length === 0 ? "No milestones" : "Any milestone"}
          </option>
          {milestones.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </Select>

        {showOwner ? (
          <Select
            aria-label="Filter by owner"
            value={filters.owner ?? ""}
            onChange={(e) => setFilter("owner", e.target.value)}
            className="h-9 w-auto max-w-44 text-[13px]"
          >
            <option value="">Anyone</option>
            {options.people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </Select>
        ) : null}

        <Select
          aria-label="Filter by label"
          value={filters.label ?? ""}
          onChange={(e) => setFilter("label", e.target.value)}
          className="h-9 w-auto max-w-44 text-[13px]"
          disabled={options.labels.length === 0}
        >
          <option value="">
            {options.labels.length === 0 ? "No labels" : "Any label"}
          </option>
          {options.labels.map((l) => (
            <option key={l.id} value={l.id}>
              {l.label}
            </option>
          ))}
        </Select>

        <Select
          aria-label="Filter by blocked state"
          value={filters.blocked ?? ""}
          onChange={(e) => setFilter("blocked", e.target.value)}
          className="h-9 w-auto text-[13px]"
        >
          <option value="">Blocked or not</option>
          <option value="yes">Blocked only</option>
          <option value="no">Not blocked</option>
        </Select>

        {active > 0 ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => router.replace(basePath, { scroll: false })}
          >
            <X className="size-3.5" aria-hidden />
            Clear {active} filter{active === 1 ? "" : "s"}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
