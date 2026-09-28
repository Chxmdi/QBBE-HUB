import type { Metadata } from "next";
import Link from "next/link";
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
import { VmsIdentityLinkControl } from "@/features/admin/components/vms-identity-link-control";
import { TeamMemberControls } from "@/features/admin/components/team-member-controls";
import { TeamOwnerControl } from "@/features/admin/components/team-owner-control";
import { createTeam } from "@/features/admin/services/team.commands";
import { createWorkflowRule } from "@/features/admin/services/workflow.commands";
import {
  integrationHealthLabel,
  integrationHealthTone,
} from "@/features/admin/services/integration-health";
import { requireAdminAal2 } from "@/lib/auth";
import { transactionalEmailIsLive } from "@/features/notifications/services/email-provider";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getFormatters, getT } from "@/lib/i18n/server";
import { labelOr, roleCodeLabel, triggerEventLabel } from "@/features/admin/labels";
import type { Membership } from "@/types/entities";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("admin.workspace.title") };
}
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

const INTEGRATION_PROVIDERS = [
  "gmail",
  "google_calendar",
  "google_drive",
  "volunteer_system",
  "email",
] as const;

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ audit?: string; auditPage?: string }>;
}) {
  const session = await requireAdminAal2();
  const t = await getT();
  // Audit codes are written by the app and by database triggers. Known ones
  // read in the interface language; one this list has not caught up with is
  // shown as recorded, marked as English.
  const auditCode = (group: "eventTypes" | "actions" | "objects", code: string, shown: string) => {
    const key = `admin.workspace.audit.${group}.${code.replace(/\./g, "_")}`;
    const label = labelOr(t, key, "");
    return label ? label : <span lang="en" translate="no">{shown}</span>;
  };
  const format = await getFormatters();
  const params = await searchParams;
  const auditPage = Math.max(1, Number(params.auditPage) || 1);
  const auditFilter =
    params.audit && params.audit !== "all" ? params.audit : null;
  const supabase = await createSupabaseServerClient();

  const [
    { data: members },
    { data: invitations },
    { data: audit, count: auditCount },
    { data: integrations },
    { data: teams },
    { data: teamMembers },
    { data: rules },
    { data: jobRuns },
    { data: workflowRuns },
  ] = await Promise.all([
    supabase
      .from("organization_membership")
      .select(
        "id, organization_id, user_id, role, status, joined_at, user_profile:user_id(id, full_name, email, avatar_url, title, timezone, vms_id, vms_availability, vms_synced_at)",
      )
      .order("joined_at"),
    supabase
      .from("invitation")
      .select(
        "id, email, intended_role, expires_at, accepted_at, revoked_at, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(20),
    (() => {
      let auditQuery = supabase
        .from("audit_event")
        .select(
          // No embed: audit_event.actor_id has no foreign key to user_profile,
          // so PostgREST cannot join it and the whole query fails — which
          // showed an empty history. Names come from the member list below.
          "id, actor_id, event_type, action, object_type, created_at",
          { count: "exact" },
        )
        .order("created_at", { ascending: false })
        .range((auditPage - 1) * 30, auditPage * 30 - 1);
      if (auditFilter) auditQuery = auditQuery.eq("event_type", auditFilter);
      return auditQuery;
    })(),
    supabase
      .from("integration_connection")
      .select("provider, status, last_sync_at, last_error"),
    supabase
      .from("team")
      .select("id, name, description, owner_id")
      .order("name"),
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
      .select(
        "id, rule_name, trigger_event, outcome, recipient_count, detail, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  const memberList = ((members ?? []) as unknown as Membership[]).filter(
    (m) => m.user_profile,
  );
  const invitationList = (invitations ?? []) as InvitationRow[];
  const actorNames = new Map(
    (
      (members ?? []) as unknown as {
        user_id: string;
        user_profile: { full_name: string } | null;
      }[]
    ).map((m) => [m.user_id, m.user_profile?.full_name ?? null]),
  );
  const auditList = ((audit ?? []) as unknown as AuditRow[]).map((event) => ({
    ...event,
    actor:
      event.actor_id && actorNames.get(event.actor_id)
        ? { full_name: actorNames.get(event.actor_id) as string }
        : null,
  }));
  const integrationMap = new Map(
    ((integrations ?? []) as IntegrationRow[]).map((i) => [i.provider, i]),
  );
  const emailConfigured = transactionalEmailIsLive();
  const googleConfigured = Boolean(
    process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET,
  );
  const vmsConfigured = Boolean(process.env.VMS_API_URL);
  const teamList = (teams ?? []) as {
    id: string;
    name: string;
    description: string | null;
    owner_id: string;
  }[];
  const teamMemberList = (teamMembers ?? []) as {
    team_id: string;
    user_id: string;
  }[];
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
        eyebrow={t("admin.eyebrow")}
        title={t("admin.workspace.title")}
        description={t("admin.workspace.description")}
        actions={<InviteUserDialog emailConfigured={emailConfigured} />}
      />
      <AdminNav />

      <div className="space-y-10">
        {/* Members (P0-ADM-01, P0-PPL-03) */}
        <section aria-labelledby="admin-members">
          <h2 id="admin-members" className="section-heading mb-3">
            {t("admin.workspace.members.heading")}
          </h2>
          <div className="card overflow-hidden">
            <div className="overflow-x-auto [contain:paint]">
              <table className="w-full text-left text-[13.5px]">
                <thead>
                  <tr className="border-b border-line bg-surface-soft/60">
                    <th scope="col" className="px-4 py-2.5 font-semibold">
                      {t("admin.workspace.members.person")}
                    </th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">
                      {t("admin.workspace.members.role")}
                    </th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">
                      {t("admin.workspace.members.status")}
                    </th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">
                      {t("admin.workspace.members.vms")}
                    </th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">
                      {t("admin.workspace.members.joined")}
                    </th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">
                      <span className="sr-only">{t("admin.workspace.members.actions")}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {memberList.map((member) => {
                    const profile =
                      member.user_profile! as typeof member.user_profile & {
                        id: string;
                        vms_id?: string | null;
                        vms_availability?: string | null;
                        vms_synced_at?: string | null;
                      };
                    return (
                      <tr
                        key={member.id}
                        className="border-b border-line last:border-b-0"
                      >
                        <td className="px-4 py-3">
                          <span className="flex items-center gap-2.5">
                            <Avatar
                              name={profile.full_name}
                              src={profile.avatar_url}
                              size="md"
                            />
                            <span>
                              <span className="block font-medium">
                                {profile.full_name}
                              </span>
                              <span className="meta">{profile.email}</span>
                            </span>
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <MemberRoleSelect
                            membershipId={member.id}
                            role={member.role}
                          />
                        </td>
                        <td className="px-4 py-3">
                          <Badge
                            tone={
                              member.status === "active" ? "success" : "neutral"
                            }
                          >
                            {labelOr(t, `admin.workspace.members.statuses.${member.status}`, member.status)}
                          </Badge>
                        </td>
                        <td className="px-4 py-3">
                          <VmsIdentityLinkControl
                            userId={profile.id}
                            vmsId={profile.vms_id ?? null}
                            availability={profile.vms_availability ?? null}
                          />
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-muted">
                          {format.date(member.joined_at)}
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
          <h2 id="admin-job-runs" className="section-heading mb-3">
            {t("admin.workspace.jobs.heading")}
          </h2>
          {jobRunList.length === 0 ? (
            <p className="card px-4 py-6 text-center text-[13px] text-muted">
              {t("admin.workspace.jobs.empty")}
            </p>
          ) : (
            <ul className="card divide-y divide-line">
              {jobRunList.map((run) => (
                <li
                  key={run.id}
                  className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-[13px]"
                >
                  <span className="min-w-36 font-medium">
                    {run.job_name.replaceAll("_", " ")}
                  </span>
                  <Badge
                    tone={run.status === "succeeded" ? "success" : "danger"}
                  >
                    {labelOr(t, `admin.workspace.jobs.statuses.${run.status}`, run.status)}
                  </Badge>
                  <span className="meta ml-auto">
                    {format.relative(run.finished_at)}
                  </span>
                  {run.error ? (
                    <p className="basis-full text-[12.5px] text-danger-fg">
                      {run.error}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Invitations (AUTH-007) */}
        <section aria-labelledby="admin-invitations">
          <h2 id="admin-invitations" className="section-heading mb-3">
            {t("admin.workspace.invitations.heading")}
          </h2>
          {!emailConfigured ? (
            <p className="mb-3 rounded-(--radius-sm) bg-warning/10 px-3 py-2 text-[13px] text-warning-fg">
              {t("admin.workspace.invitations.emailNotConfigured")}
            </p>
          ) : null}
          {invitationList.length === 0 ? (
            <p className="card px-4 py-6 text-center text-[13px] text-muted">
              {t("admin.workspace.invitations.empty")}
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
                  <li
                    key={invitation.id}
                    className="flex flex-wrap items-center gap-3 px-4 py-2.5"
                  >
                    <span className="min-w-0 flex-1 basis-48">
                      <span className="block truncate text-[13.5px] font-medium">
                        {invitation.email}
                      </span>
                      <span className="meta">
                        {t("admin.workspace.invitations.invited", {
                          role: roleCodeLabel(invitation.intended_role, t),
                          when: format.relative(invitation.created_at),
                        })}
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
                      {t(`admin.workspace.invitations.states.${state}`)}
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
            {t("admin.workspace.integrations.heading")}
          </h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {INTEGRATION_PROVIDERS.map((provider) => {
              const integration = {
                provider,
                name: t(`admin.workspace.integrations.${provider}.name`),
                description: t(`admin.workspace.integrations.${provider}.description`),
              };
              const connection = integrationMap.get(integration.provider);
              const connected =
                integration.provider === "email"
                  ? emailConfigured
                  : connection?.status === "connected";
              const status =
                integration.provider === "email"
                  ? emailConfigured
                    ? "connected"
                    : "configuration_required"
                  : connection?.status;
              return (
                <div key={integration.provider} className="card p-4">
                  <div className="mb-1 flex items-center justify-between">
                    <p className="text-[14px] font-semibold">
                      {integration.name}
                    </p>
                    <Badge tone={integrationHealthTone(status)}>
                      {integrationHealthLabel(status, t)}
                    </Badge>
                  </div>
                  <p className="text-[13px] text-muted">
                    {integration.description}
                  </p>
                  <IntegrationActions
                    provider={integration.provider}
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
                      {t("admin.workspace.integrations.lastSync", {
                        when: format.relative(connection.last_sync_at),
                      })}
                    </p>
                  ) : null}
                  {connection?.last_error ? (
                    <p className="mt-1.5 text-[12.5px] text-danger-fg">
                      {connection.last_error}
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>
        </section>

        <section aria-labelledby="admin-teams">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 id="admin-teams" className="section-heading">
              {t("admin.workspace.teams.heading")}
            </h2>
            <EntityFormDialog
              triggerLabel={t("admin.workspace.teams.create")}
              triggerVariant="secondary"
              title={t("admin.workspace.teams.create")}
              submitLabel={t("admin.workspace.teams.submit")}
              action={createTeam}
              fields={[
                { name: "name", label: t("admin.workspace.teams.name"), type: "text", required: true },
                { name: "description", label: t("admin.workspace.teams.description"), type: "textarea" },
                {
                  name: "ownerId",
                  label: t("admin.workspace.teams.owner"),
                  type: "select",
                  required: true,
                  defaultValue: session.userId,
                  options: memberList
                    .filter(
                      (member) =>
                        member.status === "active" && member.user_profile,
                    )
                    .map((member) => ({
                      value: member.user_id,
                      label: member.user_profile!.full_name,
                    })),
                },
              ]}
            />
          </div>
          {teamList.length === 0 ? (
            <p className="card px-4 py-6 text-center text-[13px] text-muted">
              {t("admin.workspace.teams.empty")}
            </p>
          ) : (
            <ul className="space-y-3">
              {teamList.map((team) => {
                const membersOfTeam = teamMemberList.filter(
                  (m) => m.team_id === team.id,
                );
                return (
                  <li key={team.id} className="card p-4">
                    <p className="text-[14px] font-semibold">{team.name}</p>
                    {team.description ? (
                      <p className="meta mb-2">{team.description}</p>
                    ) : null}
                    <TeamOwnerControl
                      key={`${team.id}:${team.owner_id}`}
                      teamId={team.id}
                      currentOwnerId={team.owner_id}
                      members={memberList
                        .filter(
                          (member) =>
                            member.status === "active" && member.user_profile,
                        )
                        .map((member) => ({
                          id: member.user_id,
                          name: member.user_profile!.full_name,
                        }))}
                    />
                    <ul className="mt-2 space-y-1.5">
                      {memberList
                        .filter((m) => m.status === "active" && m.user_profile)
                        .map((m) => {
                          const isMember = membersOfTeam.some(
                            (tm) => tm.user_id === m.user_id,
                          );
                          return (
                            <li
                              key={m.id}
                              className="flex items-center justify-between gap-2"
                            >
                              <span className="text-[13px]">
                                {m.user_profile!.full_name}
                              </span>
                              <TeamMemberControls
                                teamId={team.id}
                                userId={m.user_id}
                                isMember={isMember}
                                label={
                                  isMember
                                    ? t("admin.workspace.teams.memberLabel")
                                    : (m.user_profile!.full_name.split(
                                        " ",
                                      )[0] ?? t("admin.workspace.teams.personLabel"))
                                }
                                isOwner={team.owner_id === m.user_id}
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
              {t("admin.workspace.workflows.heading")}
            </h2>
            <EntityFormDialog
              triggerLabel={t("admin.workspace.workflows.add")}
              triggerVariant="secondary"
              title={t("admin.workspace.workflows.dialogTitle")}
              submitLabel={t("admin.workspace.workflows.submit")}
              action={createWorkflowRule}
              fields={[
                { name: "name", label: t("admin.workspace.workflows.name"), type: "text", required: true },
                {
                  name: "triggerEvent",
                  label: t("admin.workspace.workflows.when"),
                  type: "select",
                  required: true,
                  defaultValue: "task_status_changed",
                  options: (
                    [
                      "task_status_changed",
                      "announcement_published",
                      "project_health_changed",
                      "meeting_completed",
                      "event_assignment_created",
                    ] as const
                  ).map((value) => ({
                    value,
                    label: t(`admin.workspace.workflows.triggers.${value}`),
                  })),
                },
                {
                  name: "conditionStatus",
                  label: t("admin.workspace.workflows.statusOptional"),
                  type: "text",
                  placeholder: t("admin.workspace.workflows.statusPlaceholder"),
                },
                {
                  name: "actionCategory",
                  label: t("admin.workspace.workflows.then"),
                  type: "select",
                  required: true,
                  defaultValue: "notify_assignee",
                  options: (
                    [
                      "notify_assignee",
                      "notify_admins",
                      "notify_event_owner",
                      "notify_team",
                    ] as const
                  ).map((value) => ({
                    value,
                    label: t(`admin.workspace.workflows.actions.${value}`),
                  })),
                },
                {
                  name: "actionTeamId",
                  label: t("admin.workspace.workflows.teamToNotify"),
                  type: "select",
                  hint: t("admin.workspace.workflows.teamHint"),
                  options: teamList.map((team) => ({
                    value: team.id,
                    label: team.name,
                  })),
                },
              ]}
            />
          </div>
          {ruleList.length === 0 ? (
            <p className="card px-4 py-6 text-center text-[13px] text-muted">
              {t("admin.workspace.workflows.empty")}
            </p>
          ) : (
            <ul className="card divide-y divide-line">
              {ruleList.map((rule) => (
                <li
                  key={rule.id}
                  className="flex items-center gap-3 px-4 py-2.5"
                >
                  <span className="min-w-0 flex-1 text-[13.5px] font-medium">
                    {rule.name}
                  </span>
                  <Badge tone={rule.enabled ? "success" : "neutral"}>
                    {rule.enabled
                      ? t("admin.workspace.workflows.on")
                      : t("admin.workspace.workflows.off")}
                  </Badge>
                  <span className="meta">
                    {triggerEventLabel(rule.trigger_event, t)}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {/* Why did this fire? — the automation's own record. */}
          <h3 className="section-heading mt-6 mb-3 text-[13px]">
            {t("admin.workspace.workflows.recentRuns")}
          </h3>
          {workflowRunList.length === 0 ? (
            <p className="card px-4 py-5 text-center text-[13px] text-muted">
              {t("admin.workspace.workflows.runsEmpty")}
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
                        ? t("admin.workspace.workflows.outcomes.notified", {
                            count: run.recipient_count,
                          })
                        : labelOr(
                            t,
                            `admin.workspace.workflows.outcomes.${run.outcome}`,
                            run.outcome,
                          )}
                    </Badge>
                    <span className="meta whitespace-nowrap">
                      {format.relative(run.created_at)}
                    </span>
                  </div>
                  <span className="meta">
                    {triggerEventLabel(run.trigger_event, t)}
                    {run.detail ? ` \u00b7 ${run.detail}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="admin-audit">
          <h2 id="admin-audit" className="section-heading mb-3">
            {t("admin.workspace.audit.heading")}
          </h2>
          <div className="mb-3 flex flex-wrap gap-2">
            {[
              ["all", t("admin.workspace.audit.filters.all")],
              ["task.assignment", t("admin.workspace.audit.filters.assignment")],
              ["task.status", t("admin.workspace.audit.filters.status")],
              ["task.due_date", t("admin.workspace.audit.filters.dueDate")],
              ["project.health", t("admin.workspace.audit.filters.health")],
              ["decision", t("admin.workspace.audit.filters.decision")],
              ["task.deletion", t("admin.workspace.audit.filters.deletion")],
            ].map(([key, label]) => (
              <Link
                key={key}
                href={key === "all" ? "/admin" : `/admin?audit=${key}`}
                className="rounded-full border border-line px-2.5 py-1 text-[12px] text-muted hover:text-ink"
                aria-current={
                  (auditFilter ?? "all") === key ? "page" : undefined
                }
              >
                {label}
              </Link>
            ))}
          </div>
          {auditList.length === 0 ? (
            <p className="card px-4 py-6 text-center text-[13px] text-muted">
              {t("admin.workspace.audit.empty")}
            </p>
          ) : (
            <ol className="card divide-y divide-line">
              {auditList.map((event) => (
                <li
                  key={event.id}
                  className="flex flex-wrap items-center gap-3 px-4 py-2.5"
                >
                  <span className="min-w-0 flex-1 text-[13px]">
                    <span className="font-medium">
                      {event.actor?.full_name ?? t("common.system")}
                    </span>{" "}
                    · {auditCode("actions", event.action, event.action.replace(/_/g, " "))}
                    {event.object_type ? (
                      <span className="text-muted">
                        {" "}({auditCode("objects", event.object_type, event.object_type)})
                      </span>
                    ) : null}
                  </span>
                  <Badge tone="neutral">
                    {auditCode("eventTypes", event.event_type, event.event_type)}
                  </Badge>
                  <time
                    className="meta whitespace-nowrap"
                    dateTime={event.created_at}
                  >
                    {format.relative(event.created_at)}
                  </time>
                </li>
              ))}
            </ol>
          )}
          {(auditCount ?? 0) > auditPage * 30 ? (
            <p className="mt-3">
              <Link
                href={`/admin?audit=${auditFilter ?? "all"}&auditPage=${auditPage + 1}`}
                className="text-[13px] font-medium text-brand-fg hover:underline"
              >
                {t("admin.workspace.audit.older")}
              </Link>
            </p>
          ) : null}
        </section>
      </div>
    </div>
  );
}
