import type {
  ActionContext,
  ActionDefinition,
  ActionRegistry,
  ActionResult,
  Change,
  ChangeSet,
  Uuid,
} from "@/lib/objects/contracts";
import { invertChanges } from "@/lib/objects/stubs";

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
 * The persisted action registry (plan A8, replaces createActionRegistryStub).
 * Every run checks the action's capability on every target, runs it, and
 * records what it did as a change set. Undo checks the capability again on
 * everything touched, refuses when a value has changed since (and says which),
 * applies the inverse in reverse order and records it with undo_of.
 */
export function createActionRegistry(options: {
  store: ChangeSetStore;
  writer: ObjectWriter;
  now?: () => Date;
}): ActionRegistry {
  const actions = new Map<string, ActionDefinition>();
  const now = options.now ?? (() => new Date());

  const allowed = async (ids: Uuid[], capability: ActionDefinition["capability"], context: ActionContext) => {
    if (ids.length === 0) return false;
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
      if (!(await allowed(targets, action.capability, context))) return { ok: false, reason: "forbidden" };
      try {
        const marker = await options.store.begin();
        const changes = await action.run(context, input);
        if (changes.length === 0) return { ok: false, reason: "failed", message: "Nothing changed." };
        const changeSet = await options.store.save({ actionKey: key, changes, context, marker, undoOf: null });
        return { ok: true, changeSet };
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
