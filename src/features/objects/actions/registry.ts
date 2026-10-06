import type {
  ActionContext,
  ActionDefinition,
  ActionRegistry,
  ActionResult,
  Change,
  ChangeSet,
  Uuid,
} from "@/lib/objects/contracts";
import { invertChanges } from "@/lib/objects/changes";

/** Where change sets are kept (the change_set tables, or memory in tests). */
export interface ChangeSetStore {
  /** A marker taken before an action runs, so its events can be labelled. */
  begin: () => Promise<number | null>;
  save: (input: {
    actionKey: string;
    changes: Change[];
    context: ActionContext;
    marker: number | null;
    undoOf: Uuid | null;
  }) => Promise<ChangeSet>;
  load: (id: Uuid) => Promise<(ChangeSet & { undoneAt: string | null }) | null>;
}

/** Writes and reads object values, through the caller's own permissions. */
export interface ObjectWriter {
  apply: (changes: Change[], context: ActionContext) => Promise<void>;
  /** The current value of one property, in the same form a Change carries. */
  read: (object: Change & { kind: "update" }) => Promise<unknown>;
  /**
   * Whether a record was edited after `since` (an ISO time). Undo asks this of
   * every record an action created, so it never archives someone's later work.
   * Optional: a writer that cannot tell is trusted, as before.
   */
  changedSince?: (object: { id: Uuid; type: string }, since: string) => Promise<boolean>;
}

export const UNDO_WINDOW_DAYS = 30;

export function touchedObjects(changes: Change[]): Uuid[] {
  return [
    ...new Set(
      changes.flatMap((change) =>
        "object" in change ? [change.object.id] : [change.relation.from.id, change.relation.to.id],
      ),
    ),
  ];
}

/** Stable comparison for JSON-shaped values (key order ignored). */
export function sameValue(a: unknown, b: unknown): boolean {
  const normalize = (value: unknown): unknown => {
    if (value === undefined) return null;
    if (Array.isArray(value)) return value.map(normalize);
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.keys(value as Record<string, unknown>)
          .sort()
          .map((key) => [key, normalize((value as Record<string, unknown>)[key])]),
      );
    }
    return value;
  };
  return JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
}

function failure(error: unknown): ActionResult {
  return { ok: false, reason: "failed", message: error instanceof Error ? error.message : String(error) };
}

/**
 * The persisted action registry (plan A8, M13). Every run checks the action's
 * capability on every target, runs it, and records what it did as a change
 * set. Undo checks the capability again on everything touched, refuses when a
 * value has changed since (and says which), applies the inverse in reverse
 * order and records it with undo_of.
 *
 * An action that changed nothing is a failure ("Nothing changed.") by
 * default, as a bulk edit should be. `onEmpty: "ok"` is for runners whose
 * steps may legitimately change no object (a workflow setting a status the
 * task already has, or sending a notification): the step succeeds and the
 * result carries an empty change set that is not stored, since there is
 * nothing to undo.
 */
export function createActionRegistry(options: {
  store: ChangeSetStore;
  writer: ObjectWriter;
  now?: () => Date;
  onEmpty?: "fail" | "ok";
}): ActionRegistry {
  const actions = new Map<string, ActionDefinition>();
  const now = options.now ?? (() => new Date());

  // An action with no targets has nothing to pre-check: its own run decides
  // (the table's RLS, the SQL function's rule), as for a task created outside
  // any project or an approval request. Bulk edit refuses an empty selection
  // itself, in its targets.
  const allowed = async (ids: Uuid[], capability: ActionDefinition["capability"], context: ActionContext) => {
    for (const id of ids) {
      if (!(await context.can(id, capability))) return false;
    }
    return true;
  };

  return {
    register(action) {
      if (actions.has(action.key)) throw new Error(`Action "${action.key}" is already registered.`);
      actions.set(action.key, action as ActionDefinition);
    },
    get: (key) => actions.get(key),

    async run(key, input, context) {
      const action = actions.get(key);
      if (!action) return { ok: false, reason: "unknown_action" };
      let targets: Uuid[];
      try {
        targets = action.targets(input);
      } catch (error) {
        return failure(error);
      }
      // An action with no targets (creating a record outside any project) has
      // nothing to check here: the table's own row-level security decides the
      // insert, as it does for the form, and record_change_set then requires
      // edit_content on every object the change set names.
      if (targets.length > 0 && !(await allowed(targets, action.capability, context))) {
        return { ok: false, reason: "forbidden" };
      }
      try {
        const marker = await options.store.begin();
        const changes = await action.run(context, input);
        if (changes.length === 0) {
          if (options.onEmpty !== "ok") return { ok: false, reason: "failed", message: "Nothing changed." };
          return {
            ok: true,
            changeSet: {
              id: crypto.randomUUID(),
              actionKey: key,
              actor: context.actor,
              createdAt: now().toISOString(),
              changes: [],
              undoOf: null,
            },
          };
        }
        try {
          const changeSet = await options.store.save({ actionKey: key, changes, context, marker, undoOf: null });
          return { ok: true, changeSet };
        } catch (error) {
          // Without its change set the work could never be undone: put it
          // back rather than leave records nobody can take back. Best effort;
          // the failure is reported either way.
          await options.writer.apply(invertChanges(changes), context).catch(() => {});
          throw error;
        }
      } catch (error) {
        return failure(error);
      }
    },

    async undo(changeSetId, context) {
      const original = await options.store.load(changeSetId);
      const action = original && actions.get(original.actionKey);
      if (!original || !action) return { ok: false, reason: "unknown_action" };
      if (original.undoneAt) return { ok: false, reason: "failed", message: "Already undone." };
      const ageDays = (now().getTime() - new Date(original.createdAt).getTime()) / 86_400_000;
      if (ageDays > UNDO_WINDOW_DAYS) {
        return { ok: false, reason: "failed", message: `Changes older than ${UNDO_WINDOW_DAYS} days cannot be undone.` };
      }
      if (!(await allowed(touchedObjects(original.changes), action.capability, context))) {
        return { ok: false, reason: "forbidden" };
      }

      // Stop rather than overwrite someone's later change.
      const conflicts: string[] = [];
      for (const change of original.changes) {
        if (change.kind !== "update") continue;
        const current = await options.writer.read(change);
        if (!sameValue(current, change.after)) conflicts.push(`${change.object.id}:${change.property}`);
      }
      if (options.writer.changedSince) {
        for (const change of original.changes) {
          if (change.kind !== "create") continue;
          if (await options.writer.changedSince(change.object, original.createdAt)) conflicts.push(change.object.id);
        }
      }
      if (conflicts.length > 0) {
        return { ok: false, reason: "failed", message: `conflict:${conflicts.join(",")}` };
      }

      const inverse = invertChanges(original.changes);
      try {
        const marker = await options.store.begin();
        await options.writer.apply(inverse, context);
        const changeSet = await options.store.save({
          actionKey: original.actionKey,
          changes: inverse,
          context,
          marker,
          undoOf: original.id,
        });
        return { ok: true, changeSet };
      } catch (error) {
        return failure(error);
      }
    },
  };
}
