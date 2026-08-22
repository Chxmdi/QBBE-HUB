import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/page-header";
import { EntityFormDialog } from "@/components/shared/entity-form-dialog";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { AdminNav } from "@/features/admin/components/admin-nav";
import {
  MemberActiveToggle,
  MemberRoleSelect,
  RevokeInvitationButton,
} from "@/features/admin/components/member-controls";
import { InviteUserDialog } from "@/features/admin/components/invite-user-dialog";
import { TransferOwnershipButton } from "@/features/admin/components/transfer-ownership-button";
import { IntegrationActions } from "@/features/admin/components/integration-actions";
import { TeamMemberControls } from "@/features/admin/components/team-member-controls";
import { createTeam } from "@/features/admin/services/team.commands";
import { createWorkflowRule } from "@/features/admin/services/workflow.commands";
import { integrationHealthLabel, integrationHealthTone } from "@/features/admin/services/integration-health";
import { requireAdmin } from "@/lib/auth";
import { transactionalEmailIsLive } from "@/features/notifications/services/email-provider";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatDate, relativeTime } from "@/lib/utils";
import type { Membership } from "@/types/entities";

export const metadata: Metadata = { title: "Admin" };
export const dynamic = "force-dynamic";

interface InvitationRow {
  id: string;
  email: string;
  intended_role: string;
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

interface AuditRow {
  id: string;
  actor_id: string | null;
  event_type: string;
  action: string;
  object_type: string | null;
  created_at: string;
  actor?: { full_name: string } | null;
}

interface IntegrationRow {
  provider: string;
  status: string;
  last_sync_at: string | null;
  last_error: string | null;
}

interface WorkflowExecutionRow {
  id: string;
  rule_name: string;
  trigger_event: string;
  outcome: string;
  recipient_count: number;
  detail: string | null;
  created_at: string;
}

interface JobRunRow {
  id: string;
  job_name: string;
  status: string;
  error: string | null;
  finished_at: string;
}

const INTEGRATION_CATALOG = [
  {
    provider: "gmail",
    name: "Gmail",
    description: "Unified inbox email sync. Requires Google OAuth credentials and consent review.",
  },
  {
    provider: "google_calendar",
    name: "Google Calendar",
    description: "Calendar overlay and meeting sync with scoped OAuth.",
  },
  {
    provider: "google_drive",
    name: "Google Drive",
    description: "Metadata sync for Drive resources. Opening a resource respects its Drive sharing controls.",
  },
  {
    provider: "volunteer_system",
    name: "Volunteer Management System",
    description: "Volunteer identity/availability references. Server-to-server integration boundary.",
  },
  {
    provider: "email",
    name: "Transactional email",
    description:
      "Notification and digest delivery. The pipeline is live; see Admin → Email for the delivery ledger and the transport currently in use.",
  },
];

export default async function AdminPage() {
  const session = await requireAdmin();
  const supabase = await createSupabaseServerClient();

  const [
    { data: members },
    { data: invitations },
    { data: audit },
    { data: integrations },
    { data: teams },
    { data: teamMembers },
    { data: rules },
    { data: jobRuns },
    { data: workflowRuns },
  ] =
    await Promise.all([
      supabase
        .from("organization_membership")
        .select(
          "id, organization_id, user_id, role, status, joined_at, user_profile:user_id(id, full_name, email, avatar_url, title, timezone)",
        )
        .order("joined_at"),
      supabase
        .from("invitation")
        .select("id, email, intended_role, expires_at, accepted_at, revoked_at, created_at")
        .order("created_at", { ascending: false })
        .limit(20),
      supabase
        .from("audit_event")
        .select(
          "id, actor_id, event_type, action, object_type, created_at, actor:actor_id(full_name)",
        )
        .order("created_at", { ascending: false })
        .limit(30),
      supabase
        .from("integration_connection")
        .select("provider, status, last_sync_at, last_error"),
      supabase.from("team").select("id, name, description").order("name"),
      supabase.from("team_member").select("team_id, user_id"),
      supabase
        .from("workflow_rule")
        .select("id, name, enabled, trigger_event")
        .order("created_at", { ascending: false }),
      supabase
        .from("background_job_run")
        .select("id, job_name, status, error, finished_at")
        .order("finished_at", { ascending: false })
        .limit(20),
      supabase
        .from("workflow_execution")
        .select("id, rule_name, trigger_event, outcome, recipient_count, detail, created_at")
        .order("created_at", { ascending: false })
        .limit(20),
    ]);

  const memberList = ((members ?? []) as unknown as Membership[]).filter(
    (m) => m.user_profile,
  );
  const invitationList = (invitations ?? []) as InvitationRow[];
  const auditList = (audit ?? []) as unknown as AuditRow[];
  const integrationMap = new Map(
    ((integrations ?? []) as IntegrationRow[]).map((i) => [i.provider, i]),
  );
  const emailConfigured = transactionalEmailIsLive();
  const googleConfigured = Boolean(
    process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET,
  );
  const vmsConfigured = Boolean(process.env.VMS_API_URL);
  const teamList = (teams ?? []) as { id: string; name: string; description: string | null }[];
  const teamMemberList = (teamMembers ?? []) as { team_id: string; user_id: string }[];
  const ruleList = (rules ?? []) as {
    id: string;
    name: string;
    enabled: boolean;
    trigger_event: string;
  }[];
  const jobRunList = (jobRuns ?? []) as JobRunRow[];
  const workflowRunList = (workflowRuns ?? []) as WorkflowExecutionRow[];

  return (
    <div>
      <PageHeader
        eyebrow="Administration"
        title="Admin"
        description="Users, access, invitations, integrations, and the audit trail."
        actions={
          <InviteUserDialog emailConfigured={emailConfigured} />
        }
      />
      <AdminNav />

      <div className="space-y-10">
        {/* Members (P0-ADM-01, P0-PPL-03) */}
        <section aria-labelledby="admin-members">
          <h2 id="admin-members" className="section-heading mb-3">
            Members
          </h2>
          <div className="card overflow-hidden">
            <div className="overflow-x-auto [contain:paint]">
              <table className="w-full text-left text-[13.5px]">
                <thead>
                  <tr className="border-b border-line bg-surface-soft/60">
                    <th scope="col" className="px-4 py-2.5 font-semibold">Person</th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">Role</th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">Status</th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">Joined</th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {memberList.map((member) => {
                    const profile = member.user_profile!;
                    return (
                      <tr key={member.id} className="border-b border-line last:border-b-0">
                        <td className="px-4 py-3">
                          <span className="flex items-center gap-2.5">
                            <Avatar name={profile.full_name} src={profile.avatar_url} size="md" />
                            <span>
                              <span className="block font-medium">{profile.full_name}</span>
                              <span className="meta">{profile.email}</span>
                            </span>
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <MemberRoleSelect membershipId={member.id} role={member.role} />
                        </td>
                        <td className="px-4 py-3">
                          <Badge tone={member.status === "active" ? "success" : "neutral"}>
                            {member.status}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-muted">
                          {formatDate(member.joined_at)}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-col items-end gap-1">
                            <MemberActiveToggle
                              membershipId={member.id}
                              active={member.status === "active"}
                              isOwner={member.role === "owner"}
                              isSelf={member.user_id === session.userId}
                            />
                            {session.role === "owner" &&
                            member.role !== "owner" &&
                            member.status === "active" ? (
                              <TransferOwnershipButton
                                membershipId={member.id}
                                name={profile.full_name}
                              />
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section aria-labelledby="admin-job-runs">
          <h2 id="admin-job-runs" className="section-heading mb-3">Background jobs</h2>
          {jobRunList.length === 0 ? (
            <p className="card px-4 py-6 text-center text-[13px] text-muted">
              No completed background jobs have been recorded for this organization yet.
            </p>
          ) : (
            <ul className="card divide-y divide-line">
              {jobRunList.map((run) => (
                <li key={run.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-[13px]">
                  <span className="min-w-36 font-medium">{run.job_name.replaceAll("_", " ")}</span>
                  <Badge tone={run.status === "succeeded" ? "success" : "danger"}>{run.status}</Badge>
                  <span className="meta ml-auto">{relativeTime(run.finished_at)}</span>
                  {run.error ? <p className="basis-full text-[12.5px] text-danger-fg">{run.error}</p> : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Invitations (AUTH-007) */}
        <section aria-labelledby="admin-invitations">
          <h2 id="admin-invitations" className="section-heading mb-3">
            Invitations
          </h2>
          {!emailConfigured ? (
            <p className="mb-3 rounded-(--radius-sm) bg-warning/10 px-3 py-2 text-[13px] text-warning-fg">
              Invite recorded — email not sent, until EMAIL_PROVIDER_API_KEY is
              configured. The row still assigns the intended role on sign-up.
            </p>
          ) : null}
          {invitationList.length === 0 ? (
            <p className="card px-4 py-6 text-center text-[13px] text-muted">
              No invitations yet. Invited users get their intended role on sign-up.
            </p>
          ) : (
            <ul className="card divide-y divide-line">
              {invitationList.map((invitation) => {
                const expired = new Date(invitation.expires_at) < new Date();
                const state = invitation.accepted_at
                  ? "accepted"
                  : invitation.revoked_at
                    ? "revoked"
                    : expired
                      ? "expired"
                      : "pending";
                return (
                  <li key={invitation.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                    <span className="min-w-0 flex-1 basis-48">
                      <span className="block truncate text-[13.5px] font-medium">
                        {invitation.email}
                      </span>
                      <span className="meta">
                        {invitation.intended_role} · invited {relativeTime(invitation.created_at)}
                      </span>
                    </span>
                    <Badge
                      tone={
                        state === "accepted"
                          ? "success"
                          : state === "pending"
                            ? "info"
                            : "neutral"
                      }
                    >
                      {state}
                    </Badge>
                    {state === "pending" ? (
                      <RevokeInvitationButton invitationId={invitation.id} />
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* Integration center (P0-ADM-04) — honest connection states */}
        <section aria-labelledby="admin-integrations">
          <h2 id="admin-integrations" className="section-heading mb-3">
            Integrations
          </h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {INTEGRATION_CATALOG.map((integration) => {
              const connection = integrationMap.get(integration.provider);
              const connected =
                integration.provider === "email"
                  ? emailConfigured
                  : connection?.status === "connected";
              const status = integration.provider === "email"
                ? (emailConfigured ? "connected" : "configuration_required")
                : connection?.status;
              return (
                <div key={integration.provider} className="card p-4">
                  <div className="mb-1 flex items-center justify-between">
                    <p className="text-[14px] font-semibold">{integration.name}</p>
                    <Badge tone={integrationHealthTone(status)}>
                      {integrationHealthLabel(status)}
                    </Badge>
                  </div>
                  <p className="text-[13px] text-muted">{integration.description}</p>
                  <IntegrationActions
                    provider={integration.provider as "gmail" | "google_calendar" | "google_drive" | "volunteer_system" | "email"}
                    connected={
                      integration.provider === "email"
                        ? emailConfigured
                        : connected
                    }
                    status={status}
                    googleConfigured={googleConfigured}
                    vmsConfigured={vmsConfigured}
                  />
                  {connection?.last_sync_at ? (
                    <p className="meta mt-1.5">
                      Last sync {relativeTime(connection.last_sync_at)}
                    </p>
                  ) : null}
                  {connection?.last_error ? (
                    <p className="mt-1.5 text-[12.5px] text-danger-fg">{connection.last_error}</p>
                  ) : null}
                </div>
              );
            })}
          </div>
        </section>

        <section aria-labelledby="admin-teams">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 id="admin-teams" className="section-heading">
              Teams
            </h2>
            <EntityFormDialog
              triggerLabel="Create team"
              triggerVariant="secondary"
              title="Create team"
              submitLabel="Create"
              action={createTeam}
              fields={[
                { name: "name", label: "Name", type: "text", required: true },
                { name: "description", label: "Description", type: "textarea" },
              ]}
            />
          </div>
          {teamList.length === 0 ? (
            <p className="card px-4 py-6 text-center text-[13px] text-muted">
              No teams yet. Create a team to group people and auto-provision a
              private team channel.
            </p>
          ) : (
            <ul className="space-y-3">
              {teamList.map((team) => {
                const membersOfTeam = teamMemberList.filter((m) => m.team_id === team.id);
                return (
                  <li key={team.id} className="card p-4">
                    <p className="text-[14px] font-semibold">{team.name}</p>
                    {team.description ? (
                      <p className="meta mb-2">{team.description}</p>
                    ) : null}
                    <ul className="mt-2 space-y-1.5">
                      {memberList
                        .filter((m) => m.status === "active" && m.user_profile)
                        .map((m) => {
                          const isMember = membersOfTeam.some((tm) => tm.user_id === m.user_id);
                          return (
                            <li key={m.id} className="flex items-center justify-between gap-2">
                              <span className="text-[13px]">{m.user_profile!.full_name}</span>
                              <TeamMemberControls
                                teamId={team.id}
                                userId={m.user_id}
                                isMember={isMember}
                                label={isMember ? "member" : m.user_profile!.full_name.split(" ")[0] ?? "person"}
                              />
                            </li>
                          );
                        })}
                    </ul>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section aria-labelledby="admin-workflows">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 id="admin-workflows" className="section-heading">
              Workflow rules
            </h2>
            <EntityFormDialog
              triggerLabel="Add rule"
              triggerVariant="secondary"
              title="Workflow rule"
              submitLabel="Create"
              action={createWorkflowRule}
              fields={[
                { name: "name", label: "Name", type: "text", required: true },
                {
                  name: "triggerEvent",
                  label: "When",
                  type: "select",
                  required: true,
                  defaultValue: "task_status_changed",
                  options: [
                    { value: "task_status_changed", label: "Task status changes" },
                    { value: "announcement_published", label: "Announcement published" },
                    { value: "project_health_changed", label: "Project health changes" },
                    { value: "meeting_completed", label: "Meeting completed" },
                    { value: "event_assignment_created", label: "Event role assigned" },
                  ],
                },
                {
                  name: "conditionStatus",
                  label: "Status (optional)",
                  type: "text",
                  placeholder: "completed",
                },
                {
                  name: "actionCategory",
                  label: "Then",
                  type: "select",
                  required: true,
                  defaultValue: "notify_assignee",
                  options: [
                    { value: "notify_assignee", label: "Notify assignee" },
                    { value: "notify_admins", label: "Notify admins" },
                    { value: "notify_event_owner", label: "Notify event owner" },
                    { value: "notify_team", label: "Notify a team" },
                  ],
                },
                {
                  name: "actionTeamId",
                  label: "Team to notify",
                  type: "select",
                  hint: "Required only when “Notify a team” is selected.",
                  options: teamList.map((team) => ({ value: team.id, label: team.name })),
                },
              ]}
            />
          </div>
          {ruleList.length === 0 ? (
            <p className="card px-4 py-6 text-center text-[13px] text-muted">
              No workflow rules yet. A rule watches for one kind of Hub event
              and notifies the people you choose when it happens.
            </p>
          ) : (
            <ul className="card divide-y divide-line">
              {ruleList.map((rule) => (
                <li key={rule.id} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="min-w-0 flex-1 text-[13.5px] font-medium">{rule.name}</span>
                  <Badge tone={rule.enabled ? "success" : "neutral"}>
                    {rule.enabled ? "On" : "Off"}
                  </Badge>
                  <span className="meta">{rule.trigger_event.replace(/_/g, " ")}</span>
                </li>
              ))}
            </ul>
          )}

          {/* Why did this fire? — the automation's own record. */}
          <h3 className="section-heading mt-6 mb-3 text-[13px]">Recent runs</h3>
          {workflowRunList.length === 0 ? (
            <p className="card px-4 py-5 text-center text-[13px] text-muted">
              Nothing has triggered a rule yet. Every run is recorded here with
              who it reached.
            </p>
          ) : (
            <ul className="card divide-y divide-line">
              {workflowRunList.map((run) => (
                <li key={run.id} className="px-4 py-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 flex-1 text-[13.5px] font-medium">
                      {run.rule_name}
                    </span>
                    <Badge
                      tone={
                        run.outcome === "notified"
                          ? "success"
                          : run.outcome === "failed"
                            ? "danger"
                            : "neutral"
                      }
                    >
                      {run.outcome === "notified"
                        ? `notified ${run.recipient_count}`
                        : run.outcome}
                    </Badge>
                    <span className="meta whitespace-nowrap">
                      {relativeTime(run.created_at)}
                    </span>
                  </div>
                  <span className="meta">
                    {run.trigger_event.replace(/_/g, " ")}
                    {run.detail ? ` \u00b7 ${run.detail}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Audit history (P0-ADM-03) */}
        <section aria-labelledby="admin-audit">
          <h2 id="admin-audit" className="section-heading mb-3">
            Audit history
          </h2>
          {auditList.length === 0 ? (
            <p className="card px-4 py-6 text-center text-[13px] text-muted">
              Material access, channel, project, export, and deletion events are
              recorded here with actor and timestamp.
            </p>
          ) : (
            <ol className="card divide-y divide-line">
              {auditList.map((event) => (
                <li key={event.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                  <span className="min-w-0 flex-1 text-[13px]">
                    <span className="font-medium">
                      {event.actor?.full_name ?? "System"}
                    </span>{" "}
                    · {event.action.replace(/_/g, " ")}
                    {event.object_type ? (
                      <span className="text-muted"> ({event.object_type})</span>
                    ) : null}
                  </span>
                  <Badge tone="neutral">{event.event_type}</Badge>
                  <span className="meta whitespace-nowrap">
                    {relativeTime(event.created_at)}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </div>
  );
}
