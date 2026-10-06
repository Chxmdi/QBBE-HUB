# Workspace OS object layer: design note

Written 2026-09-30 against `main` at `58b7982` for epic #199 (item W0-9, the
plan's P0-5). It turns sections A1–A3, A5, A6 and A8 of
[workspace-os-plan.md](../plans/workspace-os-plan.md) into exact tables,
columns, indexes, constraints and security rules, grounded in the schema that
exists today. It must be reviewed before M1 starts.

What is already built for Wave 0, in the same change as this note:
- `src/lib/objects/contracts.ts`: the TypeScript interface every stream codes against.
- `src/lib/objects/stubs.ts`: stand-ins that answer with today's behaviour.
- `app.can` / `public.can` (migration `20261101000200`): the access check, for tasks and projects.
- The feature switches (`20261101000100`) and `isEnabled` in `src/lib/feature-flags.ts`.

## Terms used here

- **RLS (row-level security):** rules in the database that decide which rows each signed-in person can read or change. Every table here has it.
- **Native type:** a kind of object whose data already lives in its own table (`task`, `project` and so on).
- **Security definer function:** a database function that runs with its owner's rights instead of the caller's, so it can look at rows the caller can't see in order to answer a yes/no question. Every one here fixes `search_path = ''` so it cannot be tricked into calling a look-alike function.
- **Backfill:** copying rows that already exist into a new table when the table is created.
- **AAL2:** "authenticator assurance level 2", meaning the person signed in with a second step (an authenticator code). Owners and admins need it for anything but reading.
- **Trigger:** a database function that runs automatically when a row is inserted, updated or deleted.

## 1. Rules taken from the existing schema

These patterns are already enforced by the test suite, so the new tables follow them.

1. **Every row carries `organization_id`** and every policy checks membership of *that* organization. `supabase/tests/rls.sql` fails any policy that uses the "member of any organization" helpers (`app.is_member()`, `app.is_staff()`, `app.is_admin()`).
2. **Access helpers live in `app`, callers use `public` wrappers.** `app.has_task_capability` is reached through `public.has_task_capability`; the `app` schema is not open to signed-in users. `app.can` follows the same split.
3. **Owners and admins need AAL2 for anything but read**, inside the existing predicates. New code inherits this by delegating to them rather than repeating it.
4. **Deactivated members lose access at once**, because every predicate joins `organization_membership` with `status = 'active'`.
5. **Record capabilities today are** `read`, `manage`, `collaborate`, `review`, `approve`, `follow` (`src/lib/access-capabilities.ts`), granted by organization role, program and project grants (`program_access_grant`, `project_access_grant`), and task roles (`task_assignment`, the actor columns on `task`).
6. **Migrations only add** until a full release proves an old column unused (plan section 2, rule 3).

## 2. Migration timestamp ranges

Each stream names its migrations inside its own range, so two streams never
produce the same file name or an ordering fight (execution plan, section 2).

| Stream | Owns | Migration timestamps |
|---|---|---|
| S1 Core | Registry, types, properties, relations, events, actions and undo | `2026110100xxxx` |
| S2 Access | Spaces, permissions, `app.can`, sharing, custom roles, public pages | `2026110200xxxx` |
| S3 Editor | Pages, blocks, co-editing, versions | `2026110300xxxx` |
| S4 Lenses | Query engine and lenses | `2026110400xxxx` |
| S5 Work | Tasks, projects, meetings, decisions, goals, Home, capture | `2026110500xxxx` |
| S6 Flow | Workflows, forms, templates, notifications, integrations | `2026110600xxxx` |

Already used by S1: `20261101000100` (switches), `20261101000200` (`app.can`
stand-in), `20261101000300` (switch rows locked, see section 9).

## 3. A1 Object registry

### `object_type`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid, primary key | |
| `organization_id` | uuid, not null, references `organization` | Native types get one row per organization. |
| `key` | text, not null | `task`, `project`, `page`, or a custom key. Lower snake case, checked. |
| `name_en`, `name_fr` | text, not null | Both languages required. |
| `icon` | text | |
| `kind` | text, not null | `native` or `custom`, checked. |
| `native_table` | text | Required when `kind = 'native'`, null otherwise (check constraint). |
| `default_lens` | text, not null, default `document` | One of the lens kinds in `contracts.ts`. |
| `default_template_id` | uuid | Templates arrive in V1-13; no foreign key until then. |
| `created_at`, `updated_at`, `archived_at` | timestamptz | |

Unique `(organization_id, key)`. RLS: members read their organization's types
(`app.is_org_member(organization_id)`); only `app.is_org_admin` writes custom
types; native rows are written by migrations only (the write policy excludes
`kind = 'native'`).

### `object`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid, primary key | **The same id as the native row** (a task's object id is the task id). Custom objects get a new id. |
| `organization_id` | uuid, not null | |
| `type_id` | uuid, not null, references `object_type` | Composite foreign key `(type_id, organization_id)` so an object cannot use another organization's type. |
| `space_id` | uuid | References `space` once M10a lands. |
| `parent_object_id` | uuid, references `object` on delete set null | Nesting. A trigger rejects cycles and cross-organization parents. |
| `title` | text, not null, default `''` | Copied from the native title column. |
| `icon`, `cover` | text | |
| `owner_id` | uuid, references `user_profile` | |
| `created_by`, `updated_by` | uuid, references `user_profile` | |
| `created_at`, `updated_at` | timestamptz, not null | |
| `archived_at`, `deleted_at` | timestamptz | `deleted_at` is the 30-day trash (M16a). |
| `search_vector` | tsvector | Built with the existing French-aware configuration used by document search (`20261001100000`). |

Indexes: `(organization_id, type_id, updated_at desc)`, `(parent_object_id)`,
`(space_id)`, GIN on `search_vector`, and a partial index on
`(organization_id) where deleted_at is null`.

RLS: `select using (public.can(id, 'view'))`; no insert, update or delete
policy for native types (their triggers write with definer rights); custom
objects insert with `public.can_create_in_space(space_id)` (S2) and update with
`public.can(id, 'edit_content')`.

### Keeping native rows in sync

One trigger function, `app.sync_object_from_native()`, is attached `after
insert or update or delete` on each native table. It reads a small mapping
table, `app.native_object_map`, so a new native type needs a row there and a
trigger, not new code:

| Native table | Type key | Title from | Owner from | Parent from | Archived from |
|---|---|---|---|---|---|
| `task` | `task` | `title` | `assignee_id` | `project_id`, else `program_id` space | `archived_at` |
| `project` | `project` | `name` | `owner_id` | none (space = program) | `archived_at` |
| `meeting` | `meeting` | `title` | `organizer_id` | `project_id` | `status = 'cancelled'` |
| `decision` | `decision` | `title` | `decided_by` | `meeting_id`, else `project_id` | `reopened_at` is informational only |
| `risk` | `risk` | `title` | `owner_id` | `project_id` | `closed_at` |
| `outcome_metric` | `outcome_metric` | `name` | `owner_id` | none (space = program) | `retired_at` |
| `user_profile` | `person` | `full_name` | itself | none | membership `status` |
| `team` | `team` | `name` | `owner_id` | none | none |
| `event` | `event` | `name` | `owner_id` | `project_id` | `status` |
| `crm_contact` | `contact` | `full_name` | `owner_id` | none | `status` |
| `document` | `document` | `title` | `owner_id` | `project_id`, else `meeting_id` | `archived_at` |

Two special cases:
- **People.** `user_profile` has no `organization_id`, so the person object is written from `organization_membership` (insert, status change) with the profile's id. QBBE has one organization, so one object per person is enough; a person in two organizations would need a second id, and that is out of scope (plan section 6).
- **Contacts.** Only `crm_contact` itself is registered. Sensitive notes stay in their isolated table (`20260926040000`) and are never copied into `object`, `property_value` or `object_event`.

**Backfill:** each M1 migration inserts `object` rows for existing records with
`insert … select … on conflict (id) do nothing`, in the same migration as the
trigger, so there is no window where a row is missing. **Test:** for every
native table, `count(*)` equals the count of its objects, and stays equal after
an insert and a delete (M1b, M1c).

## 4. A2 Types and properties

### `property_definition`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid, primary key | |
| `organization_id` | uuid, not null | |
| `type_id` | uuid, not null | Composite foreign key with `organization_id`. |
| `key` | text, not null | Stable key used in query specs. Unique per type. |
| `name_en`, `name_fr` | text, not null | |
| `kind` | text, not null | One of `propertyKinds` in `contracts.ts` (check constraint). |
| `options` | jsonb, not null, default `{}` | Choices, currency, relation type, rollup definition. |
| `system_column` | text | Set for system properties: the native column that stores the value. |
| `visible_to_roles` | `org_role[]` | Property-level privacy. Null means everyone who can view the object. |
| `position` | integer, not null | |
| `created_at`, `updated_at`, `archived_at` | timestamptz | |

A check constraint makes `system_column` legal only on a native type. System
properties are inserted by the M2a migration, never by users.

**System properties for tasks** (the list in `taskSystemProperties`, `stubs.ts`):
title, status, priority, assignee, requester, reviewer, start, due, estimate,
project, program, completed time, created by, created time, edited time. Each
reads and writes its column (for example `due` is `task.due_at`, a calendar
date). Writes go through the native table, so existing triggers
(`enforce_scoped_task_update`, `task_material_audited`) keep running.

### `property_value` (custom properties only)

| Column | Type | Notes |
|---|---|---|
| `object_id` | uuid, not null, references `object` on delete cascade | |
| `property_id` | uuid, not null, references `property_definition` on delete cascade | |
| `organization_id` | uuid, not null | Must match the object's (trigger). |
| `value_text` | text | text, URL, email, phone, select, status |
| `value_number` | numeric | number, currency, duration, progress, rating |
| `value_date` | date | date; start of a date range |
| `value_date_end` | date | end of a date range |
| `value_bool` | boolean | checkbox |
| `value_uuids` | uuid[] | person, file, multi-select option ids |
| `value_json` | jsonb | location and anything without a typed column |
| `updated_by`, `updated_at` | | |

Primary key `(object_id, property_id)`. A check constraint allows exactly the
columns that match the property's kind (enforced by a trigger that reads the
definition, since a check cannot look at another table). Relation values are
**not** stored here; they are rows in `object_relation`.

Indexes so filters stay fast: `(property_id, value_text)`,
`(property_id, value_number)`, `(property_id, value_date)`, GIN on
`value_uuids`, all with `object_id` included.

### Property-level privacy

- **Custom properties:** `property_value` RLS is `public.can(object_id, 'view') and app.can_view_property(property_id)`. The second helper returns true when `visible_to_roles` is null or the caller's active role in the property's organization is in the list. Hidden values are simply absent, including from lenses, search and events.
- **System properties:** a native column cannot be hidden by the new layer, because the native table's own RLS already lets readers select it. So `visible_to_roles` is only allowed on a system property whose column is already protected at the native layer; the M2a migration's check constraint refuses it otherwise. Sensitive native data keeps using the existing pattern of a separate table.
- **Test (M10e):** for each role, a private value is absent from `property_value`, from `object_event` changes and from the query engine's output.

## 5. A3 Relations

### `relation_type`

`id`, `organization_id`, `key` (unique per organization), `name_en`,
`name_fr`, `reverse_name_en`, `reverse_name_fr`, `cardinality`
(`one_to_one`, `one_to_many`, `many_to_many`), `from_type_id` and `to_type_id`
(null means any type), `is_native` (true for the types that mirror existing
links; those cannot be written through `object_relation`). Seeded:
`contains`, `blocks`, `supports`, `originated_from`, `related_to`,
`decided_in`, `applies_for`, `owns`.

### `object_relation`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid, primary key | |
| `organization_id` | uuid, not null | Both ends must be in it (trigger). |
| `from_id`, `to_id` | uuid, not null, reference `object` on delete cascade | |
| `relation_type_id` | uuid, not null | Must not be `is_native`. |
| `position` | double precision | Order within a list. |
| `created_by`, `created_at` | | |

Unique `(from_id, relation_type_id, to_id)`; check `from_id <> to_id`;
indexes `(from_id, relation_type_id)` and `(to_id, relation_type_id)`.
Cardinality is enforced by a trigger. RLS: read needs `public.can(from_id,
'view') and public.can(to_id, 'view')` (the same rule `task_dependency_read`
uses today); write needs `edit_content` on both ends.

### Existing links exposed as relations

View `public.object_relation_all`, created `with (security_invoker = true)` so
each branch is filtered by its own table's RLS and no data is duplicated:

| Relation | From | To | Source |
|---|---|---|---|
| `contains` | project | task | `task.project_id` |
| `blocks` | task (blocking) | task (blocked) | `task_dependency` |
| `blocks` | task | task | `task.blocked_by_id` |
| `related_to` | contact | task, project, event, program | `crm_link` (one row per non-null target column) |
| `decided_in` | decision | meeting | `decision.meeting_id` |
| `contains` | project | risk, meeting, event, document, decision | their `project_id` |
| everything else | | | `object_relation` |

`Relation.source` in `contracts.ts` names which one a row came from. Changing a
native relation goes through the native table (for example, moving a task to
another project updates `task.project_id`).

**Rollups (V1-7)** are a property kind whose value is cached in
`property_value.value_number`, refreshed by a trigger on the related rows.

## 6. A5 Events

### `object_event`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid, primary key | |
| `seq` | bigint, generated always as identity | Total order for consumers. |
| `organization_id` | uuid, not null | |
| `object_id` | uuid, not null | No foreign key, so events outlive a deleted object (history and audit). |
| `object_type` | text, not null | |
| `actor_kind` | text, not null | `person`, `team`, `automation`, `integration`, `system` |
| `actor_id` | text | Person id, workflow id, or integration name. |
| `verb` | text, not null | `created`, `updated`, `archived`, `restored`, `deleted`, `linked`, `unlinked`, `commented` |
| `changes` | jsonb, not null, default `[]` | `[{property, before, after}]`, system property keys, not column names. |
| `change_set_id` | uuid | Set when an action made the change. |
| `occurred_at` | timestamptz, not null, default `now()` | |

Indexes: `(object_id, occurred_at desc)`, `(organization_id, seq)`,
`(change_set_id)`.

**Written by triggers, never by the app.** `app.write_object_event()` is
attached with the sync trigger on every native table and on `object`,
`property_value` and `object_relation`. It compares `to_jsonb(old)` with
`to_jsonb(new)` for the registered system columns only, so noise columns
(`sort_key`, `search_text`) do not create events. The actor is `auth.uid()`
unless the session sets `app.actor` (`set_config('app.actor', …, true)`):
the workflow runner and integrations do that so their changes are labelled
automation or integration, not the person who configured them.
`app.change_set_id` is set the same way by the action layer.

**RLS:** read needs `public.can(object_id, 'view')`; changes to a private
property are removed from `changes` for readers who cannot see it (a
security-invoker view, `object_event_visible`, does the removal). Nobody
inserts, updates or deletes through the API.

**Outbox:** consumers keep their own position in `object_event_cursor
(consumer text primary key, last_seq bigint, updated_at)`. The job runner
(`/api/jobs`) reads events after `last_seq` in batches and advances it in the
same transaction as its work, so a crash re-reads rather than skips. Consumers:
workflows (M14b), notifications, attention (M17c) and the change digest (M17d).

**How the existing readers move over (M9b):**
- **Activity feed** (`activity_event`, read by project and program pages): a view `activity_feed` unions `object_event` (rendered to the same `verb`/`summary` shape) with `activity_event` rows written before the cut-over. Code that inserts into `activity_event` today (for example `milestone.commands.ts`) stops once its table has a trigger. Until then the feed writer (`createActivityFeedWriter`, `src/lib/objects/activity-feed.ts`) writes to `activity_event`.
- **Audit log** (`audit_event`, admin only): stays the record for security events (sign-in, role and grant changes, exports). Record changes that `task_material_audited` and `project_health_audited` write today are compared against `object_event` in a test before those triggers are retired.
- **Notifications** (`notification`): produced by the notifications consumer from the outbox instead of per-feature code, with the same `dedupe_key` rules.
- **Retention (#146):** `object_event` is a record category; legal hold blocks its deletion as it does for `activity_event` today.

## 7. A6 Spaces, grants and the access check

Owned by S2; the shape is fixed here so S1 and S4 can rely on it.

### Tables

- **`space`:** `id`, `organization_id`, `kind` (`workspace`, `program`, `private`, `custom`), `program_id` (unique, set when `kind = 'program'`), `owner_id` (set when `kind = 'private'`), `name_en`, `name_fr`, `icon`, `archived_at`. One `workspace` space per organization, one `private` space per member, one `program` space per program.
- **`role_definition`:** custom roles (M10d): `id`, `organization_id`, `key`, names, `capabilities text[]` (checked against the list below).
- **`access_grant`:** `id`, `organization_id`, `scope` (`space` or `object`), `space_id` or `object_id` (check: exactly one), `grantee_kind` (`person`, `team`, `org_role`), `grantee_id` or `org_role`, `role_definition_id` or `capabilities text[]`, `created_by`, `created_at`. Program spaces do **not** copy `program_access_grant`; they read it through, so there is one source of truth.
- **`object_access`** (the cache): `user_id`, `object_id`, `organization_id`, `capabilities text[]`, `computed_at`, primary key `(user_id, object_id)`. Not readable through the API.

**Capabilities:** `view`, `comment`, `edit_content`, `edit_structure`,
`manage`, `run_workflow`, `share` (`workspaceCapabilities` in `contracts.ts`).
Inheritance: workspace, then space, then object, then property.

### `app.can(object_id uuid, capability text) returns boolean`

Security definer, `search_path = ''`, called through `public.can`.

1. **Native types delegate to their existing rule first**, so nothing becomes more open than today. The capability map (already live in the stand-in):

   | Workspace OS | Existing record capability |
   |---|---|
   | view | read |
   | comment | manage, collaborate, review or approve (as `task_comment_insert`) |
   | edit_content | manage or collaborate |
   | edit_structure, manage, share, run_workflow | manage |

   | Type | Existing rule |
   |---|---|
   | task | `app.has_task_capability` |
   | project | `app.has_project_capability` |
   | meeting | `app.can_read_meeting` / `app.can_manage_meeting` |
   | decision | `decision_read` / `decision_scoped_write` expressions, as a helper |
   | risk | `app.can_read_project` / `app.can_manage_project` on its project |
   | event | `app.can_read_event` / `app.can_manage_event` |
   | document | `app.can_read_document` / `app.can_manage_document` |
   | person | `app.can_read_profile` (view only) |
   | team | `app.can_read_team` / `app.can_manage_team` |
   | contact | `app.can_access_crm`, or owner |
   | outcome_metric | `app.is_org_member` read, `app.is_org_staff` manage |

2. **Other objects** (pages, custom types) use grants: the object's own grants, then its parent chain, then its space, then the workspace.
3. **The cache.** `app.can` reads `object_access` first and computes on a miss. Rows are deleted (not recomputed) by triggers on anything that can change an answer: `organization_membership`, `program_access_grant`, `project_access_grant`, `task_assignment`, the actor columns on `task`, `access_grant`, `team_member`, and `object.space_id` / `parent_object_id`. Deleting is cheap and always correct; the next check recomputes. A nightly job drops rows older than a day as a safety net.
4. **Equivalence test (M10c):** for every seeded person, at AAL1 and AAL2, on every native record, `public.can` equals the old rule. The stand-in already has this test for tasks and projects (`supabase/tests/workspace-os-can.sql`, every fixture person at both levels).

**Today's stand-in** (`20261101000200`) knows tasks and projects only and
denies everything else, including programs, until the registry lands.

## 8. A8 Actions and change sets

The **registry lives in code** (`ActionRegistry` in `contracts.ts`): each
action declares its key, bilingual label, required capability and targets.
The registry checks `can` on every target before running. The command palette,
buttons, bulk edit and workflows all run actions, never tables directly.

### `change_set`

`id`, `organization_id`, `action_key`, `actor_kind`, `actor_id`,
`created_at`, `undo_of` (references `change_set`), `undone_at`. Index
`(organization_id, created_at desc)`.

### `change_set_item`

`change_set_id` (on delete cascade), `position`, `kind` (`create`, `delete`,
`update`, `link`, `unlink`), `object_id`, `object_type`, `property`,
`before jsonb`, `after jsonb`, `relation_type_id`, `to_id`. Primary key
`(change_set_id, position)`.

RLS on both: the actor reads their own; readers of every touched object read
the rest. Only the server's action path writes (security definer function
`app.record_change_set`).

**Undo** (`invertChanges` in `src/lib/objects/changes.ts` is the reference): read the change set,
check the action's capability on every touched object again, check each
`update` still has its `after` value (if someone changed it since, stop and
show what differs rather than overwrite), apply the inverse in reverse order
through the same actions, and write a new change set with `undo_of` set. Undo
is offered for 30 days, matching the trash.

## 9. Pre-existing problem fixed in this change

`feature_flag_admin_write` (`20260818082054`) let any signed-in member change
workspace-wide switches, because its rule starts with `organization_id is
null or …` and every switch has a null organization. The new switch test found
it. `20261101000300` locks workspace-wide rows: they change only in the SQL
editor or with the service role. Nothing in the app wrote switches, so no
screen changes.

## 10. Migration order

The plan's section 9 order, as migrations. Every step is add-only and behind
its switch; rolling back is turning the switch off.

| Step | Migration range | Stream | What |
|---|---|---|---|
| 0 | `20261101000100–0300` | S1 | Switches, `app.can` stand-in, switch rows locked (this change) |
| 1a | `2026110100xxxx` | S1 | `object_type`, `object`, `app.native_object_map`, sync and event triggers (M1a, M9a skeleton) |
| 1b | `2026110100xxxx` | S1 | Tasks and projects: triggers and backfill (M1b) |
| 1c | `2026110200xxxx` | S2 | `space`, `access_grant`, `object_access`, real `app.can` (M10a–c) |
| 1d | `2026110100xxxx` | S1 | `property_definition`, task and project system properties, `property_value` (M2) |
| 1e | `2026110100xxxx` | S1 | `relation_type`, `object_relation`, `object_relation_all` (M3a) |
| 1f | `2026110100xxxx` | S1 | `change_set`, `change_set_item` (M13) |
| 2 | `2026110100xxxx` | S1 | Meetings and decisions registered |
| 3 | `2026110100xxxx` | S1 | Goals and metrics, risks |
| 4 | `2026110100xxxx` | S1 | Documents |
| 5 | `2026110100xxxx` | S1 | Contacts and organizations, events, requests |
| 6 | `2026110100xxxx` | S1 | Finance records as read-only objects (their rules and workflows unchanged) |
| 7 | after one release | owner of each screen | Old screens removed; old columns and `activity_event` writers retired |

Each registration step follows the plan: register and backfill, turn on new
lenses beside the old screens, compare results in tests, switch the menu, keep
the old screen for one release, then remove it.

## 11. Open questions for review

1. **Person objects across organizations.** Section 3 assumes one organization. Fine for QBBE only; confirm.
2. **Private system properties.** Section 4 refuses privacy on a native column that the native table already exposes. Is any native column expected to become private? If so it needs its own isolated table first, as CRM sensitive notes did.
3. **Cache refresh.** Section 7 deletes cache rows on change. W0-7 (S2) measures whether recomputing on the next read stays within 20 ms per board load.
