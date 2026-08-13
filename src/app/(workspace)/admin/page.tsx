import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/page-header";
import { EntityFormDialog } from "@/components/shared/entity-form-dialog";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  MemberActiveToggle,
  MemberRoleSelect,
  RevokeInvitationButton,
} from "@/features/admin/components/member-controls";
import { inviteUser } from "@/features/admin/services/admin.commands";
import { requireAdmin } from "@/lib/auth";
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
    provider: "volunteer_system",
    name: "Volunteer Management System",
    description: "Volunteer identity/availability references. Server-to-server integration boundary.",
  },
  {
    provider: "email",
    name: "Transactional email",
    description: "Notification email delivery via a verified QBBE sender domain.",
  },
];

export default async function AdminPage() {
  const session = await requireAdmin();
  const supabase = await createSupabaseServerClient();

  const [{ data: members }, { data: invitations }, { data: audit }, { data: integrations }] =
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
        .select("provider, status, last_sync_at"),
    ]);

  const memberList = ((members ?? []) as unknown as Membership[]).filter(
    (m) => m.user_profile,
  );
  const invitationList = (invitations ?? []) as InvitationRow[];
  const auditList = (audit ?? []) as unknown as AuditRow[];
  const integrationMap = new Map(
    ((integrations ?? []) as IntegrationRow[]).map((i) => [i.provider, i]),
  );

  return (
    <div>
      <PageHeader
        eyebrow="Administration"
        title="Admin"
        description="Users, access, invitations, integrations, and the audit trail."
        actions={
          <EntityFormDialog
            triggerLabel="Invite user"
            title="Invite a user"
            submitLabel="Create invitation"
            action={inviteUser}
            fields={[
              { name: "email", label: "Email", type: "email", required: true },
              {
                name: "intendedRole",
                label: "Role",
                type: "select",
                required: true,
                defaultValue: "staff",
                options: [
                  { value: "admin", label: "Workspace Admin" },
                  { value: "staff", label: "Staff" },
                  { value: "volunteer", label: "Volunteer" },
                  { value: "guest", label: "Read-only guest" },
                ],
                hint: "When this person signs up with the invited email, the role is applied automatically.",
              },
            ]}
          />
        }
      />

      <div className="space-y-10">
        {/* Members (P0-ADM-01, P0-PPL-03) */}
        <section aria-labelledby="admin-members">
          <h2 id="admin-members" className="section-heading mb-3">
            Members
          </h2>
          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
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
                          <MemberActiveToggle
                            membershipId={member.id}
                            active={member.status === "active"}
                            isOwner={member.role === "owner"}
                            isSelf={member.user_id === session.userId}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* Invitations (AUTH-007) */}
        <section aria-labelledby="admin-invitations">
          <h2 id="admin-invitations" className="section-heading mb-3">
            Invitations
          </h2>
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
              const connected = connection?.status === "connected";
              return (
                <div key={integration.provider} className="card p-4">
                  <div className="mb-1 flex items-center justify-between">
                    <p className="text-[14px] font-semibold">{integration.name}</p>
                    <Badge tone={connected ? "success" : "neutral"}>
                      {connected ? "Connected" : "Not connected"}
                    </Badge>
                  </div>
                  <p className="text-[13px] text-muted">{integration.description}</p>
                  {connection?.last_sync_at ? (
                    <p className="meta mt-1.5">
                      Last sync {relativeTime(connection.last_sync_at)}
                    </p>
                  ) : (
                    <p className="meta mt-1.5">
                      Configure credentials per docs/runbooks/integrations.md, then
                      connect from here.
                    </p>
                  )}
                </div>
              );
            })}
          </div>
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
