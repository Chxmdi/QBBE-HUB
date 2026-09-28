"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronUp, CheckCircle2, Circle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import {
  milestoneStatusLabel,
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
import { useFormatters, useT } from "@/lib/i18n/client";

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
  const t = useT();
  const format = useFormatters();
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
      setError(result.error ?? t("projects.milestones.error"));
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
        name: nameById.get(edge.blocking_milestone_id) ?? t("projects.milestones.elsewhere"),
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
        {t("projects.milestones.empty")}
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
                    aria-label={t("projects.milestones.completedIcon")}
                  />
                ) : (
                  <Circle className="size-4 shrink-0 text-muted/50" aria-label={t("projects.milestones.openIcon")} />
                )}
                {/*
                  The row's title, and addressable as one. Every row now carries
                  a blocker picker listing the other milestones by name, so a
                  bare span left each name matching three times over: the title,
                  an option in a sibling row's picker, and that picker's label.
                  Tailwind's preflight drops the heading's own size and weight,
                  so this is a semantic change and not a visual one.
                */}
                <h3 className="min-w-0 flex-1 truncate text-[13.5px] font-normal">
                  {milestone.name}
                </h3>
                <Badge tone={STATUS_TONE[status]}>
                  {milestoneStatusLabel(status, t)}
                </Badge>
                <span className="meta whitespace-nowrap">
                  {format.date(milestone.due_date)}
                </span>
              </div>

              <p className="meta mt-0.5 pl-6.5">
                {milestone.owner?.full_name ?? t("projects.milestones.nobody")}
              </p>

              {milestone.description ? (
                <p className="mt-0.5 pl-6.5 text-[13px]">{milestone.description}</p>
              ) : null}

              {milestone.evidence ? (
                <p className="mt-0.5 pl-6.5 text-[13px]">
                  <span className="text-muted">{t("projects.milestones.evidence")}</span>
                  {milestone.evidence}
                </p>
              ) : null}

              {blockersOf(milestone.id).length > 0 ? (
                <p className="mt-0.5 pl-6.5 text-[13px]">
                  <span className="text-muted">{t("projects.milestones.blockedBy")}</span>
                  {blockersOf(milestone.id).map((blocker) => (
                    <span key={blocker.id} className="mr-2 inline-flex items-center gap-1">
                      {blocker.name}
                      {canManage ? (
                        <button
                          type="button"
                          aria-label={t("projects.milestones.removeBlocker", {
                            blocker: blocker.name,
                            milestone: milestone.name,
                          })}
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
                    {t("projects.milestones.addBlockerLabel", { milestone: milestone.name })}
                  </label>
                  {/* The list offered already excludes this milestone and the
                      ones it blocks, so the obvious cycles cannot be chosen at
                      all. The database refuses the rest — a longer loop that
                      runs through a project this viewer cannot open — and its
                      message is what surfaces here. */}
                  <Select
                    id={`blocker-${milestone.id}`}
                    className="h-8 w-auto px-1.5 text-[12.5px]"
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
                    <option value="">{t("projects.milestones.addBlocker")}</option>
                    {availableBlockers(milestone.id).map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.name}
                      </option>
                    ))}
                  </Select>
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
                    {completed ? t("projects.milestones.reopen") : t("projects.milestones.complete")}
                  </button>
                  <button
                    type="button"
                    className="text-[12.5px] font-medium text-brand-fg hover:underline"
                    onClick={() => setEditing(milestone)}
                  >
                    {t("projects.milestones.edit")}
                  </button>
                  <button
                    type="button"
                    className="text-[12.5px] text-muted hover:text-danger-fg"
                    disabled={busy === milestone.id}
                    onClick={() => void run(milestone.id, () => deleteMilestone(milestone.id))}
                  >
                    {t("projects.milestones.delete")}
                  </button>
                  <span className="ml-auto flex items-center gap-1">
                    <button
                      type="button"
                      aria-label={t("projects.milestones.moveUp", { name: milestone.name })}
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
                      aria-label={t("projects.milestones.moveDown", { name: milestone.name })}
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
        title={
          completing
            ? t("projects.milestones.completeTitle", { name: completing.name })
            : t("projects.milestones.completeTitleFallback")
        }
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
              {t("projects.milestones.evidenceLabel")}
            </Label>
            <Textarea
              id="milestone-evidence"
              name="evidence"
              required
              rows={3}
              maxLength={2000}
              placeholder={t("projects.milestones.evidencePlaceholder")}
            />
            <p className="mt-1 text-[12.5px] text-muted">
              {t("projects.milestones.evidenceHint")}
            </p>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setCompleting(null)}>
              {t("projects.milestones.cancel")}
            </Button>
            <Button type="submit" loading={busy === completing?.id}>
              {t("projects.milestones.complete")}
            </Button>
          </div>
        </form>
      </Dialog>

      <Dialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={
          editing
            ? t("projects.milestones.editTitle", { name: editing.name })
            : t("projects.milestones.editTitleFallback")
        }
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
              <Label htmlFor="edit-milestone-name">{t("projects.milestones.name")}</Label>
              <Input
                id="edit-milestone-name"
                name="name"
                required
                maxLength={200}
                defaultValue={editing.name}
              />
            </div>
            <div>
              <Label htmlFor="edit-milestone-description">{t("projects.milestones.description")}</Label>
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
                <Label htmlFor="edit-milestone-owner">{t("projects.milestones.owner")}</Label>
                <Select
                  id="edit-milestone-owner"
                  name="ownerId"
                  defaultValue={editing.owner_id ?? ""}
                >
                  <option value="">{t("projects.milestones.nobody")}</option>
                  {people.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.label}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="edit-milestone-due">{t("projects.milestones.targetDate")}</Label>
                <Input
                  id="edit-milestone-due"
                  name="dueDate"
                  type="date"
                  defaultValue={editing.due_date ?? ""}
                />
              </div>
              <div>
                <Label htmlFor="edit-milestone-status">{t("projects.milestones.statusLabel")}</Label>
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
                      {milestoneStatusLabel(value, t)}
                    </option>
                  ))}
                </Select>
                <p className="mt-1 text-[12.5px] text-muted">
                  {editing.completed_at
                    ? t("projects.milestones.reopenToChange")
                    : t("projects.milestones.missedHint")}
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setEditing(null)}>
                {t("projects.milestones.cancel")}
              </Button>
              <Button type="submit" loading={busy === editing.id}>
                {t("projects.milestones.save")}
              </Button>
            </div>
          </form>
        ) : null}
      </Dialog>
    </>
  );
}
