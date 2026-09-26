import { redirect } from "next/navigation";
import { WorkspaceShell } from "@/components/layout/workspace-shell";
import { requireSession } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requiresAdministratorMfa, verifiedTotpFactors } from "@/features/auth/mfa";

export default async function WorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireSession();
  const supabase = await createSupabaseServerClient();

  // Administrators must complete the second factor before the workspace
  // renders. The database independently applies the same requirement to its
  // privileged authorization helpers, so direct API calls cannot bypass this
  // navigation guard.
  if (session.isAdmin) {
    const [assuranceResult, factorResult] = await Promise.all([
      supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
      supabase.auth.mfa.listFactors(),
    ]);
    if (
      assuranceResult.error ||
      factorResult.error ||
      requiresAdministratorMfa(
        session.isAdmin,
        assuranceResult.data?.currentLevel,
        assuranceResult.data?.nextLevel,
        verifiedTotpFactors(factorResult.data?.all ?? []).length > 0,
      )
    ) {
      redirect("/mfa");
    }
  }

  // First run lands in onboarding rather than an unexplained dashboard
  // (§10.18).
  const { data: profile } = await supabase
    .from("user_profile")
    .select("onboarded_at, display_density, reduce_motion")
    .eq("id", session.userId)
    .maybeSingle();
  if (profile && !profile.onboarded_at) redirect("/welcome");

  // Live, permission-aware sidebar counts (Part IV §5.2).
  const [
    { count: unreadCount },
    { data: memberships },
    { data: myWorkCount },
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
    // Counted by a function rather than through the task read rule on every
    // page: for your own tasks that rule is only organization membership, and
    // evaluating the whole rule made this the costliest query in the 50-user
    // test (#115). supabase/tests/my-open-task-count.sql keeps them equal.
    supabase.rpc("my_open_task_count"),
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
  // cursor (MSG-007). It asks for one row, not a count: an exact count reads
  // and access-checks every unread message, on every page, for every channel
  // in the sidebar, where the flag only needs to know that one exists (#115).
  const unreadFlags = await Promise.all(
    channelRows.map(async (m) => {
      const { data } = await supabase
        .from("message")
        .select("id")
        .eq("channel_id", m.channel!.id)
        .gt("created_at", m.last_read_at)
        .neq("author_id", session.userId)
        .limit(1);
      return (data?.length ?? 0) > 0;
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
      counts={{ myWork: Number(myWorkCount ?? 0), inbox: unreadCount ?? 0 }}
      density={(profile?.display_density as "comfortable" | "compact") ?? "comfortable"}
      reduceMotion={profile?.reduce_motion === true}
    >
      {children}
    </WorkspaceShell>
  );
}
