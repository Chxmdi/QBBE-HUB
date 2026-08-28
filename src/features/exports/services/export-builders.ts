import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * What each kind of export actually contains.
 *
 * These run under the **service role**, because the job runner has no user
 * session — which means row-level security is not protecting anything here.
 * Every builder therefore filters by organization explicitly, and the
 * person-data builder filters by subject as well. Getting that wrong would
 * hand somebody a copy of another organization's records, so each query below
 * carries its own scope rather than relying on a caller to add one.
 */

export interface BuildRequest {
  organizationId: string;
  subjectUserId: string | null;
  params: Record<string, unknown>;
}

export interface ExportSection {
  name: string;
  rows: Record<string, unknown>[];
}

export interface BuiltExport {
  sections: ExportSection[];
  rowCount: number;
}

async function section(
  db: SupabaseClient,
  name: string,
  query: PromiseLike<{ data: unknown; error: { message: string } | null }>,
): Promise<ExportSection> {
  const { data, error } = await query;
  if (error) throw new Error(`could not read ${name}: ${error.message}`);
  return { name, rows: (data ?? []) as Record<string, unknown>[] };
}

/** Everything the organization holds, for an audit or a migration away. */
async function organizationData(
  db: SupabaseClient,
  { organizationId }: BuildRequest,
): Promise<ExportSection[]> {
  return Promise.all([
    section(db, "people", db
      .from("user_profile")
      .select("id, full_name, email, title, timezone, created_at")
      .in("id",
        (await db.from("organization_membership")
          .select("user_id").eq("organization_id", organizationId)
        ).data?.map((m) => m.user_id) ?? [])),
    section(db, "programs", db
      .from("program")
      .select("id, name, description, status, created_at")
      .eq("organization_id", organizationId)),
    section(db, "projects", db
      .from("project")
      .select("id, name, outcome, stage, health, start_date, target_date, created_at")
      .eq("organization_id", organizationId)),
    section(db, "tasks", db
      .from("task")
      .select("id, title, status, priority, due_at, completed_at, created_at")
      .eq("organization_id", organizationId)),
    section(db, "meetings", db
      .from("meeting")
      .select("id, title, starts_at, status")
      .eq("organization_id", organizationId)),
    section(db, "decisions", db
      .from("decision")
      .select("id, title, decided_at")
      .eq("organization_id", organizationId)),
    section(db, "risks", db
      .from("risk")
      .select("id, title, likelihood, impact, status, score, created_at")
      .eq("organization_id", organizationId)),
    section(db, "issues", db
      .from("issue")
      .select("id, title, severity, status, created_at")
      .eq("organization_id", organizationId)),
    section(db, "opportunities", db
      .from("opportunity")
      .select("id, title, kind, stage, currency, amount_requested, amount_awarded, decided_at")
      .eq("organization_id", organizationId)),
  ]);
}

/**
 * Everything held about one person — a subject access request.
 *
 * Message bodies are deliberately included: a person asking what is held about
 * them is entitled to what they wrote. Other people's messages are not here,
 * which is why every query filters on the subject rather than on a channel.
 */
async function personData(
  db: SupabaseClient,
  { organizationId, subjectUserId }: BuildRequest,
): Promise<ExportSection[]> {
  if (!subjectUserId) throw new Error("a person export needs a subject");

  return Promise.all([
    section(db, "profile", db
      .from("user_profile")
      .select("id, full_name, email, title, timezone, phone, created_at")
      .eq("id", subjectUserId)),
    section(db, "membership", db
      .from("organization_membership")
      .select("organization_id, role, status, created_at")
      .eq("user_id", subjectUserId)
      .eq("organization_id", organizationId)),
    section(db, "tasks_assigned", db
      .from("task")
      .select("id, title, status, due_at, completed_at, created_at")
      .eq("organization_id", organizationId)
      .eq("assignee_id", subjectUserId)),
    section(db, "messages_written", db
      .from("message")
      .select("id, channel_id, body, created_at")
      .eq("author_id", subjectUserId)
      .is("deleted_at", null)),
    section(db, "notifications", db
      .from("notification")
      .select("id, category, title, created_at, read_at")
      .eq("user_id", subjectUserId)
      .eq("organization_id", organizationId)),
    section(db, "notification_preferences", db
      .from("notification_preference")
      .select("*")
      .eq("user_id", subjectUserId)),
    section(db, "email_deliveries", db
      .from("email_delivery")
      .select("id, subject, status, created_at, sent_at")
      .eq("user_id", subjectUserId)),
  ]);
}

async function crmContacts(
  db: SupabaseClient,
  { organizationId }: BuildRequest,
): Promise<ExportSection[]> {
  return Promise.all([
    section(db, "organizations", db
      .from("crm_organization")
      .select("id, name, category, website, status, notes, created_at")
      .eq("organization_id", organizationId)),
    section(db, "contacts", db
      .from("crm_contact")
      .select("id, crm_organization_id, full_name, role_title, email, phone, status")
      .eq("organization_id", organizationId)),
    section(db, "interactions", db
      .from("crm_interaction")
      .select("id, crm_organization_id, interaction_type, occurred_at, summary, next_steps")
      .eq("organization_id", organizationId)),
  ]);
}

async function taskHistory(
  db: SupabaseClient,
  { organizationId }: BuildRequest,
): Promise<ExportSection[]> {
  return [
    await section(db, "tasks", db
      .from("task")
      .select(
        "id, title, description, status, priority, due_at, completed_at, " +
          "project_id, program_id, assignee_id, created_at",
      )
      .eq("organization_id", organizationId)),
  ];
}

async function reportBundle(
  db: SupabaseClient,
  { organizationId }: BuildRequest,
): Promise<ExportSection[]> {
  return Promise.all([
    section(db, "reports", db
      .from("report_instance")
      .select("id, title, report_type, period_start, period_end, status, created_at")
      .eq("organization_id", organizationId)),
    // Versions rather than the report's mirrored snapshot: the version is the
    // record that was approved, and an export of reports that showed anything
    // else would defeat the point of versioning them.
    section(db, "versions", db
      .from("report_version")
      .select("id, report_id, version_number, snapshot, generated_at")
      .eq("organization_id", organizationId)),
    section(db, "approvals", db
      .from("report_approval")
      .select("id, report_version_id, decision, note, decided_at")
      .eq("organization_id", organizationId)),
  ]);
}

const BUILDERS: Record<
  string,
  (db: SupabaseClient, request: BuildRequest) => Promise<ExportSection[]>
> = {
  organization_data: organizationData,
  person_data: personData,
  crm_contacts: crmContacts,
  task_history: taskHistory,
  report_bundle: reportBundle,
};

export const EXPORT_KINDS = Object.keys(BUILDERS);

export async function buildExport(
  db: SupabaseClient,
  kind: string,
  request: BuildRequest,
): Promise<BuiltExport> {
  const builder = BUILDERS[kind];
  if (!builder) throw new Error(`no builder for export kind "${kind}"`);
  const sections = await builder(db, request);
  return {
    sections,
    rowCount: sections.reduce((total, s) => total + s.rows.length, 0),
  };
}

/**
 * The file itself: JSON, one object with a section per key.
 *
 * JSON rather than CSV because these exports are nested and heterogeneous — a
 * subject access request holds profile fields, messages and delivery records
 * that share no columns, and flattening them into one sheet would lose the
 * shape a reader needs. The single-report CSV route still exists for the case
 * where a spreadsheet is what somebody wants.
 */
export function serializeExport(
  built: BuiltExport,
  meta: Record<string, unknown>,
): string {
  const body: Record<string, unknown> = { exported: meta };
  for (const s of built.sections) body[s.name] = s.rows;
  return JSON.stringify(body, null, 2);
}
