"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronUp, CheckCircle2, Circle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import {
  MILESTONE_STATUS_LABELS,
  OPEN_MILESTONE_STATUSES,
  type MilestoneStatus,
} from "@/features/projects/schemas";
import {
  completeMilestone,
  deleteMilestone,
  reorderMilestone,
  updateMilestone,
} from "@/features/projects/services/milestone.commands";
import {
  addMilestoneDependency,
  removeMilestoneDependency,
} from "@/features/tasks/services/planning.commands";
import type { Option } from "@/features/tasks/components/task-create-dialog";
import type { Milestone } from "@/types/entities";
import { formatDate } from "@/lib/utils";

const STATUS_TONE: Record<MilestoneStatus, "neutral" | "info" | "success" | "danger"> = {
  planned: "neutral",
  in_progress: "info",
  completed: "success",
  missed: "danger",
};

/**
 * A project's milestones, in the order somebody arranged them.
 *
 * Owner, description, status and completion evidence have been columns since
 * `20260912040000` and were touched by no application code at all, so this is
 * the first place any of them is readable. Reordering is move-up/move-down
 * rather than drag: the board shipped a drag-only reorder in #30 that could
 * not be operated from a keyboard, and that is a recorded precedent, not a
 * hypothetical.
 */
export function MilestoneRail({
  milestones,
  people,
  canManage,
  dependencies = [],
}: {
  milestones: Milestone[];
  people: Option[];
  canManage: boolean;
  /**
   * Every dependency edge among this project's milestones (P1-TSK-09).
   * Passed whole rather than fetched per row: the rail already has the
   * milestones, and an edge is two ids.
   */
  dependencies?: { blocking_milestone_id: string; blocked_milestone_id: string }[];
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState<Milestone | null>(null);
  const [completing, setCompleting] = React.useState<Milestone | null>(null);

  async function run(key: string, work: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(key);
    setError(null);
    const result = await work();
    setBusy(null);
    if (!result.ok) {
      setError(result.error ?? "That did not work.");
      return false;
    }
    router.refresh();
    return true;
  }

  const nameById = new Map(milestones.map((m) => [m.id, m.name]));

  function blockersOf(milestoneId: string) {
    return dependencies
      .filter((edge) => edge.blocked_milestone_id === milestoneId)
      .map((edge) => ({
        id: edge.blocking_milestone_id,
        name: nameById.get(edge.blocking_milestone_id) ?? "A milestone elsewhere",
      }));
  }

  /**
   * What may still be added as a blocker: not itself, not something already
   * blocking it, and not anything it can already reach. That last clause is
   * the cycle check, done here only so the choice is never offered; the
   * database decides, because it can see edges this viewer cannot.
   */
  function availableBlockers(milestoneId: string) {
    const reachable = new Set<string>([milestoneId]);
    const pending = [milestoneId];
    while (pending.length) {
      const current = pending.pop()!;
      for (const edge of dependencies) {
        if (edge.blocking_milestone_id === current && !reachable.has(edge.blocked_milestone_id)) {
          reachable.add(edge.blocked_milestone_id);
          pending.push(edge.blocked_milestone_id);
        }
      }
    }
    const existing = new Set(blockersOf(milestoneId).map((b) => b.id));
    return milestones.filter((m) => !reachable.has(m.id) && !existing.has(m.id));
  }

  if (milestones.length === 0) {
    return (
      <p className="card px-4 py-6 text-center text-[13px] text-muted">
        No milestones defined.
      </p>
    );
  }

  return (
    <>
      {error ? (
        <p role="alert" className="mb-2 text-[13px] text-danger-fg">
          {error}
        </p>
      ) : null}

      <ul className="card divide-y divide-line">
        {milestones.map((milestone, index) => {
          const completed = Boolean(milestone.completed_at);
          const status = (milestone.status ?? "planned") as MilestoneStatus;
          return (
            <li key={milestone.id} className="px-4 py-2.5">
              <div className="flex items-center gap-2.5">
                {completed ? (
                  <CheckCircle2
                    className="size-4 shrink-0 text-success-fg"
                    aria-label="Completed"
                  />
                ) : (
                  <Circle className="size-4 shrink-0 text-muted/50" aria-label="Open" />
                )}
                <span className="min-w-0 flex-1 truncate text-[13.5px]">
                  {milestone.name}
                </span>
                <Badge tone={STATUS_TONE[status]}>
                  {MILESTONE_STATUS_LABELS[status]}
                </Badge>
                <span className="meta whitespace-nowrap">
                  {formatDate(milestone.due_date)}
                </span>
              </div>

              <p className="meta mt-0.5 pl-6.5">
                {milestone.owner?.full_name ?? "Nobody named"}
              </p>

              {milestone.description ? (
                <p className="mt-0.5 pl-6.5 text-[13px]">{milestone.description}</p>
              ) : null}

              {milestone.evidence ? (
                <p className="mt-0.5 pl-6.5 text-[13px]">
                  <span className="text-muted">Evidence: </span>
                  {milestone.evidence}
                </p>
              ) : null}

              {blockersOf(milestone.id).length > 0 ? (
                <p className="mt-0.5 pl-6.5 text-[13px]">
                  <span className="text-muted">Blocked by: </span>
                  {blockersOf(milestone.id).map((blocker) => (
                    <span key={blocker.id} className="mr-2 inline-flex items-center gap-1">
                      {blocker.name}
                      {canManage ? (
                        <button
                          type="button"
                          aria-label={`Remove ${blocker.name} as a blocker of ${milestone.name}`}
                          className="text-[12px] text-muted hover:underline"
                          disabled={busy === milestone.id}
                          onClick={() =>
                            void run(milestone.id, () =>
                              removeMilestoneDependency(blocker.id, milestone.id),
                            )
                          }
                        >
                          ×
                        </button>
                      ) : null}
                    </span>
                  ))}
                </p>
              ) : null}

              {canManage && availableBlockers(milestone.id).length > 0 ? (
                <div className="mt-1 pl-6.5">
                  <label className="sr-only" htmlFor={`blocker-${milestone.id}`}>
                    Add a blocker for {milestone.name}
                  </label>
                  {/* The list offered already excludes this milestone and the
                      ones it blocks, so the obvious cycles cannot be chosen at
                      all. The database refuses the rest — a longer loop that
                      runs through a project this viewer cannot open — and its
                      message is what surfaces here. */}
                  <select
                    id={`blocker-${milestone.id}`}
                    className="rounded border border-line bg-surface px-1.5 py-1 text-[12.5px]"
                    defaultValue=""
                    disabled={busy === milestone.id}
                    onChange={(e) => {
                      const blockingMilestoneId = e.target.value;
                      if (!blockingMilestoneId) return;
                      e.target.value = "";
                      void run(milestone.id, () =>
                        addMilestoneDependency({
                          blockingMilestoneId,
                          blockedMilestoneId: milestone.id,
                        }),
                      );
                    }}
                  >
                    <option value="">Add a blocker…</option>
                    {availableBlockers(milestone.id).map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.name}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}

              {canManage ? (
                <div className="mt-1.5 flex flex-wrap items-center gap-2 pl-6.5">
                  <button
                    type="button"
                    className="text-[12.5px] font-medium text-brand-fg hover:underline"
                    disabled={busy === milestone.id}
                    onClick={() =>
                      completed
                        ? void run(milestone.id, () =>
                            completeMilestone({
                              milestoneId: milestone.id,
                              completed: false,
                            }),
                          )
                        : setCompleting(milestone)
                    }
                  >
                    {completed ? "Reopen" : "Complete"}
                  </button>
                  <button
                    type="button"
                    className="text-[12.5px] font-medium text-brand-fg hover:underline"
                    onClick={() => setEditing(milestone)}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="text-[12.5px] text-muted hover:text-danger-fg"
                    disabled={busy === milestone.id}
                    onClick={() => void run(milestone.id, () => deleteMilestone(milestone.id))}
                  >
                    Delete
                  </button>
                  <span className="ml-auto flex items-center gap-1">
                    <button
                      type="button"
                      aria-label={`Move ${milestone.name} up`}
                      className="rounded-(--radius-sm) p-1 text-muted hover:bg-surface-soft hover:text-ink disabled:opacity-40"
                      disabled={index === 0 || busy === milestone.id}
                      onClick={() =>
                        void run(milestone.id, () =>
                          reorderMilestone({ milestoneId: milestone.id, direction: "up" }),
                        )
                      }
                    >
                      <ChevronUp className="size-4" aria-hidden />
                    </button>
                    <button
                      type="button"
                      aria-label={`Move ${milestone.name} down`}
                      className="rounded-(--radius-sm) p-1 text-muted hover:bg-surface-soft hover:text-ink disabled:opacity-40"
                      disabled={index === milestones.length - 1 || busy === milestone.id}
                      onClick={() =>
                        void run(milestone.id, () =>
                          reorderMilestone({ milestoneId: milestone.id, direction: "down" }),
                        )
                      }
                    >
                      <ChevronDown className="size-4" aria-hidden />
                    </button>
                  </span>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      <Dialog
        open={completing !== null}
        onClose={() => setCompleting(null)}
        title={completing ? `Complete “${completing.name}”` : "Complete milestone"}
      >
        <form
          className="space-y-4"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!completing) return;
            const form = new FormData(event.currentTarget);
            const saved = await run(completing.id, () =>
              completeMilestone({
                milestoneId: completing.id,
                completed: true,
                evidence: String(form.get("evidence") ?? "").trim(),
              }),
            );
            if (saved) setCompleting(null);
          }}
        >
          <div>
            <Label htmlFor="milestone-evidence">
              What shows this milestone was met?
            </Label>
            <Textarea
              id="milestone-evidence"
              name="evidence"
              required
              rows={3}
              maxLength={2000}
              placeholder="The signed contract, the attendance sheet, the published page."
            />
            <p className="mt-1 text-[12.5px] text-muted">
              Kept with the milestone. Reopening it clears this, because evidence
              for a completion that was undone is evidence for nothing.
            </p>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setCompleting(null)}>
              Cancel
            </Button>
            <Button type="submit" loading={busy === completing?.id}>
              Complete
            </Button>
          </div>
        </form>
      </Dialog>

      <Dialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing ? `Edit “${editing.name}”` : "Edit milestone"}
      >
        {editing ? (
          <form
            className="space-y-4"
            onSubmit={async (event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              const saved = await run(editing.id, () =>
                updateMilestone({
                  milestoneId: editing.id,
                  name: String(form.get("name") ?? "").trim(),
                  description: String(form.get("description") ?? "").trim(),
                  ownerId: String(form.get("ownerId") ?? ""),
                  dueDate: String(form.get("dueDate") ?? ""),
                  status: String(form.get("status") ?? "planned"),
                }),
              );
              if (saved) setEditing(null);
            }}
          >
            <div>
              <Label htmlFor="edit-milestone-name">Name</Label>
              <Input
                id="edit-milestone-name"
                name="name"
                required
                maxLength={200}
                defaultValue={editing.name}
              />
            </div>
            <div>
              <Label htmlFor="edit-milestone-description">Description</Label>
              <Textarea
                id="edit-milestone-description"
                name="description"
                rows={2}
                maxLength={2000}
                defaultValue={editing.description ?? ""}
              />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="edit-milestone-owner">Owner</Label>
                <Select
                  id="edit-milestone-owner"
                  name="ownerId"
                  defaultValue={editing.owner_id ?? ""}
                >
                  <option value="">Nobody named</option>
                  {people.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.label}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="edit-milestone-due">Target date</Label>
                <Input
                  id="edit-milestone-due"
                  name="dueDate"
                  type="date"
                  defaultValue={editing.due_date ?? ""}
                />
              </div>
              <div>
                <Label htmlFor="edit-milestone-status">Status</Label>
                <Select
                  id="edit-milestone-status"
                  name="status"
                  defaultValue={
                    editing.completed_at ? "planned" : (editing.status ?? "planned")
                  }
                  disabled={Boolean(editing.completed_at)}
                >
                  {OPEN_MILESTONE_STATUSES.map((value) => (
                    <option key={value} value={value}>
                      {MILESTONE_STATUS_LABELS[value]}
                    </option>
                  ))}
                </Select>
                <p className="mt-1 text-[12.5px] text-muted">
                  {editing.completed_at
                    ? "Reopen the milestone to change this."
                    : "Missed is only available once the target date has passed."}
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button type="submit" loading={busy === editing.id}>
                Save milestone
              </Button>
            </div>
          </form>
        ) : null}
      </Dialog>
    </>
  );
}
