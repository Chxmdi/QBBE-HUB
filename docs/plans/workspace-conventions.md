# Workspace conventions

Written 2026-10-01 (Workspace OS Phase 0, unit U1). The rules every wave-1
unit builds against, in one place. The route classification is in
[route-map.md](route-map.md). The plan is
[workspace-os-plan.md](workspace-os-plan.md); the build order is
[workspace-os-execution.md](workspace-os-execution.md).

When this file and a migration disagree, the migration is right and this
file needs a fix in the same change.

## 1. Domain model, mapped to the real tables

Everything is an **object** (plan A1). The shared words below are what the
interface, the docs and the tests call things; the right-hand columns are
where each one lives today.

| Shared word | What it is | Tables and functions today | Notes |
|---|---|---|---|
| **Space** | A place work belongs to: a program, the whole workspace, a person's private space, or a custom one | `space` (`kind`, `program_id`, `owner_id`, `name_en`, `name_fr`); access tree in `app.access_node` with `space_kind` | Programs become spaces (M10a); `program` stays and is mirrored, not moved |
| **Page** | A document-first object with nested content | `page` (`parent_page_id`, `visibility` workspace or private, `position`, `archived_at`, `deleted_at`), `page_favourite`, `page_visit`; its `object` row | Nesting under any object uses `object.parent_object_id`; the page tree uses `page.parent_page_id` |
| **Block** | One unit of content inside a page or a task description | `editor_document` (the saved content, `object_type` page or task, `version`), `block` (derived rows: `block_id`, `type`, `position`, `depth`, `text`, `props`, `referenced_object_id`, `referenced_kind`) | `block` is derived from `editor_document` by the save path, never edited directly; a semantic block points at a real object through `referenced_object_id` |
| **Record / object** | Any task, project, meeting, decision, page, contact, custom record | `object` (one row per object, same `id` as the native row), `object_type` (`key`, `kind` native or custom, `native_table`, `default_lens`) | Native tables (`task`, `project`, `meeting`, …) stay; triggers keep their `object` row in sync (M1) |
| **Property** | A typed field on a type | `property_definition` (`key`, `kind`, `options`, `system_column`, `visible_to_roles`), `property_value` (`value_text`, `value_number`, `value_date`, `value_json`) | A system property reads and writes its native column; only custom properties can be private (`visible_to_roles`) |
| **Relation** | A typed, directional link between two objects | `relation_type` (`key`, `cardinality`, `from_type_id`, `to_type_id`, `is_native`), `object_relation` (`from_id`, `relation_type_id`, `to_id`) | Native links (`task.project_id`, `task_dependency`, `crm_link`) are shown as relations through a view; `source` in `src/lib/objects/contracts.ts` says which |
| **View / lens** | A query plus a presentation | `lens` (`kind` table, board, list, calendar, timeline, gallery, feed, dashboard; `spec`, `layout`, `visibility` personal or shared, `path`, `source_saved_view_id`) | `saved_view` rows are converted, one lens per view (M8d); the query engine is `src/lib/query` |
| **Comment** | A thread on an object, a block or a selection | `record_comment` (`parent_type`, `parent_id`, `parent_comment_id`, `block_id`, `resolved_at`, `deleted_at`), `object_suggestion` for suggested edits | One table for every record type since #143; block and selection comments add columns, not tables |
| **Attachment** | A file linked to an object | `document` (+ `document_folder`, `document_text`), Supabase Storage buckets `documents`, `receipts`, `form-files`, `signing-documents`, `exports`; a block with `referenced_kind = 'document'`; a property of kind `file` | There is no `attachment` table: a file is a document, and the link is a block, a property value or a relation |
| **Workflow** | A graph of trigger, condition, action, branch, wait, approval, review | `workflow_rule` (`trigger_event`, `condition`, `action`, and the graph for v2), `workflow_execution` (one run), `workflow_execution_step`, `workflow_review`, `workflow_webhook_secret`, `workflow_event_cursor` | Runs are written by the runner only; see section 3 for whose permissions apply |
| **Form** | Chosen properties of a type exposed for filling in; a response becomes an object | `form_v2` (`type_key`, `title_en`, `title_fr`, `properties`, `audience`, `legacy_form_id`), `form_v2_response` | The original builder's `form_definition` and `form_submission` stay until the conversion is final (V1-6) |
| **Template** | A starting point for an object, a page or a whole space | `template_v2` (`scope` object, page or space; `type_key`; `name_en`, `name_fr`; `body`; `status`) | `project_template`, `agenda_template`, `record_template` and `document_template` are older, narrower templates and stay |
| **Permission** | Who may do what on which object | `access_role` (named capability bundles, built-in and custom), `access_grant` (`object_id`, `principal_kind` person, team or org_role), `app.access_node` (every securable thing with its parent chain), `app.access_cache` (per person and node), `app.can(object_id, capability)`, `public.object_capabilities(object_id)`, `publication` and `published_page` for public pages | Section 3 gives the evaluation order |
| **Activity** | What happened, who did it, what changed | `object_event` (`verb`, `actor_kind`, `actor_id`, `changes`, `change_set_id`, `seq`), `object_event_cursor`; older readers on `activity_event` (`verb`, `source_type`, `summary`) and `audit_event` (`event_type`, `action`, `object_type`); `approval_event` (`kind`) for approvals | Section 4 gives the naming rule and the mapping |
| **Version** | A snapshot of content and properties you can compare and restore | `object_version` (`kind` auto, manual or restore; `content`, `properties`, `content_hash`), `object_trash` (30-day restore), `change_set` and `change_set_item` (undo) | Property and relation history comes from `object_event`, not from versions |

Identity: a person (`user_profile`), a team (`team`), an automation (a
workflow) or an integration (Google). Every event and change set names one
(`object_event.actor_kind`); the session tells the database which with
`set_config('app.actor', 'automation:<workflow id>', true)`.

## 2. Bilingual fields

The Hub speaks English and Quebec French (`fr-CA`), and nothing shown to a
person may exist in only one of them. There are two kinds of text and two
rules.

**Stored labels** are names people type for things the system shows to
other people: a type's name, a property's name, a relation's forward and
reverse names, a space's name, a template's or form's title.

- At the TypeScript boundary they are one value, `LocalizedText { en, fr }`
  (`src/lib/objects/contracts.ts`). Server actions take and return `{ en, fr }`;
  a form shows both inputs and both are required.
- In a table they are a column pair, `name_en` and `name_fr` (or `title_en`
  and `title_fr`), both `not null` and non-blank, as in `object_type`,
  `property_definition`, `relation_type`, `space`, `template_v2`, `form_v2`
  and `published_page`. Inside a JSON body (a template's `body`, a
  dashboard's `layout`, `published_page.fields`) the same pair is written as
  `{ "en": …, "fr": … }` or as `label_en` and `label_fr`, never as a single
  string.
- Codes stay codes (`status`, `kind`, `role`) and are turned into words at
  display time. Text people typed as content (a task title, a comment, a
  page) is data and is never translated.

**Interface text** is everything else the screen says: headings, buttons,
empty states, errors, email subjects.

- Shared screens use the catalogues in `src/lib/i18n/messages/` and `getT()`
  or `useT()` ([docs/i18n.md](../i18n.md)).
- A feature owns its own text in its `i18n/` folder: `en.ts`, `fr-CA.ts`, a
  `server.ts` and `client.ts` pair, and an `i18n.test.ts` that walks every
  English key and fails when the French key is missing, empty, or has
  different `{placeholders}`. The French file is typed against the English
  one, so a missing key also fails `npm run typecheck`. Copy
  `src/features/lenses/i18n/` for a new feature.
- Anything sent to a person (email, notification, reminder) uses that
  person's `user_profile.locale`, not the request's.

## 3. Permission evaluation order

One question, asked in this order. A later layer can only narrow what an
earlier one allowed; nothing can widen it.

1. **Row-level security (RLS) is authoritative.** Every table has policies,
   every query runs through the caller's session, and no application code
   is trusted to filter. Native types keep their existing rules
   (`app.has_task_capability` and friends); the new tables' policies call
   the same `app.can` the application does. A screen never reads with the
   service role to show something to a person.
2. **Access model and page visibility.** Within what RLS allows: the space
   the object is in (`app.access_node`, workspace then space then object
   then property), grants on it (`access_grant` to a person, a team or an
   organization role), inherited grants from its ancestors, `page.visibility`
   (`private` pages reach only their owner and explicit grants), archived
   and private spaces (`app.access_finish_bits` applies organization roles,
   membership and two-step sign-in live on top of the cache), and per-property
   privacy (`property_definition.visible_to_roles`, enforced in RLS and the
   query engine so a private property is absent, not blank).
3. **Capability check, `can(object_id, capability)`.** The single yes-or-no
   the application asks before showing a control or running an action:
   `app.can(object_id, capability)` in SQL, the `Can` type in
   `src/lib/objects/contracts.ts` in TypeScript. Capabilities, in contract
   order: `view`, `comment`, `edit_content`, `edit_structure`, `manage`,
   `run_workflow`, `share`. Today's names (`read`, `collaborate`, `review`,
   `approve`, `follow`) are still accepted and mean what they mean today.
   Lists never call `can` per row; they use the set form
   (`app.access_cached_ids`, `app.access_orgs_where`) once per statement.

Who the question is about:

- **Search, query blocks (embeds), lenses and exports run as the viewer.**
  `public.find` and the lens engine (`src/lib/query/run.ts`) run through the
  viewer's own session, so RLS decides what a result or an embedded query
  block can show. An export is requested through the viewer's session and
  holds only what that session could read; where a builder still runs under
  the service role inside the job runner (`src/features/exports/services/
  export-builders.ts`), it must filter to the requester's organization and
  role itself and say so in a comment, and it is a defect to leave that out.
- **Automation runs as its owner.** A workflow's runs and steps are written
  by the runner with the service client, but every action it takes is
  checked with `app.can_as` for the workflow's `run_as_user_id` (or its
  creator), and its events carry `actor_kind = 'automation'`. A workflow can
  never do what its owner could not.
- **Public pages read a copy, never the live data.** `published_page` is
  written on publish from chosen fields; `/p/[slug]` reads it signed out.
  Private properties are never published.

Admin actions (roles, retention, exports, publishing) require two-step
sign-in (`aal2`), as today.

## 4. Event naming

**Rule:** an event is `<type>.<verb>` with a past-tense verb, for example
`task.status_changed`, `page.created`, `decision.decided`,
`workflow_run.failed`. The type is the object type key (`object_type.key`:
`task`, `project`, `page`, `meeting`, `decision`, …) or, for things that are
not objects, the table (`workflow_run`, `approval`). The verb says what
happened, not what someone tried to do. A property change on a known
property gets its own verb (`status_changed`, `assignee_changed`,
`due_date_changed`); any other change is `updated`.

Use these names in workflow triggers, notification rules, following rules,
test titles and documentation. Nothing new introduces a third style.

**How it maps to what is stored today.** The stores keep the type and the
verb in separate columns, so the name is a convention over them, not a new
column.

| Convention | `object_event` (M9a, triggers only) | `activity_event` (older feed) | `audit_event` |
|---|---|---|---|
| `<type>` | `object_type` | `source_type` (`task`, `project`, `program`, `meeting`, …) | `object_type` |
| `<verb>` | `verb`, one of `created`, `updated`, `archived`, `restored`, `deleted`, `linked`, `unlinked`, `commented` | `verb`, free text; in use today: `created`, `updated`, `completed`, `commented`, `approved`, `decided`, `deleted`, `linked`, `reordered`, `exploded` | `event_type` and `action` |
| Property verbs (`status_changed`, …) | `verb = 'updated'` with the property's `key` in `changes[]` (before and after) | `verb = 'updated'` or `completed`, with an English `summary` | `action` |
| Who | `actor_kind` + `actor_id` (person, team, automation, integration, system) | `actor_id` (a person) | `actor_id`, `actor_type` |

Reading rules:

- `task.status_changed` is an `object_event` with `object_type = 'task'`,
  `verb = 'updated'` and a `changes[]` entry whose `key` is `status`. A
  consumer that wants the convention's name derives it from the verb and the
  changed keys (`src/features/objects/services/event-consumers.ts` is the
  place).
- `task.completed` in the older feed is `activity_event.verb = 'completed'`;
  in `object_event` it is the same `status` change with the new value
  `completed`. `object_activity_feed` (M9b) presents `object_event` in
  `activity_event`'s shape so the feed, the audit log and notifications can
  move over one at a time with a comparison test.
- Approval verbs (`submitted`, `approved`, `rejected`, `withdrawn`,
  `completed`) live in `approval_event.kind` and are named `approval.<kind>`.
- `activity_event.summary` is still an English sentence stored as written
  ([docs/i18n.md](../i18n.md)); new consumers render from the verb and the
  record, not from the summary.

## 5. Feature switches

- **One switch per module**, named `wos_<module>`, in the `feature_flag`
  table (migration `20261101000100`), all off in production until the wave's
  sign-off. Keys the whole app knows are listed in `workspaceOsFlagKeys` in
  `src/lib/feature-flags.ts`; a module whose key is not there yet keeps a
  `flag.ts` or `gate.ts` in its own feature folder (`wos_goals`,
  `wos_decisions_v2`, `wos_meetings_v2`, `wos_mobile`,
  `wos_object_approvals` today) and S1 folds the key into the shared list.
- **Read on the server** with `isEnabled("wos_…")`, through the caller's
  own session; a signed-out request, a missing row or a read error all
  answer false. A hidden screen returns `notFound()`, never a redirect that
  reveals it exists.
- **Tests say which side of the switch they run on.** A test title starts
  with `[switches on]` when it exercises the module with its switch on, and
  `[switch off]` when it proves the screen or path is absent with it off:
  `it("[switches on] opens the table lens for tasks")`,
  `it("[switch off] /lenses/table is not found")`. Every module ships both.
- **Staging only:** `WORKSPACE_OS_FLAGS` (`all`, or a comma-separated list
  of keys) turns modules on for a deploy without changing the table. It can
  only turn a switch on, unknown names are ignored, and production never
  sets it ([docs/runbooks/staging-provisioning.md](../runbooks/staging-provisioning.md),
  step 4c and 4d). Turning a switch off is the rollback; nothing a module
  adds may break the app with its switch off.
- **New write paths are rate-limited** with `enforceRateLimit` from
  `src/lib/rate-limit.ts`, with an `action` named like the event it causes
  (`page:create`, `comment:create`).
