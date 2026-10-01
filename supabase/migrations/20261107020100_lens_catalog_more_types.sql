-- Workspace OS integration I2 (epic #199): every registered type through one
-- query path.
--
-- The lens engine (20261104010100) knew task and project. The living project
-- page, the editor's query block and app screens answered the other types
-- through their own readers, or not at all. This migration registers the
-- types those screens need in the engine's allow-list, so they run through
-- `public.lens_query` under the viewer's own row-level security like tasks:
--
--   decision   public.decision        (no archive column)
--   meeting    public.meeting         (no archive column)
--   milestone  public.milestone       (no archive column)
--   document   public.document        archived_at
--   activity   public.activity_event  (no archive column)
--   risk       public.risk            (no archive column)
--
-- Two small additions to the builder, each proven in
-- supabase/tests/lens-more-types.sql:
--   * a type without an "archived" entry lists every row the viewer can read
--     (before, every type had to have an archive column);
--   * a property marked "asText" is a uuid column shown and compared as text
--     (activity.source_id), so a text operator on it is valid SQL.
--
-- Nothing else changes: the same functions, the same rights (caller's, STABLE,
-- never security definer), the same error codes, the same grants. The task and
-- project entries are repeated unchanged because lens_catalog() is one
-- constant; supabase/tests/lens-more-types.sql checks they still match the
-- engine's earlier tests.

create or replace function public.lens_catalog()
returns jsonb
language sql
immutable
parallel safe
set search_path = ''
as $catalog$
select $json$
{
  "task": {
    "key": "task",
    "table": "task",
    "title": "title",
    "archived": "archived_at",
    "name": { "en": "Task", "fr": "Tâche" },
    "properties": [
      { "key": "title", "column": "title", "kind": "text", "propertyKind": "text",
        "name": { "en": "Title", "fr": "Titre" }, "sortable": true, "groupable": false },
      { "key": "status", "column": "status", "kind": "select", "propertyKind": "status", "cast": "public.task_status",
        "name": { "en": "Status", "fr": "Statut" }, "sortable": true, "groupable": true,
        "choices": [
          { "key": "not_started", "label": { "en": "Not started", "fr": "Non commencée" } },
          { "key": "ready", "label": { "en": "Ready", "fr": "Prête" } },
          { "key": "in_progress", "label": { "en": "In progress", "fr": "En cours" } },
          { "key": "waiting", "label": { "en": "Waiting", "fr": "En attente" } },
          { "key": "blocked", "label": { "en": "Blocked", "fr": "Bloquée" } },
          { "key": "in_review", "label": { "en": "In review", "fr": "En révision" } },
          { "key": "completed", "label": { "en": "Completed", "fr": "Terminée" } },
          { "key": "cancelled", "label": { "en": "Cancelled", "fr": "Annulée" } }
        ] },
      { "key": "priority", "column": "priority", "kind": "select", "propertyKind": "select", "cast": "public.task_priority",
        "name": { "en": "Priority", "fr": "Priorité" }, "sortable": true, "groupable": true,
        "choices": [
          { "key": "low", "label": { "en": "Low", "fr": "Basse" } },
          { "key": "medium", "label": { "en": "Medium", "fr": "Moyenne" } },
          { "key": "high", "label": { "en": "High", "fr": "Haute" } },
          { "key": "critical", "label": { "en": "Critical", "fr": "Critique" } }
        ] },
      { "key": "assignee", "column": "assignee_id", "kind": "person", "propertyKind": "person",
        "ref": { "table": "user_profile", "label": "full_name" },
        "name": { "en": "Assignee", "fr": "Responsable" }, "sortable": false, "groupable": true },
      { "key": "requester", "column": "requester_id", "kind": "person", "propertyKind": "person",
        "ref": { "table": "user_profile", "label": "full_name" },
        "name": { "en": "Requester", "fr": "Demandeur" }, "sortable": false, "groupable": true },
      { "key": "reviewer", "column": "reviewer_id", "kind": "person", "propertyKind": "person",
        "ref": { "table": "user_profile", "label": "full_name" },
        "name": { "en": "Reviewer", "fr": "Réviseur" }, "sortable": false, "groupable": true },
      { "key": "approver", "column": "approver_id", "kind": "person", "propertyKind": "person",
        "ref": { "table": "user_profile", "label": "full_name" },
        "name": { "en": "Approver", "fr": "Approbateur" }, "sortable": false, "groupable": true },
      { "key": "review_role", "kind": "person", "propertyKind": "person", "filterOnly": true,
        "via": { "table": "task_assignment", "from": "task_id", "person": "user_id", "roleColumn": "role", "roles": ["reviewer", "approver"] },
        "name": { "en": "Reviewer or approver (task role)", "fr": "Réviseur ou approbateur (rôle)" }, "sortable": false, "groupable": false },
      { "key": "start", "column": "start_at", "kind": "date", "propertyKind": "date",
        "name": { "en": "Start", "fr": "Début" }, "sortable": true, "groupable": false },
      { "key": "due", "column": "due_at", "kind": "date", "propertyKind": "date",
        "name": { "en": "Due", "fr": "Échéance" }, "sortable": true, "groupable": false },
      { "key": "estimate", "column": "estimate_hours", "kind": "number", "propertyKind": "number",
        "name": { "en": "Estimate (hours)", "fr": "Estimation (heures)" }, "sortable": true, "groupable": false },
      { "key": "project", "column": "project_id", "kind": "relation", "propertyKind": "relation", "target": "project",
        "name": { "en": "Project", "fr": "Projet" }, "sortable": false, "groupable": true },
      { "key": "program", "column": "program_id", "kind": "select", "propertyKind": "relation",
        "ref": { "table": "program", "label": "name" },
        "name": { "en": "Program", "fr": "Programme" }, "sortable": false, "groupable": true },
      { "key": "milestone", "column": "milestone_id", "kind": "select", "propertyKind": "relation",
        "ref": { "table": "milestone", "label": "name" },
        "name": { "en": "Milestone", "fr": "Jalon" }, "sortable": false, "groupable": true },
      { "key": "blocked_reason", "column": "blocked_reason", "kind": "text", "propertyKind": "text",
        "name": { "en": "Blocked because", "fr": "Bloquée parce que" }, "sortable": false, "groupable": false },
      { "key": "completed_time", "column": "completed_at", "kind": "date", "propertyKind": "date", "timestamp": true,
        "name": { "en": "Completed", "fr": "Terminée le" }, "sortable": true, "groupable": false },
      { "key": "created_by", "column": "created_by", "kind": "person", "propertyKind": "created_by",
        "ref": { "table": "user_profile", "label": "full_name" },
        "name": { "en": "Created by", "fr": "Créée par" }, "sortable": false, "groupable": true },
      { "key": "created_time", "column": "created_at", "kind": "date", "propertyKind": "created_time", "timestamp": true,
        "name": { "en": "Created", "fr": "Créée le" }, "sortable": true, "groupable": false },
      { "key": "edited_time", "column": "updated_at", "kind": "date", "propertyKind": "edited_time", "timestamp": true,
        "name": { "en": "Edited", "fr": "Modifiée le" }, "sortable": true, "groupable": false }
    ]
  },
  "project": {
    "key": "project",
    "table": "project",
    "title": "name",
    "archived": "archived_at",
    "name": { "en": "Project", "fr": "Projet" },
    "properties": [
      { "key": "title", "column": "name", "kind": "text", "propertyKind": "text",
        "name": { "en": "Name", "fr": "Nom" }, "sortable": true, "groupable": false },
      { "key": "stage", "column": "stage", "kind": "select", "propertyKind": "status", "cast": "public.project_stage",
        "name": { "en": "Stage", "fr": "Étape" }, "sortable": true, "groupable": true,
        "choices": [
          { "key": "proposed", "label": { "en": "Proposed", "fr": "Proposé" } },
          { "key": "approved", "label": { "en": "Approved", "fr": "Approuvé" } },
          { "key": "planning", "label": { "en": "Planning", "fr": "Planification" } },
          { "key": "active", "label": { "en": "Active", "fr": "Actif" } },
          { "key": "paused", "label": { "en": "Paused", "fr": "En pause" } },
          { "key": "completed", "label": { "en": "Completed", "fr": "Terminé" } },
          { "key": "cancelled", "label": { "en": "Cancelled", "fr": "Annulé" } },
          { "key": "archived", "label": { "en": "Archived", "fr": "Archivé" } }
        ] },
      { "key": "health", "column": "health", "kind": "select", "propertyKind": "select", "cast": "public.project_health",
        "name": { "en": "Health", "fr": "Santé" }, "sortable": true, "groupable": true,
        "choices": [
          { "key": "on_track", "label": { "en": "On track", "fr": "Sur la bonne voie" } },
          { "key": "at_risk", "label": { "en": "At risk", "fr": "À risque" } },
          { "key": "off_track", "label": { "en": "Off track", "fr": "En difficulté" } },
          { "key": "paused", "label": { "en": "Paused", "fr": "En pause" } },
          { "key": "unknown", "label": { "en": "Not set", "fr": "État non défini" } }
        ] },
      { "key": "priority", "column": "priority", "kind": "select", "propertyKind": "select", "cast": "public.task_priority",
        "name": { "en": "Priority", "fr": "Priorité" }, "sortable": true, "groupable": true,
        "choices": [
          { "key": "low", "label": { "en": "Low", "fr": "Basse" } },
          { "key": "medium", "label": { "en": "Medium", "fr": "Moyenne" } },
          { "key": "high", "label": { "en": "High", "fr": "Haute" } },
          { "key": "critical", "label": { "en": "Critical", "fr": "Critique" } }
        ] },
      { "key": "owner", "column": "owner_id", "kind": "person", "propertyKind": "person",
        "ref": { "table": "user_profile", "label": "full_name" },
        "name": { "en": "Owner", "fr": "Responsable" }, "sortable": false, "groupable": true },
      { "key": "program", "column": "program_id", "kind": "select", "propertyKind": "relation",
        "ref": { "table": "program", "label": "name" },
        "name": { "en": "Program", "fr": "Programme" }, "sortable": false, "groupable": true },
      { "key": "start", "column": "start_date", "kind": "date", "propertyKind": "date",
        "name": { "en": "Start", "fr": "Début" }, "sortable": true, "groupable": false },
      { "key": "target", "column": "target_date", "kind": "date", "propertyKind": "date",
        "name": { "en": "Target date", "fr": "Date cible" }, "sortable": true, "groupable": false },
      { "key": "completed_time", "column": "completed_at", "kind": "date", "propertyKind": "date", "timestamp": true,
        "name": { "en": "Completed", "fr": "Terminé le" }, "sortable": true, "groupable": false },
      { "key": "created_by", "column": "created_by", "kind": "person", "propertyKind": "created_by",
        "ref": { "table": "user_profile", "label": "full_name" },
        "name": { "en": "Created by", "fr": "Créé par" }, "sortable": false, "groupable": true },
      { "key": "created_time", "column": "created_at", "kind": "date", "propertyKind": "created_time", "timestamp": true,
        "name": { "en": "Created", "fr": "Créé le" }, "sortable": true, "groupable": false },
      { "key": "edited_time", "column": "updated_at", "kind": "date", "propertyKind": "edited_time", "timestamp": true,
        "name": { "en": "Edited", "fr": "Modifié le" }, "sortable": true, "groupable": false }
    ]
  },
  "project": {
    "key": "project",
    "table": "project",
    "title": "name",
    "archived": "archived_at",
    "name": { "en": "Project", "fr": "Projet" },
    "properties": [
      { "key": "title", "column": "name", "kind": "text", "propertyKind": "text",
        "name": { "en": "Name", "fr": "Nom" }, "sortable": true, "groupable": false },
      { "key": "stage", "column": "stage", "kind": "select", "propertyKind": "status", "cast": "public.project_stage",
        "name": { "en": "Stage", "fr": "Étape" }, "sortable": true, "groupable": true,
        "choices": [
          { "key": "proposed", "label": { "en": "Proposed", "fr": "Proposé" } },
          { "key": "approved", "label": { "en": "Approved", "fr": "Approuvé" } },
          { "key": "planning", "label": { "en": "Planning", "fr": "Planification" } },
          { "key": "active", "label": { "en": "Active", "fr": "Actif" } },
          { "key": "paused", "label": { "en": "Paused", "fr": "En pause" } },
          { "key": "completed", "label": { "en": "Completed", "fr": "Terminé" } },
          { "key": "cancelled", "label": { "en": "Cancelled", "fr": "Annulé" } },
          { "key": "archived", "label": { "en": "Archived", "fr": "Archivé" } }
        ] },
      { "key": "health", "column": "health", "kind": "select", "propertyKind": "select", "cast": "public.project_health",
        "name": { "en": "Health", "fr": "Santé" }, "sortable": true, "groupable": true,
        "choices": [
          { "key": "on_track", "label": { "en": "On track", "fr": "Sur la bonne voie" } },
          { "key": "at_risk", "label": { "en": "At risk", "fr": "À risque" } },
          { "key": "off_track", "label": { "en": "Off track", "fr": "En difficulté" } },
          { "key": "paused", "label": { "en": "Paused", "fr": "En pause" } },
          { "key": "unknown", "label": { "en": "Not set", "fr": "État non défini" } }
        ] },
      { "key": "priority", "column": "priority", "kind": "select", "propertyKind": "select", "cast": "public.task_priority",
        "name": { "en": "Priority", "fr": "Priorité" }, "sortable": true, "groupable": true,
        "choices": [
          { "key": "low", "label": { "en": "Low", "fr": "Basse" } },
          { "key": "medium", "label": { "en": "Medium", "fr": "Moyenne" } },
          { "key": "high", "label": { "en": "High", "fr": "Haute" } },
          { "key": "critical", "label": { "en": "Critical", "fr": "Critique" } }
        ] },
      { "key": "owner", "column": "owner_id", "kind": "person", "propertyKind": "person",
        "ref": { "table": "user_profile", "label": "full_name" },
        "name": { "en": "Owner", "fr": "Responsable" }, "sortable": false, "groupable": true },
      { "key": "program", "column": "program_id", "kind": "select", "propertyKind": "relation",
        "ref": { "table": "program", "label": "name" },
        "name": { "en": "Program", "fr": "Programme" }, "sortable": false, "groupable": true },
      { "key": "start", "column": "start_date", "kind": "date", "propertyKind": "date",
        "name": { "en": "Start", "fr": "Début" }, "sortable": true, "groupable": false },
      { "key": "target", "column": "target_date", "kind": "date", "propertyKind": "date",
        "name": { "en": "Target date", "fr": "Date cible" }, "sortable": true, "groupable": false },
      { "key": "completed_time", "column": "completed_at", "kind": "date", "propertyKind": "date", "timestamp": true,
        "name": { "en": "Completed", "fr": "Terminé le" }, "sortable": true, "groupable": false },
      { "key": "created_by", "column": "created_by", "kind": "person", "propertyKind": "created_by",
        "ref": { "table": "user_profile", "label": "full_name" },
        "name": { "en": "Created by", "fr": "Créé par" }, "sortable": false, "groupable": true },
      { "key": "created_time", "column": "created_at", "kind": "date", "propertyKind": "created_time", "timestamp": true,
        "name": { "en": "Created", "fr": "Créé le" }, "sortable": true, "groupable": false },
      { "key": "edited_time", "column": "updated_at", "kind": "date", "propertyKind": "edited_time", "timestamp": true,
        "name": { "en": "Edited", "fr": "Modifié le" }, "sortable": true, "groupable": false }
    ]
  },
  "decision": {
    "key": "decision",
    "table": "decision",
    "title": "title",
    "name": { "en": "Decision", "fr": "Décision" },
    "properties": [
      { "key": "title", "column": "title", "kind": "text", "propertyKind": "text",
        "name": { "en": "Title", "fr": "Titre" }, "sortable": true, "groupable": false },
      { "key": "project", "column": "project_id", "kind": "relation", "propertyKind": "relation", "target": "project",
        "name": { "en": "Project", "fr": "Projet" }, "sortable": false, "groupable": true },
      { "key": "meeting", "column": "meeting_id", "kind": "relation", "propertyKind": "relation", "target": "meeting",
        "name": { "en": "Meeting", "fr": "Réunion" }, "sortable": false, "groupable": true },
      { "key": "decided_by", "column": "decided_by", "kind": "person", "propertyKind": "person",
        "ref": { "table": "user_profile", "label": "full_name" },
        "name": { "en": "Decided by", "fr": "Décidée par" }, "sortable": false, "groupable": true },
      { "key": "decided_time", "column": "decided_at", "kind": "date", "propertyKind": "date", "timestamp": true,
        "name": { "en": "Decided", "fr": "Décidée le" }, "sortable": true, "groupable": false },
      { "key": "revisit", "column": "revisit_on", "kind": "date", "propertyKind": "date",
        "name": { "en": "Revisit on", "fr": "À revoir le" }, "sortable": true, "groupable": false },
      { "key": "created_time", "column": "created_at", "kind": "date", "propertyKind": "created_time", "timestamp": true,
        "name": { "en": "Created", "fr": "Créée le" }, "sortable": true, "groupable": false }
    ]
  },
  "meeting": {
    "key": "meeting",
    "table": "meeting",
    "title": "title",
    "name": { "en": "Meeting", "fr": "Réunion" },
    "properties": [
      { "key": "title", "column": "title", "kind": "text", "propertyKind": "text",
        "name": { "en": "Title", "fr": "Titre" }, "sortable": true, "groupable": false },
      { "key": "status", "column": "status", "kind": "select", "propertyKind": "status", "cast": "public.meeting_status",
        "name": { "en": "Status", "fr": "Statut" }, "sortable": true, "groupable": true,
        "choices": [
          { "key": "scheduled", "label": { "en": "Scheduled", "fr": "Planifiée" } },
          { "key": "in_progress", "label": { "en": "In progress", "fr": "En cours" } },
          { "key": "completed", "label": { "en": "Completed", "fr": "Terminée" } },
          { "key": "cancelled", "label": { "en": "Cancelled", "fr": "Annulée" } }
        ] },
      { "key": "project", "column": "project_id", "kind": "relation", "propertyKind": "relation", "target": "project",
        "name": { "en": "Project", "fr": "Projet" }, "sortable": false, "groupable": true },
      { "key": "program", "column": "program_id", "kind": "select", "propertyKind": "relation",
        "ref": { "table": "program", "label": "name" },
        "name": { "en": "Program", "fr": "Programme" }, "sortable": false, "groupable": true },
      { "key": "organizer", "column": "organizer_id", "kind": "person", "propertyKind": "person",
        "ref": { "table": "user_profile", "label": "full_name" },
        "name": { "en": "Organizer", "fr": "Organisateur" }, "sortable": false, "groupable": true },
      { "key": "starts", "column": "starts_at", "kind": "date", "propertyKind": "date", "timestamp": true,
        "name": { "en": "Starts", "fr": "Début" }, "sortable": true, "groupable": false },
      { "key": "ends", "column": "ends_at", "kind": "date", "propertyKind": "date", "timestamp": true,
        "name": { "en": "Ends", "fr": "Fin" }, "sortable": true, "groupable": false },
      { "key": "location", "column": "location", "kind": "text", "propertyKind": "text",
        "name": { "en": "Location", "fr": "Lieu" }, "sortable": false, "groupable": false },
      { "key": "created_time", "column": "created_at", "kind": "date", "propertyKind": "created_time", "timestamp": true,
        "name": { "en": "Created", "fr": "Créée le" }, "sortable": true, "groupable": false },
      { "key": "edited_time", "column": "updated_at", "kind": "date", "propertyKind": "edited_time", "timestamp": true,
        "name": { "en": "Edited", "fr": "Modifiée le" }, "sortable": true, "groupable": false }
    ]
  },
  "milestone": {
    "key": "milestone",
    "table": "milestone",
    "title": "name",
    "name": { "en": "Milestone", "fr": "Jalon" },
    "properties": [
      { "key": "title", "column": "name", "kind": "text", "propertyKind": "text",
        "name": { "en": "Name", "fr": "Nom" }, "sortable": true, "groupable": false },
      { "key": "status", "column": "status", "kind": "select", "propertyKind": "status",
        "name": { "en": "Status", "fr": "Statut" }, "sortable": true, "groupable": true,
        "choices": [
          { "key": "planned", "label": { "en": "Planned", "fr": "Planifié" } },
          { "key": "in_progress", "label": { "en": "In progress", "fr": "En cours" } },
          { "key": "completed", "label": { "en": "Completed", "fr": "Terminé" } },
          { "key": "missed", "label": { "en": "Missed", "fr": "Manqué" } }
        ] },
      { "key": "project", "column": "project_id", "kind": "relation", "propertyKind": "relation", "target": "project",
        "name": { "en": "Project", "fr": "Projet" }, "sortable": false, "groupable": true },
      { "key": "owner", "column": "owner_id", "kind": "person", "propertyKind": "person",
        "ref": { "table": "user_profile", "label": "full_name" },
        "name": { "en": "Owner", "fr": "Responsable" }, "sortable": false, "groupable": true },
      { "key": "due", "column": "due_date", "kind": "date", "propertyKind": "date",
        "name": { "en": "Due", "fr": "Échéance" }, "sortable": true, "groupable": false },
      { "key": "completed_time", "column": "completed_at", "kind": "date", "propertyKind": "date", "timestamp": true,
        "name": { "en": "Completed", "fr": "Terminé le" }, "sortable": true, "groupable": false },
      { "key": "created_time", "column": "created_at", "kind": "date", "propertyKind": "created_time", "timestamp": true,
        "name": { "en": "Created", "fr": "Créé le" }, "sortable": true, "groupable": false },
      { "key": "edited_time", "column": "updated_at", "kind": "date", "propertyKind": "edited_time", "timestamp": true,
        "name": { "en": "Edited", "fr": "Modifié le" }, "sortable": true, "groupable": false }
    ]
  },
  "document": {
    "key": "document",
    "table": "document",
    "title": "title",
    "archived": "archived_at",
    "name": { "en": "File", "fr": "Fichier" },
    "properties": [
      { "key": "title", "column": "title", "kind": "text", "propertyKind": "text",
        "name": { "en": "Title", "fr": "Titre" }, "sortable": true, "groupable": false },
      { "key": "kind", "column": "kind", "kind": "select", "propertyKind": "select", "cast": "public.document_kind",
        "name": { "en": "Kind", "fr": "Type" }, "sortable": true, "groupable": true,
        "choices": [
          { "key": "file", "label": { "en": "File", "fr": "Fichier" } },
          { "key": "link", "label": { "en": "Link", "fr": "Lien" } }
        ] },
      { "key": "visibility", "column": "visibility", "kind": "select", "propertyKind": "select",
        "name": { "en": "Visible to", "fr": "Visible par" }, "sortable": true, "groupable": true,
        "choices": [
          { "key": "organization", "label": { "en": "Everyone", "fr": "Tout le monde" } },
          { "key": "staff", "label": { "en": "Staff", "fr": "Personnel" } }
        ] },
      { "key": "project", "column": "project_id", "kind": "relation", "propertyKind": "relation", "target": "project",
        "name": { "en": "Project", "fr": "Projet" }, "sortable": false, "groupable": true },
      { "key": "program", "column": "program_id", "kind": "select", "propertyKind": "relation",
        "ref": { "table": "program", "label": "name" },
        "name": { "en": "Program", "fr": "Programme" }, "sortable": false, "groupable": true },
      { "key": "meeting", "column": "meeting_id", "kind": "relation", "propertyKind": "relation", "target": "meeting",
        "name": { "en": "Meeting", "fr": "Réunion" }, "sortable": false, "groupable": true },
      { "key": "owner", "column": "owner_id", "kind": "person", "propertyKind": "person",
        "ref": { "table": "user_profile", "label": "full_name" },
        "name": { "en": "Owner", "fr": "Responsable" }, "sortable": false, "groupable": true },
      { "key": "created_by", "column": "created_by", "kind": "person", "propertyKind": "created_by",
        "ref": { "table": "user_profile", "label": "full_name" },
        "name": { "en": "Added by", "fr": "Ajouté par" }, "sortable": false, "groupable": true },
      { "key": "created_time", "column": "created_at", "kind": "date", "propertyKind": "created_time", "timestamp": true,
        "name": { "en": "Added", "fr": "Ajouté le" }, "sortable": true, "groupable": false },
      { "key": "edited_time", "column": "updated_at", "kind": "date", "propertyKind": "edited_time", "timestamp": true,
        "name": { "en": "Updated", "fr": "Mis à jour le" }, "sortable": true, "groupable": false }
    ]
  },
  "activity": {
    "key": "activity",
    "table": "activity_event",
    "title": "summary",
    "name": { "en": "Activity", "fr": "Activité" },
    "properties": [
      { "key": "title", "column": "summary", "kind": "text", "propertyKind": "text",
        "name": { "en": "Summary", "fr": "Résumé" }, "sortable": false, "groupable": false },
      { "key": "verb", "column": "verb", "kind": "text", "propertyKind": "text",
        "name": { "en": "What happened", "fr": "Quoi" }, "sortable": false, "groupable": false },
      { "key": "source_type", "column": "source_type", "kind": "text", "propertyKind": "text",
        "name": { "en": "About (type)", "fr": "À propos de (type)" }, "sortable": false, "groupable": false },
      { "key": "source_id", "column": "source_id", "kind": "text", "propertyKind": "text", "asText": true,
        "name": { "en": "About (id)", "fr": "À propos de (identifiant)" }, "sortable": false, "groupable": false },
      { "key": "actor", "column": "actor_id", "kind": "person", "propertyKind": "person",
        "ref": { "table": "user_profile", "label": "full_name" },
        "name": { "en": "Who", "fr": "Qui" }, "sortable": false, "groupable": true },
      { "key": "project", "column": "project_id", "kind": "relation", "propertyKind": "relation", "target": "project",
        "name": { "en": "Project", "fr": "Projet" }, "sortable": false, "groupable": true },
      { "key": "program", "column": "program_id", "kind": "select", "propertyKind": "relation",
        "ref": { "table": "program", "label": "name" },
        "name": { "en": "Program", "fr": "Programme" }, "sortable": false, "groupable": true },
      { "key": "created_time", "column": "created_at", "kind": "date", "propertyKind": "created_time", "timestamp": true,
        "name": { "en": "When", "fr": "Quand" }, "sortable": true, "groupable": false }
    ]
  },
  "risk": {
    "key": "risk",
    "table": "risk",
    "title": "title",
    "name": { "en": "Risk", "fr": "Risque" },
    "properties": [
      { "key": "title", "column": "title", "kind": "text", "propertyKind": "text",
        "name": { "en": "Title", "fr": "Titre" }, "sortable": true, "groupable": false },
      { "key": "status", "column": "status", "kind": "select", "propertyKind": "status", "cast": "public.risk_status",
        "name": { "en": "Status", "fr": "Statut" }, "sortable": true, "groupable": true,
        "choices": [
          { "key": "open", "label": { "en": "Open", "fr": "Ouvert" } },
          { "key": "mitigating", "label": { "en": "Mitigating", "fr": "En atténuation" } },
          { "key": "accepted", "label": { "en": "Accepted", "fr": "Accepté" } },
          { "key": "closed", "label": { "en": "Closed", "fr": "Fermé" } }
        ] },
      { "key": "likelihood", "column": "likelihood", "kind": "select", "propertyKind": "select", "cast": "public.risk_likelihood",
        "name": { "en": "Likelihood", "fr": "Probabilité" }, "sortable": true, "groupable": true,
        "choices": [
          { "key": "low", "label": { "en": "Low", "fr": "Faible" } },
          { "key": "medium", "label": { "en": "Medium", "fr": "Moyenne" } },
          { "key": "high", "label": { "en": "High", "fr": "Élevée" } }
        ] },
      { "key": "impact", "column": "impact", "kind": "select", "propertyKind": "select", "cast": "public.risk_impact",
        "name": { "en": "Impact", "fr": "Impact" }, "sortable": true, "groupable": true,
        "choices": [
          { "key": "low", "label": { "en": "Low", "fr": "Faible" } },
          { "key": "medium", "label": { "en": "Medium", "fr": "Moyen" } },
          { "key": "high", "label": { "en": "High", "fr": "Élevé" } }
        ] },
      { "key": "score", "column": "score", "kind": "number", "propertyKind": "number",
        "name": { "en": "Score", "fr": "Score" }, "sortable": true, "groupable": false },
      { "key": "project", "column": "project_id", "kind": "relation", "propertyKind": "relation", "target": "project",
        "name": { "en": "Project", "fr": "Projet" }, "sortable": false, "groupable": true },
      { "key": "owner", "column": "owner_id", "kind": "person", "propertyKind": "person",
        "ref": { "table": "user_profile", "label": "full_name" },
        "name": { "en": "Owner", "fr": "Responsable" }, "sortable": false, "groupable": true },
      { "key": "review", "column": "review_at", "kind": "date", "propertyKind": "date",
        "name": { "en": "Review on", "fr": "À revoir le" }, "sortable": true, "groupable": false },
      { "key": "closed_time", "column": "closed_at", "kind": "date", "propertyKind": "date", "timestamp": true,
        "name": { "en": "Closed", "fr": "Fermé le" }, "sortable": true, "groupable": false },
      { "key": "created_time", "column": "created_at", "kind": "date", "propertyKind": "created_time", "timestamp": true,
        "name": { "en": "Created", "fr": "Créé le" }, "sortable": true, "groupable": false },
      { "key": "edited_time", "column": "updated_at", "kind": "date", "propertyKind": "edited_time", "timestamp": true,
        "name": { "en": "Edited", "fr": "Modifié le" }, "sortable": true, "groupable": false }
    ]
  }
}
$json$::jsonb;
$catalog$;

comment on function public.lens_catalog() is
  'Workspace OS lens engine allow-list (M8a, I2): the only types, properties and '
  'columns a lens query may reference.';

-- ---------------------------------------------------------------------------

-- One condition to SQL. Values are appended to `params`; the returned SQL
-- references them by position only.
create or replace function public.lens__condition(
  p_type_def jsonb,
  p_node jsonb,
  p_alias text,
  p_depth integer,
  p_allow_match boolean,
  p_today date,
  inout params jsonb,
  inout conditions integer,
  inout aliases integer,
  out sql text
)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_prop jsonb;
  v_kind text;
  v_op text;
  v_value jsonb;
  v_col text;
  v_ts boolean;
  v_cast text;
  v_pred text;
  v_negate boolean := false;
  v_n integer;
  v_range record;
  v_range2 record;
  v_item jsonb;
  v_list jsonb;
  v_uid uuid := (select auth.uid());
  v_target jsonb;
  v_inner record;
  v_t text;
  v_ops text[];
  v_start text;
  v_end_excl text;
begin
  conditions := conditions + 1;
  if conditions > 50 then
    perform public.lens__fail('too_complex', 'Too many conditions.');
  end if;
  perform public.lens__only_keys(p_node, array['property', 'operator', 'value']);
  v_prop := public.lens__property(p_type_def, p_node -> 'property');
  v_kind := v_prop ->> 'kind';
  if jsonb_typeof(p_node -> 'operator') is distinct from 'string' then
    perform public.lens__fail('bad_operator', 'Unknown operator.');
  end if;
  v_op := p_node ->> 'operator';
  v_value := p_node -> 'value';

  v_ops := case v_kind
    when 'text' then array['equals', 'not_equals', 'contains', 'not_contains', 'starts_with', 'is_empty', 'is_not_empty']
    when 'number' then array['eq', 'neq', 'lt', 'lte', 'gt', 'gte', 'between', 'is_empty', 'is_not_empty']
    when 'date' then array['is', 'before', 'after', 'on_or_before', 'on_or_after', 'between', 'is_empty', 'is_not_empty']
    when 'select' then array['is', 'is_not', 'is_any_of', 'is_none_of', 'is_empty', 'is_not_empty']
    when 'person' then array['contains', 'not_contains', 'is_empty', 'is_not_empty']
    when 'checkbox' then array['is']
    when 'relation' then array['contains', 'not_contains', 'is_empty', 'is_not_empty', 'matches']
    else array[]::text[]
  end;
  if not (v_op = any (v_ops)) then
    perform public.lens__fail('bad_operator', format('Operator not allowed for "%s".', v_prop ->> 'key'));
  end if;

  if v_op in ('is_empty', 'is_not_empty') then
    if p_node ? 'value' then
      perform public.lens__fail('bad_value', 'This operator takes no value.');
    end if;
    if v_prop ? 'via' then
      sql := format(case v_op when 'is_empty' then '(not %s)' else '(%s)' end,
        public.lens__via_exists(p_alias, v_prop, null));
      return;
    end if;
    v_col := public.lens__visible_id(p_alias, v_prop);
    if coalesce((v_prop ->> 'asText')::boolean, false) then
      v_col := format('(%s::text)', v_col);
    end if;
    if v_kind = 'text' then
      sql := case v_op
        when 'is_empty' then format('(%1$s is null or %1$s = %2$L)', v_col, '')
        else format('(%1$s is not null and %1$s <> %2$L)', v_col, '')
      end;
    else
      sql := format(case v_op when 'is_empty' then '(%s is null)' else '(%s is not null)' end, v_col);
    end if;
    return;
  end if;

  if not (p_node ? 'value') then
    perform public.lens__fail('bad_value', 'This operator needs a value.');
  end if;

  if not (v_prop ? 'via') then
    v_col := public.lens__column(p_alias, v_prop);
  end if;
  -- A uuid column exposed as text (activity.source_id) compares as text.
  if coalesce((v_prop ->> 'asText')::boolean, false) then
    v_col := format('(%s::text)', v_col);
  end if;

  case v_kind
  when 'text' then
    if jsonb_typeof(v_value) is distinct from 'string' or length(v_value #>> '{}') > 500 then
      perform public.lens__fail('bad_value', 'Expected text.');
    end if;
    if v_op in ('equals', 'not_equals') then
      params := params || jsonb_build_array(v_value #>> '{}');
      v_pred := format('%s = %s', v_col, public.lens__ref(jsonb_array_length(params) - 1, 'text'));
      v_negate := v_op = 'not_equals';
    else
      -- The caller's %, _ and \ match literally.
      params := params || jsonb_build_array(
        case when v_op = 'starts_with' then '' else '%' end
        || regexp_replace(v_value #>> '{}', '([\\%_])', '\\\1', 'g')
        || '%'
      );
      v_pred := format('%s ilike %s escape %L', v_col, public.lens__ref(jsonb_array_length(params) - 1, 'text'), '\');
      v_negate := v_op = 'not_contains';
    end if;

  when 'number' then
    if v_op = 'between' then
      if jsonb_typeof(v_value) is distinct from 'object' then
        perform public.lens__fail('bad_value', 'Expected from and to.');
      end if;
      perform public.lens__only_keys(v_value, array['from', 'to']);
      if jsonb_typeof(v_value -> 'from') is distinct from 'number'
         or jsonb_typeof(v_value -> 'to') is distinct from 'number' then
        perform public.lens__fail('bad_value', 'Expected a number.');
      end if;
      params := params || jsonb_build_array(v_value -> 'from', v_value -> 'to');
      v_n := jsonb_array_length(params);
      v_pred := format('%s between %s and %s', v_col,
        public.lens__ref(v_n - 2, 'numeric'), public.lens__ref(v_n - 1, 'numeric'));
    else
      if jsonb_typeof(v_value) is distinct from 'number' then
        perform public.lens__fail('bad_value', 'Expected a number.');
      end if;
      params := params || jsonb_build_array(v_value);
      v_pred := format('%s %s %s', v_col,
        case v_op when 'eq' then '=' when 'neq' then '=' when 'lt' then '<'
          when 'lte' then '<=' when 'gt' then '>' else '>=' end,
        public.lens__ref(jsonb_array_length(params) - 1, 'numeric'));
      v_negate := v_op = 'neq';
    end if;

  when 'date' then
    v_ts := coalesce((v_prop ->> 'timestamp')::boolean, false);
    if v_op = 'between' then
      if jsonb_typeof(v_value) is distinct from 'object' then
        perform public.lens__fail('bad_value', 'Expected from and to.');
      end if;
      perform public.lens__only_keys(v_value, array['from', 'to']);
      select * into v_range from public.lens__day_range(v_value -> 'from', p_today);
      select * into v_range2 from public.lens__day_range(v_value -> 'to', p_today);
    else
      select * into v_range from public.lens__day_range(v_value, p_today);
      v_range2 := v_range;
    end if;
    -- Bound as day boundaries: the first day, and the day after the last.
    params := params || jsonb_build_array(v_range.day_start::text, (v_range2.day_end + 1)::text);
    v_n := jsonb_array_length(params);
    if v_ts then
      v_start := format('(%s::timestamp at time zone ($1->>0))', public.lens__ref(v_n - 2, 'date'));
      v_end_excl := format('(%s::timestamp at time zone ($1->>0))', public.lens__ref(v_n - 1, 'date'));
    else
      v_start := public.lens__ref(v_n - 2, 'date');
      v_end_excl := public.lens__ref(v_n - 1, 'date');
    end if;
    v_pred := case v_op
      when 'is' then format('%1$s >= %2$s and %1$s < %3$s', v_col, v_start, v_end_excl)
      when 'between' then format('%1$s >= %2$s and %1$s < %3$s', v_col, v_start, v_end_excl)
      when 'before' then format('%s < %s', v_col, v_start)
      when 'after' then format('%s >= %s', v_col, v_end_excl)
      when 'on_or_before' then format('%s < %s', v_col, v_end_excl)
      else format('%s >= %s', v_col, v_start)
    end;

  when 'select' then
    v_cast := coalesce(v_prop ->> 'cast', case when v_prop ? 'ref' then 'uuid' else 'text' end);
    if v_op in ('is', 'is_not') then
      v_list := jsonb_build_array(v_value);
    else
      if jsonb_typeof(v_value) is distinct from 'array' or jsonb_array_length(v_value) = 0
         or jsonb_array_length(v_value) > 100 then
        perform public.lens__fail('bad_value', 'Expected a non-empty list.');
      end if;
      v_list := v_value;
    end if;
    for v_item in select * from jsonb_array_elements(v_list) loop
      if jsonb_typeof(v_item) is distinct from 'string' then
        perform public.lens__fail('bad_value', 'Expected an option.');
      end if;
      if v_prop ? 'ref' then
        if (v_item #>> '{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
          perform public.lens__fail('bad_value', 'Expected an id.');
        end if;
      elsif not exists (
        select 1 from jsonb_array_elements(v_prop -> 'choices') c where c ->> 'key' = v_item #>> '{}'
      ) then
        perform public.lens__fail('bad_value', format('Not an option of "%s".', v_prop ->> 'key'));
      end if;
    end loop;
    if v_prop ? 'ref' then
      v_col := public.lens__visible_id(p_alias, v_prop);
    end if;
    if v_op in ('is', 'is_not') then
      params := params || jsonb_build_array(
        case when v_prop ? 'ref' then lower(v_value #>> '{}') else v_value #>> '{}' end);
      v_pred := format('%s = %s', v_col, public.lens__ref(jsonb_array_length(params) - 1, v_cast));
    else
      params := params || jsonb_build_array(v_list);
      v_pred := format('%s = any(%s)', v_col, public.lens__list_ref(jsonb_array_length(params) - 1, v_cast));
    end if;
    v_negate := v_op in ('is_not', 'is_none_of');

  when 'person' then
    if jsonb_typeof(v_value) = 'object' then
      perform public.lens__only_keys(v_value, array['relative']);
      if v_value ->> 'relative' is distinct from 'me' or v_uid is null then
        perform public.lens__fail('bad_value', 'Expected a person id or "me".');
      end if;
      params := params || jsonb_build_array(v_uid::text);
    elsif jsonb_typeof(v_value) = 'string'
      and (v_value #>> '{}') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      params := params || jsonb_build_array(lower(v_value #>> '{}'));
    else
      perform public.lens__fail('bad_value', 'Expected a person id or "me".');
    end if;
    if v_prop ? 'via' then
      sql := format(case v_op when 'contains' then '(%s)' else '(not %s)' end,
        public.lens__via_exists(p_alias, v_prop, public.lens__ref(jsonb_array_length(params) - 1, 'uuid')));
      return;
    end if;
    v_pred := format('%s = %s', public.lens__visible_id(p_alias, v_prop),
      public.lens__ref(jsonb_array_length(params) - 1, 'uuid'));
    v_negate := v_op = 'not_contains';

  when 'checkbox' then
    if jsonb_typeof(v_value) is distinct from 'boolean' then
      perform public.lens__fail('bad_value', 'Expected true or false.');
    end if;
    -- Unchecked includes "never set", so false is the negation of true.
    v_pred := format('%s', v_col);
    v_negate := not (v_value::text)::boolean;

  when 'relation' then
    v_target := public.lens__type(v_prop -> 'target');
    if v_op = 'matches' then
      if not p_allow_match then
        perform public.lens__fail('too_complex', 'Only one level of relation filters is allowed.');
      end if;
      if jsonb_typeof(v_value) is distinct from 'object' then
        perform public.lens__fail('bad_value', 'Expected a where group.');
      end if;
      perform public.lens__only_keys(v_value, array['where']);
      aliases := aliases + 1;
      v_t := 't' || aliases;
      select * into v_inner
      from public.lens__group(v_target, v_value -> 'where', v_t, p_depth + 1, false, p_today, params, conditions, aliases);
      params := v_inner.params;
      conditions := v_inner.conditions;
      aliases := v_inner.aliases;
      v_pred := format(
        '%s in (select %I.id from public.%I %I where %s and %s)',
        v_col, v_t, v_target ->> 'table', v_t,
        case when v_target ? 'archived' then format('%I.%I is null', v_t, v_target ->> 'archived') else 'true' end,
        v_inner.sql
      );
    else
      if jsonb_typeof(v_value) is distinct from 'string'
         or (v_value #>> '{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        perform public.lens__fail('bad_value', 'Expected an object id.');
      end if;
      params := params || jsonb_build_array(lower(v_value #>> '{}'));
      v_pred := format('%s = %s', public.lens__visible_id(p_alias, v_prop),
        public.lens__ref(jsonb_array_length(params) - 1, 'uuid'));
      v_negate := v_op = 'not_contains';
    end if;
  end case;

  -- "Not" operators also match empty values, as users expect.
  if v_negate then
    sql := format('(%1$s is null or not (%2$s))',
      case when v_kind in ('person', 'relation') or v_prop ? 'ref'
        then public.lens__visible_id(p_alias, v_prop) else v_col end,
      v_pred);
  else
    sql := format('(%s)', v_pred);
  end if;
end;
$$;


-- ---------------------------------------------------------------------------
-- The compiler
-- ---------------------------------------------------------------------------

-- Spec to three statements (page, count, group counts), each with its own
-- parameter array. `$1` in each statement is that array.
create or replace function public.lens_compile(spec jsonb, time_zone text default 'America/Toronto')
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_type jsonb;
  v_today date;
  v_limit integer;
  v_offset integer;
  v_where record;
  v_where_sql text := 'true';
  v_params jsonb;
  v_from text;
  v_order text[] := array[]::text[];
  v_sort jsonb;
  v_prop jsonb;
  v_group jsonb;
  v_group_expr text;
  v_group_label text;
  v_group_order text;
  v_values text[] := array[]::text[];
  v_key jsonb;
  v_seen text[] := array[]::text[];
  v_dir text;
  v_page_params jsonb;
  v_n integer;
  v_page text;
  v_count text;
  v_groups text;
  v_columns jsonb := '[]'::jsonb;
begin
  perform public.lens__only_keys(spec, array['version', 'type', 'where', 'sort', 'groupBy', 'select', 'limit', 'offset']);
  if spec -> 'version' is distinct from '1'::jsonb then
    perform public.lens__fail('invalid_spec', 'Unknown query version.');
  end if;
  begin
    v_today := (now() at time zone time_zone)::date;
  exception when others then
    perform public.lens__fail('invalid_spec', 'Unknown time zone.');
  end;
  if time_zone is null or length(time_zone) > 64 then
    perform public.lens__fail('invalid_spec', 'Unknown time zone.');
  end if;
  v_type := public.lens__type(spec -> 'type');

  v_limit := 100;
  if spec ? 'limit' then
    if jsonb_typeof(spec -> 'limit') is distinct from 'number'
       or (spec ->> 'limit') !~ '^\d{1,4}$'
       or (spec ->> 'limit')::integer not between 1 and 1000 then
      perform public.lens__fail('invalid_spec', 'The page size must be between 1 and 1000.');
    end if;
    v_limit := (spec ->> 'limit')::integer;
  end if;
  v_offset := 0;
  if spec ? 'offset' then
    if jsonb_typeof(spec -> 'offset') is distinct from 'number'
       or (spec ->> 'offset') !~ '^\d{1,5}$'
       or (spec ->> 'offset')::integer not between 0 and 10000 then
      perform public.lens__fail('invalid_spec', 'The offset must be between 0 and 10000.');
    end if;
    v_offset := (spec ->> 'offset')::integer;
  end if;

  -- Filters. The time zone is always parameter 0.
  v_params := jsonb_build_array(time_zone);
  if spec ? 'where' then
    select * into v_where from public.lens__group(v_type, spec -> 'where', 'o', 1, true, v_today, v_params, 0, 0);
    v_params := v_where.params;
    v_where_sql := v_where.sql;
  end if;
  -- Types without an archive column (decision, milestone, activity) list every row.
  v_from := format('from public.%I o where %s and %s', v_type ->> 'table',
    case when v_type ? 'archived' then format('o.%I is null', v_type ->> 'archived') else 'true' end,
    v_where_sql);

  -- Grouping.
  if spec ? 'groupBy' then
    perform public.lens__only_keys(spec -> 'groupBy', array['property']);
    v_group := public.lens__property(v_type, spec #> '{groupBy,property}');
    if not coalesce((v_group ->> 'groupable')::boolean, false) then
      perform public.lens__fail('not_groupable', format('Cannot group by "%s".', v_group ->> 'key'));
    end if;
    v_group_expr := public.lens__visible_id('o', v_group);
    if v_group ->> 'kind' = 'relation' or v_group ? 'ref' then
      -- Reference groups carry a label and sort by it.
      v_group_label := public.lens__display(v_group, 'g.k0');
      v_group_order := format('(%s ->> %L)', v_group_label, 'label');
      v_order := v_order || format('(%s ->> %L) asc nulls last',
        public.lens__display(v_group, public.lens__column('o', v_group)), 'label');
    else
      v_group_label := 'null::jsonb';
      v_group_order := 'g.k0';
      v_order := v_order || format('%s asc nulls last', v_group_expr);
    end if;
  end if;

  -- Sorting: the group (above), then the spec's keys, then id for a stable order.
  if spec ? 'sort' then
    if jsonb_typeof(spec -> 'sort') is distinct from 'array' or jsonb_array_length(spec -> 'sort') > 3 then
      perform public.lens__fail('invalid_spec', 'At most three sort keys.');
    end if;
    for v_sort in select * from jsonb_array_elements(spec -> 'sort') loop
      perform public.lens__only_keys(v_sort, array['property', 'direction']);
      v_prop := public.lens__property(v_type, v_sort -> 'property');
      if not coalesce((v_prop ->> 'sortable')::boolean, false) then
        perform public.lens__fail('not_sortable', format('Cannot sort by "%s".', v_prop ->> 'key'));
      end if;
      v_dir := coalesce(v_sort ->> 'direction', 'asc');
      if (v_sort ? 'direction' and jsonb_typeof(v_sort -> 'direction') is distinct from 'string')
         or v_dir not in ('asc', 'desc') then
        perform public.lens__fail('invalid_spec', 'Sort direction must be asc or desc.');
      end if;
      v_order := v_order || format('%s %s nulls last', public.lens__column('o', v_prop), v_dir);
    end loop;
  end if;
  v_order := v_order || 'o.id asc'::text;

  -- Selected columns (title and id are always returned).
  if spec ? 'select' then
    if jsonb_typeof(spec -> 'select') is distinct from 'array' or jsonb_array_length(spec -> 'select') > 30 then
      perform public.lens__fail('invalid_spec', 'At most thirty columns.');
    end if;
    for v_key in select * from jsonb_array_elements(spec -> 'select') loop
      v_prop := public.lens__property(v_type, v_key);
      if coalesce((v_prop ->> 'filterOnly')::boolean, false) then
        perform public.lens__fail('invalid_spec', format('"%s" can be filtered on but not shown.', v_prop ->> 'key'));
      end if;
      if (v_prop ->> 'key') = any (v_seen) then
        continue;
      end if;
      v_seen := v_seen || (v_prop ->> 'key');
      v_values := v_values || format('%L, %s', v_prop ->> 'key', public.lens__display(v_prop, public.lens__column('o', v_prop)));
      v_columns := v_columns || jsonb_build_array(jsonb_build_object(
        'key', v_prop -> 'key', 'kind', v_prop -> 'kind', 'propertyKind', v_prop -> 'propertyKind'));
    end loop;
  end if;

  -- Page.
  v_page_params := v_params || jsonb_build_array(v_limit, v_offset);
  v_n := jsonb_array_length(v_page_params);
  v_page := format(
    'select coalesce(jsonb_agg(p.row order by p.ord), %L::jsonb) from ('
    || 'select jsonb_build_object(%L, o.id, %L, o.%I, %L, %s, %L, jsonb_build_object(%s)) as row, '
    || 'row_number() over (order by %s) as ord %s order by %s limit %s offset %s) p',
    '[]',
    'id', 'title', v_type ->> 'title',
    'group', case when v_group is null then 'null::text' else v_group_expr || '::text' end,
    'values', array_to_string(v_values, ', '),
    array_to_string(v_order, ', '), v_from, array_to_string(v_order, ', '),
    public.lens__ref(v_n - 2, 'integer'), public.lens__ref(v_n - 1, 'integer')
  );

  v_count := format('select count(*)::int %s', v_from);

  if v_group is not null then
    v_groups := format(
      'select coalesce(jsonb_agg(jsonb_build_object(%L, g.k0::text, %L, %s, %L, g.n) order by %s asc nulls last), %L::jsonb) '
      || 'from (select %s as k0, count(*)::int as n %s group by 1) g',
      'key', 'label', v_group_label, 'total', v_group_order, '[]',
      v_group_expr, v_from
    );
  end if;

  return jsonb_build_object(
    'type', v_type -> 'key',
    'columns', v_columns,
    'groupBy', case when v_group is null then null else v_group -> 'key' end,
    'limit', v_limit,
    'offset', v_offset,
    'page', jsonb_build_object('sql', v_page, 'params', v_page_params),
    'count', jsonb_build_object('sql', v_count, 'params', v_params),
    'groups', case when v_groups is null then null
      else jsonb_build_object('sql', v_groups, 'params', v_params) end
  );
end;
$$;

