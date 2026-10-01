import type { Identity, ObjectEvent, ObjectEventVerb, PropertyChange } from "@/lib/objects/contracts";
import { objectEventVerbs, type WorkflowTrigger } from "./graph";

/**
 * Which events start a run (M14b), and the event source the runner reads.
 *
 * The runner reads `ObjectEvent`s. They still come from `activity_event`,
 * which is where today's feature code and the feed writer
 * (src/lib/objects/activity-feed.ts) write; `object_event` (M9a) is written
 * by triggers and will replace it here. When the runner moves, only
 * `activityRowToEvent` and the query in the runner change.
 */

export function matchesTrigger(trigger: WorkflowTrigger, event: ObjectEvent): boolean {
  if (trigger.objectTypes.length > 0 && !trigger.objectTypes.includes(event.object.type)) return false;
  if (trigger.verbs.length > 0 && !trigger.verbs.includes(event.verb)) return false;
  if (trigger.changedProperty && !event.changes.some((change) => change.property === trigger.changedProperty)) {
    return false;
  }
  return true;
}

export interface ActivityEventRow {
  id: string;
  organization_id: string;
  actor_id: string | null;
  verb: string;
  source_type: string;
  source_id: string;
  project_id: string | null;
  program_id: string | null;
  summary: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

/** Today's feature code writes verbs the contract does not have; map the common ones. */
const VERB_ALIASES: Record<string, ObjectEventVerb> = {
  completed: "updated",
  status_changed: "updated",
  assigned: "updated",
  health_changed: "updated",
  published: "updated",
  removed: "deleted",
  commented_on: "commented",
};

/** The raw activity verbs that become these contract verbs, for reading events back. */
export function activityVerbsFor(verbs: readonly string[]): string[] {
  const wanted = new Set(verbs);
  const raw = new Set<string>();
  for (const verb of objectEventVerbs) if (wanted.has(verb)) raw.add(verb);
  for (const [alias, verb] of Object.entries(VERB_ALIASES)) if (wanted.has(verb)) raw.add(alias);
  return [...raw];
}

function toVerb(raw: string): ObjectEventVerb | null {
  if ((objectEventVerbs as readonly string[]).includes(raw)) return raw as ObjectEventVerb;
  return VERB_ALIASES[raw] ?? null;
}

function isIdentity(value: unknown): value is Identity {
  if (!value || typeof value !== "object") return false;
  const { kind, id } = value as { kind?: unknown; id?: unknown };
  return (
    typeof id === "string" &&
    (kind === "person" || kind === "team" || kind === "automation" || kind === "integration")
  );
}

function toChanges(raw: unknown): PropertyChange[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is { property: string; before?: unknown; after?: unknown } =>
      Boolean(item) && typeof item === "object" && typeof (item as { property?: unknown }).property === "string")
    .map((item) => ({ property: item.property, before: item.before ?? null, after: item.after ?? null }));
}

/** An activity row as an ObjectEvent, or null for a verb the contract cannot express. */
export function activityRowToEvent(row: ActivityEventRow): ObjectEvent | null {
  const verb = toVerb(row.verb);
  if (!verb) return null;
  const metadata = row.metadata ?? {};
  const actor: Identity = isIdentity(metadata.actor)
    ? metadata.actor
    : row.actor_id
      ? { kind: "person", id: row.actor_id }
      : { kind: "integration", id: "system" };
  const changes = toChanges(metadata.changes);
  // Older writers put a status change in metadata.status / metadata.from.
  if (changes.length === 0 && typeof metadata.status === "string") {
    changes.push({ property: "status", before: metadata.from ?? null, after: metadata.status });
  }
  return {
    id: row.id,
    organizationId: row.organization_id,
    object: { id: row.source_id, type: row.source_type },
    actor,
    verb,
    changes,
    changeSetId: typeof metadata.change_set_id === "string" ? metadata.change_set_id : undefined,
    summary: row.summary,
    projectId: row.project_id,
    programId: row.program_id,
    occurredAt: row.created_at,
  };
}

/**
 * Events caused by a workflow do not start workflows (M14). It is the simplest
 * guard against two workflows triggering each other forever; chaining on
 * purpose is what sub-workflows are for.
 */
export function isAutomationEvent(event: ObjectEvent): boolean {
  return event.actor.kind === "automation";
}
