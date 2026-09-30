/**
 * Workspace OS interface agreement (W0-3, epic #199).
 *
 * The types and function signatures every stream builds against before the
 * real object layer exists. The tables behind them are described in
 * docs/design/workspace-os-object-layer.md; the stand-ins that answer with
 * today's behaviour are in ./stubs.ts.
 *
 * Changing anything exported here after W0-3 merges needs a note in the change
 * that does it (workspace-os-execution.md, section 3, rule 3).
 */

export type Uuid = string;

/** English and Quebec French text for anything shown to people. */
export interface LocalizedText {
  en: string;
  fr: string;
}

// ---------------------------------------------------------------------------
// Object registry (plan A1, A2)
// ---------------------------------------------------------------------------

/** Types backed by an existing table. Their `object.id` is that row's id. */
export const nativeObjectTypeKeys = [
  "task",
  "project",
  "meeting",
  "decision",
  "risk",
  "outcome_metric",
  "person",
  "team",
  "event",
  "contact",
  "document",
] as const;
export type NativeObjectTypeKey = (typeof nativeObjectTypeKeys)[number];

/** A native key, `page`, or a custom type's key (lower snake case). */
export type ObjectTypeKey = NativeObjectTypeKey | "page" | (string & {});

export interface ObjectRef {
  id: Uuid;
  type: ObjectTypeKey;
}

export interface ObjectType {
  id: Uuid;
  key: ObjectTypeKey;
  name: LocalizedText;
  icon: string | null;
  /** Native types keep their data in `nativeTable`; custom types in property_value. */
  kind: "native" | "custom";
  nativeTable: string | null;
  defaultLens: LensKind;
  defaultTemplateId: Uuid | null;
}

/** One row of the `object` table. */
export interface ObjectRecord extends ObjectRef {
  organizationId: Uuid;
  spaceId: Uuid | null;
  parentObjectId: Uuid | null;
  title: string;
  icon: string | null;
  cover: string | null;
  ownerId: Uuid | null;
  createdBy: Uuid | null;
  createdAt: string;
  updatedBy: Uuid | null;
  updatedAt: string;
  archivedAt: string | null;
  deletedAt: string | null;
}

export const propertyKinds = [
  "text",
  "number",
  "currency",
  "date",
  "date_range",
  "duration",
  "status",
  "select",
  "multi_select",
  "person",
  "relation",
  "formula",
  "location",
  "progress",
  "rating",
  "file",
  "url",
  "email",
  "phone",
  "checkbox",
  "created_by",
  "created_time",
  "edited_by",
  "edited_time",
  "rollup",
] as const;
export type PropertyKind = (typeof propertyKinds)[number];

export interface SelectOption {
  key: string;
  label: LocalizedText;
  color: string | null;
}

export interface PropertyDefinition {
  id: Uuid;
  typeId: Uuid;
  /** Stable key used in query specs, e.g. `status` or `due`. */
  key: string;
  name: LocalizedText;
  kind: PropertyKind;
  /** Kind-specific settings: select options, currency code, relation type and so on. */
  options: {
    choices?: SelectOption[];
    currency?: string;
    relationTypeKey?: string;
    [setting: string]: unknown;
  };
  /**
   * A system property is stored in its native column (`task.due_at`) instead
   * of property_value. Reads and writes go through the same interface.
   */
  systemColumn: string | null;
  /** Property-level privacy (plan A2, brief section 33). Null means no restriction. */
  visibleToRoles: string[] | null;
  position: number;
}

/** A value as the application sees it, whichever table it is stored in. */
export type PropertyValue =
  | { kind: "text" | "url" | "email" | "phone" | "status" | "select"; value: string }
  | { kind: "number" | "currency" | "duration" | "progress" | "rating"; value: number }
  | { kind: "checkbox"; value: boolean }
  | { kind: "date" | "created_time" | "edited_time"; value: string }
  | { kind: "date_range"; value: { start: string; end: string | null } }
  | { kind: "multi_select"; value: string[] }
  | { kind: "person" | "created_by" | "edited_by"; value: Uuid[] }
  | { kind: "relation"; value: ObjectRef[] }
  | { kind: "file"; value: Uuid[] }
  | { kind: "location"; value: { lat: number; lng: number; label: string | null } }
  | { kind: "formula" | "rollup"; value: string | number | boolean | null };

// ---------------------------------------------------------------------------
// Relations (plan A3)
// ---------------------------------------------------------------------------

export type RelationCardinality = "one_to_one" | "one_to_many" | "many_to_many";

export interface RelationType {
  id: Uuid;
  /** e.g. `contains`, `blocks`, `supports`, `originated_from`. */
  key: string;
  name: LocalizedText;
  reverseName: LocalizedText;
  cardinality: RelationCardinality;
}

export interface Relation {
  /** Null for a relation read from a native link, which has no row of its own. */
  id: Uuid | null;
  relationTypeKey: string;
  from: ObjectRef;
  to: ObjectRef;
  /** Where the link is stored: object_relation, or the native link it mirrors. */
  source: "object_relation" | "task_project" | "task_dependency" | "crm_link";
}

// ---------------------------------------------------------------------------
// Access (plan A6)
// ---------------------------------------------------------------------------

export const workspaceCapabilities = [
  "view",
  "comment",
  "edit_content",
  "edit_structure",
  "manage",
  "run_workflow",
  "share",
] as const;
export type WorkspaceCapability = (typeof workspaceCapabilities)[number];

/**
 * The one access question. Same answer as SQL `app.can(object_id, capability)`;
 * a signed-out caller, an unknown object or an error is always false.
 */
export type Can = (objectId: Uuid, capability: WorkspaceCapability) => Promise<boolean>;

/** Who did something. Every event and change set names one (plan A6). */
export type Identity =
  | { kind: "person"; id: Uuid }
  | { kind: "team"; id: Uuid }
  | { kind: "automation"; id: Uuid }
  | { kind: "integration"; id: string };

// ---------------------------------------------------------------------------
// Query spec (plan A7). Stored as JSON in lenses; run under the viewer's RLS.
// ---------------------------------------------------------------------------

export type LensKind =
  | "document"
  | "table"
  | "board"
  | "list"
  | "calendar"
  | "timeline"
  | "gallery"
  | "feed"
  | "dashboard"
  | "graph"
  | "map";

/** Resolved when the query runs, in the organization's time zone. */
export type RelativeValue =
  | { relative: "me" }
  | { relative: "today" }
  | { relative: "this_week" }
  | { relative: "days_from_today"; days: number };

export type FilterScalar = string | number | boolean | null;
export type FilterValue = FilterScalar | FilterScalar[] | RelativeValue;

export type FilterOperator =
  | "eq"
  | "neq"
  | "lt"
  | "lte"
  | "gt"
  | "gte"
  | "in"
  | "contains"
  | "is_empty"
  | "is_not_empty";

/**
 * A property of the queried object, or of an object reached through relations:
 * `{ via: ["project"], property: "status" }` is "the task's project's status".
 */
export type PropertyPath = string | { via: string[]; property: string };

export interface PropertyFilter {
  property: PropertyPath;
  op: FilterOperator;
  /** Omitted for is_empty / is_not_empty. */
  value?: FilterValue;
}

export type FilterNode = PropertyFilter | { and: FilterNode[] } | { or: FilterNode[] };

export interface QuerySort {
  property: PropertyPath;
  direction: "asc" | "desc";
}

export interface QuerySpec {
  version: 1;
  types: ObjectTypeKey[];
  /** Limit to objects in these spaces, or under this parent. */
  spaceIds?: Uuid[];
  parentObjectId?: Uuid;
  filter?: FilterNode;
  sorts?: QuerySort[];
  groupBy?: PropertyPath;
  /** Properties to return; the title is always returned. */
  properties?: string[];
  limit?: number;
  cursor?: string;
}

export interface QueryRow {
  ref: ObjectRef;
  title: string;
  values: Record<string, PropertyValue | null>;
}

export interface QueryResult {
  rows: QueryRow[];
  /** Present when the spec has `groupBy`: group key to row ids, in row order. */
  groups?: { key: string | null; rowIds: Uuid[] }[];
  nextCursor: string | null;
}

export type RunQuery = (spec: QuerySpec) => Promise<QueryResult>;

// ---------------------------------------------------------------------------
// Actions and undo (plan A8)
// ---------------------------------------------------------------------------

export type Change =
  | { kind: "create"; object: ObjectRef; values: Record<string, unknown> }
  | { kind: "delete"; object: ObjectRef; values: Record<string, unknown> }
  | { kind: "update"; object: ObjectRef; property: string; before: unknown; after: unknown }
  | { kind: "link"; relation: Omit<Relation, "id" | "source"> }
  | { kind: "unlink"; relation: Omit<Relation, "id" | "source"> };

/** What one action did, in the order it did it. Undo replays it in reverse. */
export interface ChangeSet {
  id: Uuid;
  actionKey: string;
  actor: Identity;
  createdAt: string;
  changes: Change[];
  /** Set on the change set an undo produced. */
  undoOf: Uuid | null;
}

export interface ActionContext {
  actor: Identity;
  can: Can;
}

export interface ActionDefinition<Input = unknown> {
  /** e.g. `task.assign`, `object.archive`. */
  key: string;
  label: LocalizedText;
  /** Checked on every target before `run`. */
  capability: WorkspaceCapability;
  targets: (input: Input) => Uuid[];
  run: (context: ActionContext, input: Input) => Promise<Change[]>;
}

export type ActionResult =
  | { ok: true; changeSet: ChangeSet }
  | { ok: false; reason: "unknown_action" | "forbidden" | "failed"; message?: string };

export interface ActionRegistry {
  register: <Input>(action: ActionDefinition<Input>) => void;
  get: (key: string) => ActionDefinition | undefined;
  run: (key: string, input: unknown, context: ActionContext) => Promise<ActionResult>;
  /** Applies the inverse of a change set and returns the new change set. */
  undo: (changeSetId: Uuid, context: ActionContext) => Promise<ActionResult>;
}

// ---------------------------------------------------------------------------
// Events (plan A5)
// ---------------------------------------------------------------------------

export type ObjectEventVerb =
  | "created"
  | "updated"
  | "archived"
  | "restored"
  | "deleted"
  | "linked"
  | "unlinked"
  | "commented";

export interface PropertyChange {
  property: string;
  before: unknown;
  after: unknown;
}

export interface ObjectEventInput {
  object: ObjectRef;
  organizationId: Uuid;
  actor: Identity;
  verb: ObjectEventVerb;
  changes: PropertyChange[];
  changeSetId?: Uuid;
  /** One line for the activity feed until it reads object_event directly (M9b). */
  summary: string;
  projectId?: Uuid | null;
  programId?: Uuid | null;
}

export interface ObjectEvent extends ObjectEventInput {
  id: Uuid;
  occurredAt: string;
}

/**
 * Database triggers write events for every change to a native table (M9a), so
 * application code calls this only for what a trigger cannot see: an
 * automation or integration acting, or an action grouping several changes.
 */
export type WriteObjectEvent = (event: ObjectEventInput) => Promise<void>;
