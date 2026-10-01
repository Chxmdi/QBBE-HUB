/**
 * Route map (Workspace OS Phase 0, unit U1).
 *
 * Every `page.tsx` under `src/app` has exactly one entry here. The app
 * directory is the source of truth; `route-map.test.ts` walks it and fails
 * when a page is added, moved or removed without this file following.
 *
 * Patterns are the URL as Next.js serves it: route groups such as
 * `(workspace)` are dropped and dynamic segments keep their brackets.
 *
 * Status rules (docs/plans/route-map.md explains each one):
 * - production: in the menu or reachable today, no switch.
 * - beta: hidden behind a `wos_*` switch (src/lib/feature-flags.ts or a
 *   feature's own flag file) until its wave's sign-off.
 * - migration: an old screen the plan replaces with a Workspace OS screen
 *   (docs/plans/workspace-os-plan.md section 9), or a `/collab/*` screen
 *   whose panels move onto the object's own page. `canonical` names where
 *   people should end up.
 * - admin: administration screens under `/admin/*` and `/spaces/{admin,
 *   roles,publish}`, owners and admins only.
 * - deprecated: fully replaced by `canonical`; kept only until removed.
 *
 * `task` is the plan item (M1, V1-5, #146 and so on) or the daily task the
 * route serves. The sidebar itself stays in src/config/navigation.ts.
 */

export type RouteStatus =
  | "production"
  | "beta"
  | "migration"
  | "admin"
  | "deprecated";

export interface RouteMapEntry {
  /** The URL pattern, for example `/projects/[id]`. */
  pattern: string;
  status: RouteStatus;
  /** The `wos_*` key that hides the screen, when there is one. */
  switch?: string;
  /** Where a migration or deprecated screen leads. Must be a pattern in this map. */
  canonical?: string;
  /** The plan item or product task the screen serves. */
  task: string;
}

/**
 * One canonical destination per daily task. Each destination is named once
 * and must be a production, beta or admin pattern in ROUTE_MAP, never a
 * screen that is itself on its way out.
 */
export const DAILY_TASKS: ReadonlyArray<{ task: string; canonical: string }> = [
  { task: "Home", canonical: "/home" },
  { task: "My Work", canonical: "/lenses/my-work" },
  { task: "Pages", canonical: "/pages" },
  { task: "Data", canonical: "/lenses" },
  { task: "Communication", canonical: "/inbox" },
  { task: "Programs", canonical: "/programs" },
  { task: "Settings", canonical: "/settings" },
];

export const ROUTE_MAP: ReadonlyArray<RouteMapEntry> = [
  // --- Sign-in and account (auth group, public) ---------------------------
  { pattern: "/sign-in", status: "production", task: "Sign in" },
  { pattern: "/sign-up", status: "production", task: "Sign up (invite-only after the first organization)" },
  { pattern: "/forgot-password", status: "production", task: "Password reset request" },
  { pattern: "/reset-password", status: "production", task: "Password reset" },
  { pattern: "/mfa", status: "production", task: "Two-step sign-in (MFA)" },
  { pattern: "/welcome", status: "production", task: "First-run onboarding" },
  { pattern: "/account-inactive", status: "production", task: "Deactivated member landing" },

  // --- Home ---------------------------------------------------------------
  { pattern: "/", status: "migration", canonical: "/home", task: "Home: today's dashboard, replaced by M17 Home" },
  { pattern: "/home", status: "beta", switch: "wos_home", task: "Home (M17a): Now, Today, Waiting, Continue, Decisions, Changes" },
  { pattern: "/home/world", status: "beta", switch: "wos_home", task: "My World (M17b)" },
  { pattern: "/home/commands", status: "beta", switch: "wos_home", task: "Command language on its own page (M15) until it mounts in the palette" },
  { pattern: "/home/projects/[id]", status: "beta", switch: "wos_home", task: "Living project page (M19); folds into /projects/[id] at integration" },

  // --- My Work, board, search (lenses replace them) ------------------------
  { pattern: "/my-work", status: "migration", canonical: "/lenses/my-work", task: "My Work: the old screen, replaced by the lens version (M8c)" },
  { pattern: "/board", status: "migration", canonical: "/lenses/board", task: "Board: the old screen, replaced by the lens version (M8c)" },
  { pattern: "/search", status: "migration", canonical: "/lenses/find", task: "Search: replaced by Find (M12)" },
  { pattern: "/lenses", status: "beta", switch: "wos_lenses", task: "Data: saved lenses index (M8d)" },
  { pattern: "/lenses/my-work", status: "beta", switch: "wos_lenses", task: "My Work on the lens engine (M8c)" },
  { pattern: "/lenses/board", status: "beta", switch: "wos_lenses", task: "Board lens (M8c)" },
  { pattern: "/lenses/table", status: "beta", switch: "wos_lenses", task: "Table lens (M8b)" },
  { pattern: "/lenses/calendar", status: "beta", switch: "wos_lenses", task: "Calendar lens (V1-1)" },
  { pattern: "/lenses/timeline", status: "beta", switch: "wos_lenses", task: "Timeline lens (V1-2)" },
  { pattern: "/lenses/gallery", status: "beta", switch: "wos_lenses", task: "Gallery lens (V1-3)" },
  { pattern: "/lenses/feed", status: "beta", switch: "wos_lenses", task: "Feed lens (V1-4)" },
  { pattern: "/lenses/dashboard", status: "beta", switch: "wos_lenses", task: "Dashboard lens (V1-5)" },
  { pattern: "/lenses/find", status: "beta", switch: "wos_lenses", task: "Find (M12)" },
  { pattern: "/lenses/embed", status: "beta", switch: "wos_lenses", task: "Query block preview harness (M8e)" },

  // --- Pages, editor, objects ---------------------------------------------
  { pattern: "/pages", status: "beta", switch: "wos_pages", task: "Pages: sidebar tree, favourites, recent (M4a)" },
  { pattern: "/pages/[pageId]", status: "beta", switch: "wos_pages", task: "One page in the block editor (M4b; editor also behind wos_editor)" },
  { pattern: "/objects/[id]", status: "beta", switch: "wos_objects", task: "Any object as a page: its layout's properties, related items, content, comments and versions (M3b, U14)" },
  { pattern: "/collab/objects/[objectId]", status: "migration", switch: "wos_editor", canonical: "/objects/[id]", task: "Collaboration panels for one object (S3b); move onto the object page" },
  { pattern: "/collab/live/[objectId]", status: "migration", switch: "wos_editor", canonical: "/objects/[id]", task: "Presence, cursors and page lock (V1-17); move onto the object page" },
  { pattern: "/collab/versions/[objectId]", status: "migration", switch: "wos_editor", canonical: "/objects/[id]", task: "Autosave and version history (M16a); move onto the object page" },
  { pattern: "/collab/versions/[objectId]/compare", status: "migration", switch: "wos_editor", canonical: "/objects/[id]", task: "Compare and restore versions (M16b); move onto the object page" },
  { pattern: "/collab/trash", status: "beta", switch: "wos_editor", task: "Trash with 30-day restore (M16a)" },
  { pattern: "/collab/layouts", status: "beta", switch: "wos_editor", task: "Object page layouts per type (V2-4)" },
  { pattern: "/collab/layouts/[typeKey]", status: "beta", switch: "wos_editor", task: "Edit one type's page layout (V2-4)" },
  { pattern: "/collab/layouts/[typeKey]/preview", status: "beta", switch: "wos_editor", task: "Preview one type's page layout (V2-4)" },
  { pattern: "/dev/editor-spike", status: "deprecated", canonical: "/pages/[pageId]", task: "W0-5 and W0-6 editor spikes; 404 outside development; remove after wave 1" },

  // --- Capture, following, offline -----------------------------------------
  { pattern: "/capture", status: "beta", switch: "wos_capture", task: "Capture inbox (M18)" },
  { pattern: "/following", status: "beta", switch: "wos_objects", task: "Following and notification rules (V1-14)" },
  { pattern: "/offline", status: "beta", switch: "wos_offline", task: "Offline queue status (V3-1)" },

  // --- Communication --------------------------------------------------------
  { pattern: "/inbox", status: "production", task: "Communication: notification inbox" },
  { pattern: "/channels", status: "production", task: "Channels" },
  { pattern: "/channels/[id]", status: "production", task: "One channel" },
  { pattern: "/messages", status: "production", task: "Direct messages" },
  { pattern: "/messages/[id]", status: "production", task: "One conversation" },
  { pattern: "/saved", status: "production", task: "Saved messages" },
  { pattern: "/announcements", status: "production", task: "Announcements" },

  // --- Work: requests, forms, projects, programs, approvals -----------------
  { pattern: "/requests", status: "production", task: "Intake requests" },
  { pattern: "/approvals", status: "production", task: "Approvals (#143)" },
  { pattern: "/object-approvals/[type]/[id]", status: "beta", switch: "wos_object_approvals", task: "Approvals on any object (V2-7)" },
  { pattern: "/forms", status: "migration", canonical: "/forms-v2", task: "Forms list: the original builder, converted by V1-6" },
  { pattern: "/forms/new", status: "migration", canonical: "/forms-v2/new", task: "New form in the original builder (V1-6)" },
  { pattern: "/forms/[id]", status: "migration", canonical: "/forms-v2/[id]", task: "Fill in a form in the original builder (V1-6)" },
  { pattern: "/forms/[id]/edit", status: "migration", canonical: "/forms-v2/[id]", task: "Edit a form in the original builder (V1-6)" },
  { pattern: "/forms/[id]/submissions", status: "migration", canonical: "/forms-v2/[id]/responses", task: "Submissions of one form (V1-6)" },
  { pattern: "/forms/submissions/[id]", status: "migration", canonical: "/forms-v2/[id]/responses", task: "One submission (V1-6)" },
  { pattern: "/forms-v2", status: "beta", switch: "wos_forms_v2", task: "Forms for any type (V1-6)" },
  { pattern: "/forms-v2/new", status: "beta", switch: "wos_forms_v2", task: "New form (V1-6)" },
  { pattern: "/forms-v2/[id]", status: "beta", switch: "wos_forms_v2", task: "One form (V1-6)" },
  { pattern: "/forms-v2/[id]/responses", status: "beta", switch: "wos_forms_v2", task: "Responses as objects (V1-6)" },
  { pattern: "/projects", status: "production", task: "Projects" },
  { pattern: "/projects/[id]", status: "production", task: "One project; the living project page (M19) lands here" },
  { pattern: "/programs", status: "production", task: "Programs: the daily destination until spaces replace them (M10a)" },
  { pattern: "/programs/[id]", status: "production", task: "One program" },
  { pattern: "/goals", status: "beta", switch: "wos_goals", task: "Goals (V1-11)" },
  { pattern: "/goals/[id]", status: "beta", switch: "wos_goals", task: "One goal (V1-11)" },
  { pattern: "/decisions/[id]", status: "beta", switch: "wos_decisions_v2", task: "One decision with the full record (V1-10)" },
  { pattern: "/decisions/trail/[projectId]", status: "beta", switch: "wos_decisions_v2", task: "Decision trail of a project (V1-10)" },

  // --- Spaces and sharing ---------------------------------------------------
  { pattern: "/spaces", status: "beta", switch: "wos_spaces", task: "Spaces (M10a)" },
  { pattern: "/spaces/[id]", status: "beta", switch: "wos_spaces", task: "One space and its share menu (M10f)" },
  { pattern: "/spaces/roles", status: "admin", switch: "wos_spaces", task: "Custom roles (M10d)" },
  { pattern: "/spaces/admin", status: "admin", switch: "wos_spaces", task: "Admin controls: sign-in rules, audit export, role report (V2-9)" },
  { pattern: "/spaces/publish", status: "admin", switch: "wos_public_pages", task: "Publish and unpublish public pages (V1-18)" },
  { pattern: "/p/[slug]", status: "beta", switch: "wos_public_pages", task: "A public page, read from the published copy (V1-18)" },

  // --- Calendar, meetings, events -------------------------------------------
  { pattern: "/calendar", status: "production", task: "Unified calendar (CAL-001)" },
  { pattern: "/schedule", status: "production", task: "Master schedule (P0-GNT-01)" },
  { pattern: "/meetings", status: "production", task: "Meetings list" },
  { pattern: "/meetings/[id]", status: "migration", canonical: "/meetings-v2/[id]", task: "One meeting: replaced by meetings as objects (V1-9)" },
  { pattern: "/meetings-v2", status: "beta", switch: "wos_meetings_v2", task: "Meetings v2 index (U12)" },
  { pattern: "/meetings-v2/[id]", status: "beta", switch: "wos_meetings_v2", task: "Meeting as an object with semantic notes (V1-9)" },
  { pattern: "/meetings-v2/[id]/review", status: "beta", switch: "wos_meetings_v2", task: "End-of-meeting review (V1-9)" },
  { pattern: "/events", status: "production", task: "Events" },
  { pattern: "/events/[id]", status: "production", task: "One event" },

  // --- Documents, templates, signatures --------------------------------------
  { pattern: "/documents", status: "production", task: "Documents" },
  { pattern: "/documents/[id]", status: "production", task: "One document" },
  { pattern: "/documents/templates", status: "production", task: "Letter, contract and acknowledgement templates (#147)" },
  { pattern: "/templates-v2", status: "beta", switch: "wos_objects", task: "Templates for objects, pages and spaces (V1-13)" },
  { pattern: "/templates-v2/new", status: "beta", switch: "wos_objects", task: "New template (V1-13)" },
  { pattern: "/templates-v2/[id]", status: "beta", switch: "wos_objects", task: "One template (V1-13)" },
  { pattern: "/signatures", status: "production", task: "E-signature requests" },
  { pattern: "/signatures/[id]", status: "production", task: "One signature request" },

  // --- People and relationships ---------------------------------------------
  { pattern: "/people", status: "production", task: "People directory" },
  { pattern: "/people/overview", status: "production", task: "Team overview (#136)" },
  { pattern: "/people/[id]/work", status: "production", task: "One person's work (#136)" },
  { pattern: "/crm", status: "production", task: "Relationships (CRM)" },
  { pattern: "/crm/[id]", status: "production", task: "One contact or organization" },

  // --- Reports and insight ----------------------------------------------------
  { pattern: "/reports", status: "production", task: "Reports" },
  { pattern: "/reports/[id]", status: "production", task: "One report" },
  { pattern: "/insight/dashboards", status: "beta", switch: "wos_lenses", task: "Dashboards per role (V2-5)" },
  { pattern: "/insight/operations", status: "beta", switch: "wos_lenses", task: "Operations analytics (V3-5)" },
  { pattern: "/insight/process", status: "beta", switch: "wos_lenses", task: "How work flows (V3-3)" },
  { pattern: "/insight/what-if", status: "beta", switch: "wos_lenses", task: "What-if timeline (V3-4)" },
  { pattern: "/insight/graph", status: "beta", switch: "wos_lenses", task: "Graph lens (V2-1)" },
  { pattern: "/insight/map", status: "beta", switch: "wos_lenses", task: "Map lens (V2-1)" },

  // --- Workflows, apps, builder, API -------------------------------------------
  { pattern: "/workflows", status: "beta", switch: "wos_workflows_v2", task: "Workflows (M14c)" },
  { pattern: "/workflows/new", status: "beta", switch: "wos_workflows_v2", task: "New workflow (M14c)" },
  { pattern: "/workflows/[id]", status: "beta", switch: "wos_workflows_v2", task: "One workflow and its runs (M14c)" },
  { pattern: "/workflows/[id]/runs/[runId]", status: "beta", switch: "wos_workflows_v2", task: "One run, step by step (V1-12)" },
  { pattern: "/workflows/reviews/[id]", status: "beta", switch: "wos_workflows_v2", task: "A person's review asked for by a workflow (V1-12)" },
  { pattern: "/api-tokens", status: "beta", switch: "wos_workflows_v2", task: "API access tokens (V2-8)" },
  { pattern: "/api-tokens/docs", status: "beta", switch: "wos_workflows_v2", task: "Private API documentation (V2-8)" },
  { pattern: "/apps", status: "beta", switch: "wos_objects", task: "App launcher (V2-3)" },
  { pattern: "/apps/[slug]", status: "beta", switch: "wos_objects", task: "One app (V2-3)" },
  { pattern: "/apps/[slug]/[screen]", status: "beta", switch: "wos_objects", task: "One app screen (V2-3)" },
  { pattern: "/apps/manage/[id]", status: "beta", switch: "wos_objects", task: "Manage one app (V2-3)" },
  { pattern: "/builder", status: "beta", switch: "wos_objects", task: "Blueprint designer (V2-2)" },
  { pattern: "/builder/[id]", status: "beta", switch: "wos_objects", task: "One blueprint (V2-2)" },
  { pattern: "/upkeep", status: "beta", switch: "wos_objects", task: "Workspace upkeep reports (V3-2)" },
  { pattern: "/google", status: "beta", switch: "wos_objects", task: "Google objects: calendar, Drive, Gmail (V1-15)" },
  { pattern: "/google/search", status: "beta", switch: "wos_objects", task: "Search across Google Drive and Gmail (V2-6)" },

  // --- Phone (V1-16) -----------------------------------------------------------
  { pattern: "/m", status: "beta", switch: "wos_mobile", task: "Phone home; redirects to /m/today (V1-16)" },
  { pattern: "/m/today", status: "beta", switch: "wos_mobile", task: "Phone: today (V1-16)" },
  { pattern: "/m/tasks", status: "beta", switch: "wos_mobile", task: "Phone: tasks (V1-16)" },
  { pattern: "/m/inbox", status: "beta", switch: "wos_mobile", task: "Phone: inbox (V1-16)" },
  { pattern: "/m/capture", status: "beta", switch: "wos_mobile", task: "Phone: capture (V1-16)" },
  { pattern: "/m/search", status: "beta", switch: "wos_mobile", task: "Phone: search (V1-16)" },
  { pattern: "/m/approvals", status: "beta", switch: "wos_mobile", task: "Phone: approvals (V1-16)" },

  // --- Settings -------------------------------------------------------------------
  { pattern: "/settings", status: "production", task: "Settings: profile, language, two-step sign-in" },
  { pattern: "/settings/notifications", status: "production", task: "Email and notification settings" },

  // --- Administration (/admin/*) ------------------------------------------------
  { pattern: "/admin", status: "admin", task: "Admin home" },
  { pattern: "/admin/access", status: "admin", task: "Admin: access and roles" },
  { pattern: "/admin/approvals", status: "admin", task: "Admin: approval rules (#143)" },
  { pattern: "/admin/design-system", status: "admin", task: "Admin: component gallery (UI-008)" },
  { pattern: "/admin/email", status: "admin", task: "Admin: email delivery" },
  { pattern: "/admin/exports", status: "admin", task: "Admin: exports" },
  { pattern: "/admin/jobs", status: "admin", task: "Admin: background jobs" },
  { pattern: "/admin/records", status: "admin", task: "Admin: records and legal holds (#146)" },
  { pattern: "/admin/retention", status: "admin", task: "Admin: retention (#146)" },
  { pattern: "/admin/team-signals", status: "admin", task: "Admin: team signals (#136)" },
  { pattern: "/admin/templates", status: "admin", task: "Admin: project, agenda and record templates" },

  // --- Finance (production; registered read-only in the object layer later) ---
  { pattern: "/finance/ledger", status: "production", task: "Ledger home" },
  { pattern: "/finance/ledger/accountant", status: "production", task: "Ledger: accountant view" },
  { pattern: "/finance/ledger/accounts", status: "production", task: "Ledger: chart of accounts" },
  { pattern: "/finance/ledger/funds", status: "production", task: "Ledger: funds" },
  { pattern: "/finance/ledger/funds/release", status: "production", task: "Ledger: release restricted funds" },
  { pattern: "/finance/ledger/general-ledger", status: "production", task: "Ledger: general ledger" },
  { pattern: "/finance/ledger/journal", status: "production", task: "Ledger: journal entries" },
  { pattern: "/finance/ledger/journal/new", status: "production", task: "Ledger: new journal entry" },
  { pattern: "/finance/ledger/journal/[id]", status: "production", task: "Ledger: one journal entry" },
  { pattern: "/finance/ledger/periods", status: "production", task: "Ledger: periods" },
  { pattern: "/finance/ledger/receipts", status: "production", task: "Ledger: receipts" },
  { pattern: "/finance/ledger/returns", status: "production", task: "Ledger: returns" },
  { pattern: "/finance/ledger/statements", status: "production", task: "Ledger: statements" },
  { pattern: "/finance/ledger/trial-balance", status: "production", task: "Ledger: trial balance" },
  { pattern: "/finance/ledger/year-end", status: "production", task: "Ledger: year end" },
  { pattern: "/finance/budgets", status: "production", task: "Budgets" },
  { pattern: "/finance/budgets/programs", status: "production", task: "Budgets by program" },
  { pattern: "/finance/budgets/[id]", status: "production", task: "One budget" },
  { pattern: "/finance/budgets/[id]/report", status: "production", task: "Budget report" },
  { pattern: "/finance/sales-tax", status: "production", task: "GST and QST" },
  { pattern: "/finance/sales-tax/lines", status: "production", task: "GST and QST: lines" },
  { pattern: "/finance/sales-tax/worksheet", status: "production", task: "GST and QST: worksheet" },
  { pattern: "/finance/bank", status: "production", task: "Bank accounts" },
  { pattern: "/finance/bank/[id]", status: "production", task: "One bank account" },
  { pattern: "/finance/bank/reconciliations/[id]", status: "production", task: "One bank reconciliation" },
  { pattern: "/finance/receipts", status: "production", task: "Receipts" },
  { pattern: "/finance/gifts", status: "production", task: "Gifts and grants" },
  { pattern: "/finance/gifts/[id]", status: "production", task: "One gift" },
  { pattern: "/finance/gifts/donors", status: "production", task: "Donors" },
  { pattern: "/finance/gifts/grants", status: "production", task: "Grants" },
  { pattern: "/finance/gifts/grants/[id]", status: "production", task: "One grant" },
  { pattern: "/finance/gifts/statement", status: "production", task: "Donor statement" },
  { pattern: "/finance/payables", status: "production", task: "Bills and invoices" },
  { pattern: "/finance/payables/aging", status: "production", task: "Payables aging" },
  { pattern: "/finance/payables/bills/new", status: "production", task: "New bill" },
  { pattern: "/finance/payables/bills/[id]", status: "production", task: "One bill" },
  { pattern: "/finance/payables/contacts", status: "production", task: "Payables contacts" },
  { pattern: "/finance/payables/invoices", status: "production", task: "Invoices" },
  { pattern: "/finance/payables/invoices/new", status: "production", task: "New invoice" },
  { pattern: "/finance/payables/invoices/[id]", status: "production", task: "One invoice" },
  { pattern: "/finance/payroll", status: "production", task: "Payroll (#177)" },
  { pattern: "/finance/payroll/[id]", status: "production", task: "One payroll run" },
];
