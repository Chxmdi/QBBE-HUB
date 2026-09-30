import type {
  FilterNode,
  ObjectTypeKey,
  PropertyPath,
  QueryResult,
  QuerySpec,
  RunQuery,
} from "@/lib/objects/contracts";

/**
 * Property-level privacy for anything that reads properties (M10e, epic #199).
 *
 * The database already removes a private property's stored values from people
 * who may not see it (S1's property_value policy). A query can still *use* a
 * hidden property without returning it: filtering, sorting or grouping by it
 * would reveal its values row by row. So before a query runs, ask the
 * database which keys the caller may not see (`hidden_property_keys`), refuse
 * a spec that filters, sorts or groups by one, and drop hidden keys from what
 * comes back.
 *
 * It fails closed: if the hidden keys cannot be read, the query does not run.
 */

export class HiddenPropertyError extends Error {
  constructor(readonly property: string) {
    super(`The property "${property}" is not visible to you, so it cannot be used to filter, sort or group.`);
    this.name = "HiddenPropertyError";
  }
}

export class PropertyPrivacyUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PropertyPrivacyUnavailableError";
  }
}

/** The property key a path ends on: `status`, or `{ via: ["project"], property: "status" }` → `status`. */
export function pathKey(path: PropertyPath): string {
  return typeof path === "string" ? path : path.property;
}

function filterKeys(node: FilterNode | undefined, into: Set<string>): Set<string> {
  if (!node) return into;
  if ("and" in node) node.and.forEach((child) => filterKeys(child, into));
  else if ("or" in node) node.or.forEach((child) => filterKeys(child, into));
  else into.add(pathKey(node.property));
  return into;
}

/** Every property key a spec filters, sorts or groups by. */
export function keysUsedToSelect(spec: QuerySpec): Set<string> {
  const keys = filterKeys(spec.filter, new Set<string>());
  for (const sort of spec.sorts ?? []) keys.add(pathKey(sort.property));
  if (spec.groupBy !== undefined) keys.add(pathKey(spec.groupBy));
  return keys;
}

/**
 * Refuses a spec that selects by a hidden property, and asks only for the
 * visible ones. Paths through relations are checked by their final key
 * against every hidden key the caller has: a key hidden on any type involved
 * is treated as hidden, which can only refuse too much, never too little.
 */
export function applyPrivacyToSpec(spec: QuerySpec, hidden: ReadonlySet<string>): QuerySpec {
  for (const key of keysUsedToSelect(spec)) {
    if (hidden.has(key)) throw new HiddenPropertyError(key);
  }
  if (!spec.properties || !spec.properties.some((key) => hidden.has(key))) return spec;
  return { ...spec, properties: spec.properties.filter((key) => !hidden.has(key)) };
}

/** Removes hidden keys from every row. The title is never a hidden property. */
export function dropHiddenValues(result: QueryResult, hidden: ReadonlySet<string>): QueryResult {
  if (hidden.size === 0) return result;
  return {
    ...result,
    rows: result.rows.map((row) => ({
      ...row,
      values: Object.fromEntries(Object.entries(row.values).filter(([key]) => !hidden.has(key))),
    })),
  };
}

export type LoadHiddenKeys = (types: ObjectTypeKey[]) => Promise<ReadonlySet<string>>;

/** Wraps a query runner so no hidden property is used or returned. */
export function withPropertyPrivacy(run: RunQuery, loadHidden: LoadHiddenKeys): RunQuery {
  return async (spec) => {
    const hidden = await loadHidden(spec.types);
    const result = await run(applyPrivacyToSpec(spec, hidden));
    return dropHiddenValues(result, hidden);
  };
}

interface RpcClient {
  rpc: (fn: "hidden_property_keys", args: { type_key: string }) => PromiseLike<{ data: unknown; error: unknown }>;
}

/** Reads the hidden keys for each type through the caller's session. */
export function hiddenKeysFromDatabase(client: RpcClient): LoadHiddenKeys {
  return async (types) => {
    const hidden = new Set<string>();
    const answers = await Promise.all(
      [...new Set(types)].map((type) => client.rpc("hidden_property_keys", { type_key: type })),
    );
    for (const { data, error } of answers) {
      if (error || !Array.isArray(data)) {
        throw new PropertyPrivacyUnavailableError("Could not check which properties are private; the query was not run.");
      }
      for (const key of data) if (typeof key === "string") hidden.add(key);
    }
    return hidden;
  };
}
