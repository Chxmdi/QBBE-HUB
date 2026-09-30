import type { ActionDefinition, Change, Uuid } from "@/lib/objects/contracts";
import { invertChanges } from "@/lib/objects/stubs";
import type { ObjectWriter } from "./registry";
import { sameValue } from "./registry";

export const SET_PROPERTY_ACTION = "object.set_property";
export const BULK_EDIT_LIMIT = 500;

export interface SetPropertyInput {
  objectIds: Uuid[];
  /** A system or custom property key, e.g. `status` or `budget_code`. */
  property: string;
  /** Raw column value for a system property; the PropertyValue `value` for a custom one; null clears. */
  value: unknown;
  /** The objects' type key, recorded on each change. */
  objectType: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Validates and de-duplicates the ids; throws on anything unexpected. */
export function bulkEditTargets(input: SetPropertyInput): Uuid[] {
  const ids = [...new Set(input.objectIds)];
  if (ids.length === 0) throw new Error("Choose at least one item.");
  if (ids.length > BULK_EDIT_LIMIT) throw new Error(`Bulk edit is limited to ${BULK_EDIT_LIMIT} items.`);
  if (!ids.every((id) => UUID.test(id))) throw new Error("Invalid item id.");
  return ids;
}

/**
 * Bulk edit: set one property on many objects (M13). Needs edit_content on
 * every one; objects that already hold the value are left out of the change
 * set, so undo restores exactly what changed.
 */
export function createSetPropertyAction(writer: ObjectWriter): ActionDefinition<SetPropertyInput> {
  return {
    key: SET_PROPERTY_ACTION,
    label: { en: "Set property", fr: "Définir la propriété" },
    capability: "edit_content",
    targets: bulkEditTargets,
    async run(context, input) {
      const changes: Change[] = [];
      for (const id of bulkEditTargets(input)) {
        const probe = {
          kind: "update" as const,
          object: { id, type: input.objectType },
          property: input.property,
          before: null,
          after: input.value,
        };
        const before = await writer.read(probe);
        if (sameValue(before, input.value)) continue;
        const change: Change = { ...probe, before };
        try {
          await writer.apply([change], context);
        } catch (error) {
          // All or nothing: put back what this run already changed.
          if (changes.length > 0) await writer.apply(invertChanges(changes), context);
          throw error;
        }
        changes.push(change);
      }
      return changes;
    },
  };
}
