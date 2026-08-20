import type { Metadata } from "next";
import { Users } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { requireSession } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PersonDeepLink } from "@/features/admin/components/person-deep-link";
import type { Membership, OrgRole } from "@/types/entities";

export const metadata: Metadata = { title: "People" };
export const dynamic = "force-dynamic";

const ROLE_LABELS: Record<OrgRole, string> = {
  owner: "Primary Owner",
  admin: "Workspace Admin",
  staff: "Staff",
  volunteer: "Volunteer",
  guest: "Guest",
};

const ROLE_TONES: Record<OrgRole, "brand" | "accent" | "info" | "neutral"> = {
  owner: "brand",
  admin: "accent",
  staff: "info",
  volunteer: "neutral",
  guest: "neutral",
};

export default async function PeoplePage({
  searchParams,
}: {
  searchParams: Promise<{ person?: string; team?: string }>;
}) {
  const session = await requireSession();
  const params = await searchParams;
  const supabase = await createSupabaseServerClient();

  const [{ data: members }, openTasks, { data: teams }, { data: teamMembers }] = await Promise.all([
    supabase
      .from("organization_membership")
      .select(
        "id, organization_id, user_id, role, status, joined_at, user_profile:user_id(id, full_name, email, avatar_url, title, timezone)",
      )
      .order("joined_at"),
    session.isStaff
      ? supabase
          .from("task")
          .select("assignee_id")
          .in("status", [
            "not_started", "ready", "in_progress", "waiting", "blocked", "in_review",
          ])
          .is("archived_at", null)
          .not("assignee_id", "is", null)
          .then((res) => (res.data ?? []) as { assignee_id: string }[])
      : Promise.resolve([] as { assignee_id: string }[]),
    supabase.from("team").select("id, name").order("name"),
    supabase.from("team_member").select("team_id, user_id"),
  ]);

  const memberList = ((members ?? []) as unknown as Membership[]).filter(
    (m) => m.user_profile,
  );
  const teamList = (teams ?? []) as { id: string; name: string }[];
  const teamMemberList = (teamMembers ?? []) as { team_id: string; user_id: string }[];
  const teamFilter = params.team;
  const highlighted = params.person ?? null;
  const inTeam = teamFilter
    ? new Set(teamMemberList.filter((m) => m.team_id === teamFilter).map((m) => m.user_id))
    : null;
  const active = memberList.filter(
    (m) => m.status === "active" && (!inTeam || inTeam.has(m.user_id)),
  );
  const inactive = memberList.filter((m) => m.status !== "active");

  const workload = new Map<string, number>();
  for (const t of openTasks) {
    workload.set(t.assignee_id, (workload.get(t.assignee_id) ?? 0) + 1);
  }

  return (
    <div>
      <PageHeader
        eyebrow="Directory"
        title="People"
        description="Internal users, roles, and current workload context."
      />
      <PersonDeepLink personId={highlighted} />
      {teamList.length > 0 ? (
        <nav aria-label="Filter by team" className="mb-4 flex flex-wrap gap-1.5">
          <a
            href="/people"
            className={
              !teamFilter
                ? "rounded-full border border-brand bg-brand px-3 py-1 text-[13px] font-medium text-white"
                : "rounded-full border border-line bg-surface px-3 py-1 text-[13px] font-medium text-muted"
            }
          >
            All
          </a>
          {teamList.map((team) => (
            <a
              key={team.id}
              href={`/people?team=${team.id}`}
              className={
                teamFilter === team.id
                  ? "rounded-full border border-brand bg-brand px-3 py-1 text-[13px] font-medium text-white"
                  : "rounded-full border border-line bg-surface px-3 py-1 text-[13px] font-medium text-muted"
              }
            >
              {team.name}
            </a>
          ))}
        </nav>
      ) : null}

      {active.length === 0 ? (
        <EmptyState
          icon={<Users />}
          title="No members yet"
          description="Invite teammates from the Admin page — they'll appear here with role and workload."
        />
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13.5px]">
              <thead>
                <tr className="border-b border-line bg-surface-soft/60">
                  <th scope="col" className="px-4 py-2.5 font-semibold">Person</th>
                  <th scope="col" className="px-4 py-2.5 font-semibold">Role</th>
                  {session.isStaff ? (
                    <th scope="col" className="px-4 py-2.5 font-semibold">
                      Open tasks
                    </th>
                  ) : null}
                  <th scope="col" className="px-4 py-2.5 font-semibold">Email</th>
                </tr>
              </thead>
              <tbody>
                {active.map((member) => {
                  const profile = member.user_profile!;
                  return (
                    <tr
                      key={member.id}
                      id={`person-${member.user_id}`}
                      className={
                        member.user_id === highlighted
                          ? "border-b border-line bg-brand-soft/40 last:border-b-0"
                          : "border-b border-line last:border-b-0"
                      }
                    >
                      <td className="px-4 py-3">
                        <span className="flex items-center gap-2.5">
                          <Avatar name={profile.full_name} src={profile.avatar_url} size="md" />
                          <span>
                            <span className="block font-medium">
                              {profile.full_name}
                              {member.user_id === session.userId ? (
                                <span className="meta ml-1.5">(you)</span>
                              ) : null}
                            </span>
                            {profile.title ? (
                              <span className="meta">{profile.title}</span>
                            ) : null}
                          </span>
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <Badge tone={ROLE_TONES[member.role]}>
                          {ROLE_LABELS[member.role]}
                        </Badge>
                      </td>
                      {session.isStaff ? (
                        <td className="px-4 py-3 tabular-nums">
                          {workload.get(member.user_id) ?? 0}
                        </td>
                      ) : null}
                      <td className="px-4 py-3 text-muted">{profile.email}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {inactive.length > 0 && session.isAdmin ? (
        <p className="meta mt-3">
          {inactive.length} deactivated or invited member
          {inactive.length === 1 ? "" : "s"} — manage them in Admin.
        </p>
      ) : null}
    </div>
  );
}
