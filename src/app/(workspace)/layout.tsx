import { WorkspaceShell } from "@/components/layout/workspace-shell";
import { requireSession } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const OPEN_STATUSES = [
  "not_started", "ready", "in_progress", "waiting", "blocked", "in_review",
];

export default async function WorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireSession();
  const supabase = await createSupabaseServerClient();

  // Live, permission-aware sidebar counts (Part IV §5.2).
  const [
    { count: unreadCount },
    { data: memberships },
    { count: myWorkCount },
    { data: programs },
  ] = await Promise.all([
    supabase
      .from("notification")
      .select("id", { count: "exact", head: true })
      .is("read_at", null),
    supabase
      .from("channel_member")
      .select("last_read_at, channel:channel_id(id, slug, archived_at)")
      .eq("user_id", session.userId),
    supabase
      .from("task")
      .select("id", { count: "exact", head: true })
      .eq("assignee_id", session.userId)
      .in("status", OPEN_STATUSES)
      .is("archived_at", null),
    supabase
      .from("program")
      .select("id, name")
      .eq("status", "active")
      .order("name")
      .limit(8),
  ]);

  type MembershipRow = {
    last_read_at: string;
    channel: { id: string; slug: string; archived_at: string | null } | null;
  };

  const channelRows = ((memberships ?? []) as unknown as MembershipRow[])
    .filter((m) => m.channel && !m.channel.archived_at)
    .slice(0, 10);

  // Unread flag per channel: any message newer than the member's last-read
  // cursor (MSG-007).
  const unreadFlags = await Promise.all(
    channelRows.map(async (m) => {
      const { count } = await supabase
        .from("message")
        .select("id", { count: "exact", head: true })
        .eq("channel_id", m.channel!.id)
        .gt("created_at", m.last_read_at)
        .neq("author_id", session.userId)
        .limit(1);
      return (count ?? 0) > 0;
    }),
  );

  const channels = channelRows.map((m, i) => ({
    id: m.channel!.id,
    slug: m.channel!.slug,
    unread: unreadFlags[i],
  }));

  return (
    <WorkspaceShell
      name={session.profile.full_name}
      title={session.profile.title}
      avatarUrl={session.profile.avatar_url}
      isAdmin={session.isAdmin}
      isStaff={session.isStaff}
      unreadCount={unreadCount ?? 0}
      channels={channels}
      programs={(programs ?? []).map((p) => ({ id: p.id, name: p.name }))}
      counts={{ myWork: myWorkCount ?? 0, inbox: unreadCount ?? 0 }}
    >
      {children}
    </WorkspaceShell>
  );
}
