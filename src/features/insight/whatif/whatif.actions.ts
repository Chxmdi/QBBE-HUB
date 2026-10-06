"use server";

import { redirect } from "next/navigation";
import { isEnabled } from "@/lib/feature-flags";
import { requireSession } from "@/lib/auth";
import type { Change } from "@/lib/objects/contracts";
import { createActivityFeedWriter } from "@/lib/objects/activity-feed";
import { createCan } from "@/lib/objects/can";
import { createActionRegistry, type ObjectWriter } from "@/features/objects/actions/registry";
import { createSupabaseChangeSetStore } from "@/features/objects/actions/supabase-store";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { planFingerprint, planShift, type ShiftPlan } from "./whatif";
import { loadSchedule } from "./whatif.source";

/**
 * Applies a previewed milestone shift (V3-4). The plan is recomputed here
 * from fresh data and must match the fingerprint the person previewed; the
 * writes go through the action registry (so each target is checked with
 * `can(…, "edit_structure")` and the change set is recorded for undo) and
 * then through public.insight_apply_schedule_shift, which writes every date
 * in one transaction under the caller's own row-level security.
 *
 * Milestones are not objects of the registry, so the change set is anchored
 * to the organization (p_organization); the tasks it moves are objects and
 * their object_event rows, written by the task trigger as the person, are
 * labelled with the change set. The activity_event rows below are for the
 * project activity page, which still reads the old feed.
 *
 * The outcome comes back in the address, so the page works without script.
 */

const ACTION_KEY = "insight.shift_milestone";

function back(milestoneId: string, days: number, result: string, extra = ""): never {
  redirect(`/insight/what-if?milestone=${encodeURIComponent(milestoneId)}&days=${days}&result=${result}${extra}`);
}

function changesOf(plan: ShiftPlan): Change[] {
  return [
    ...plan.milestones.map((move): Change => ({
      kind: "update",
      object: { id: move.id, type: "milestone" },
      property: "due",
      before: move.from,
      after: move.to,
    })),
    ...plan.tasks.map((move): Change => ({
      kind: "update",
      object: { id: move.id, type: "task" },
      property: "due",
      before: move.from,
      after: move.to,
    })),
  ];
}

export async function applyMilestoneShift(formData: FormData): Promise<void> {
  const milestoneId = String(formData.get("milestone") ?? "");
  const days = Math.trunc(Number(formData.get("days") ?? 0));
  const seen = String(formData.get("fingerprint") ?? "");
  if (!(await isEnabled("wos_lenses"))) redirect("/");
  const session = await requireSession();
  const client = await createSupabaseServerClient();

  const { schedule } = await loadSchedule(client);
  const plan = planShift(schedule, milestoneId, days);
  if (!plan || plan.days === 0 || plan.milestones.length === 0) back(milestoneId, days, "nothing");
  if (planFingerprint(plan) !== seen) back(milestoneId, days, "stale");

  const rowsOf = (changes: Change[], type: string) =>
    changes.flatMap((change) =>
      change.kind === "update" && change.object.type === type
        ? [{ id: change.object.id, from: change.before, to: change.after }]
        : [],
    );
  const writer: ObjectWriter = {
    // Undo replays the change set reversed: every row back to its old date.
    apply: async (changes) => {
      const { error } = await client.rpc("insight_apply_schedule_shift", {
        p_milestones: rowsOf(changes, "milestone"),
        p_tasks: rowsOf(changes, "task"),
      });
      if (error) throw new Error(error.code ?? error.message);
    },
    // The current due date, so undo stops when someone moved it since.
    read: async (change) => {
      const table = change.object.type === "milestone" ? "milestone" : "task";
      const column = change.object.type === "milestone" ? "due_date" : "due_at";
      const { data, error } = await client.from(table).select(column).eq("id", change.object.id).maybeSingle();
      if (error || !data) throw new Error(error?.message ?? "not_found");
      return (data as unknown as Record<string, unknown>)[column] ?? null;
    },
  };
  const registry = createActionRegistry({
    store: createSupabaseChangeSetStore(client, { organizationId: session.organizationId }),
    writer,
  });
  registry.register<ShiftPlan>({
    key: ACTION_KEY,
    label: { en: "Shift a milestone", fr: "Déplacer un jalon" },
    capability: "edit_structure",
    // Projects whose milestones move, and every task that moves.
    targets: (input) => [...new Set([
      ...input.milestones.map((move) => move.projectId).filter((id): id is string => !!id),
      ...input.tasks.map((move) => move.id),
    ])],
    run: async (_context, input) => {
      const { error } = await client.rpc("insight_apply_schedule_shift", {
        p_milestones: input.milestones.map((move) => ({ id: move.id, from: move.from, to: move.to })),
        p_tasks: input.tasks.map((move) => ({
          id: move.id,
          from: move.from,
          to: move.to,
          ...(move.startTo !== move.startFrom ? { startFrom: move.startFrom, startTo: move.startTo } : {}),
        })),
      });
      if (error) throw new Error(error.code ?? error.message);
      return changesOf(input);
    },
  });

  const result = await registry.run(ACTION_KEY, plan, {
    actor: { kind: "person", id: session.userId },
    can: createCan(client),
  });
  if (!result.ok) {
    if (result.reason === "forbidden" || result.message === "42501") back(milestoneId, days, "forbidden");
    if (result.message === "40001") back(milestoneId, days, "stale");
    back(milestoneId, days, "failed");
  }

  // The project activity page hears about each move. Best effort: the dates are saved.
  const writeEvent = createActivityFeedWriter(client);
  const projectOf = new Map(schedule.milestones.map((m) => [m.id, m.projectId]));
  await Promise.allSettled([
    ...plan.milestones.map((move) =>
      writeEvent({
        object: { id: move.id, type: "milestone" },
        organizationId: session.organizationId,
        actor: { kind: "person", id: session.userId },
        verb: "updated",
        changes: [{ property: "due", before: move.from, after: move.to }],
        changeSetId: result.changeSet.id,
        summary: `moved milestone “${move.name}” from ${move.from} to ${move.to}`,
        projectId: projectOf.get(move.id) ?? null,
      }),
    ),
    ...plan.tasks.map((move) =>
      writeEvent({
        object: { id: move.id, type: "task" },
        organizationId: session.organizationId,
        actor: { kind: "person", id: session.userId },
        verb: "updated",
        changes: [{ property: "due", before: move.from, after: move.to }],
        changeSetId: result.changeSet.id,
        summary: `moved “${move.name}” from ${move.from} to ${move.to}`,
        projectId: move.projectId,
      }),
    ),
  ]);
  back(milestoneId, 0, "applied", `&moved=${plan.milestones.length + plan.tasks.length}`);
}
