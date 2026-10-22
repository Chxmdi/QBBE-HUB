import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { WorkspaceShell } from "@/components/layout/workspace-shell";
import { LocaleSync } from "@/features/preferences/components/locale-sync";
import { requireSession } from "@/lib/auth";
import { readNavigationSwitches } from "@/lib/navigation-switches";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { hasVerifiedTotpFactor, requiresAdministratorMfa } from "@/features/auth/mfa";
import { RETURN_PATH_HEADER, mfaPath } from "@/lib/return-path";
import { getSidebarState } from "@/features/channels/sidebar-state.server";

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
  // The factors come from the Auth response requireSession already fetched;
  // listFactors() would fetch the same user again (one more Auth round trip
  // on every admin page view). The assurance level is read from the session
  // token without a network call.
  if (session.isAdmin) {
    const [assuranceResult, factorResult] = await Promise.all([
      supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
      session.factors
        ? Promise.resolve({ data: { all: session.factors }, error: null })
        : supabase.auth.mfa.listFactors(),
    ]);
    if (
      assuranceResult.error ||
      factorResult.error ||
      requiresAdministratorMfa(
        session.isAdmin,
        assuranceResult.data?.currentLevel,
        assuranceResult.data?.nextLevel,
        hasVerifiedTotpFactor(factorResult.data?.all ?? []),
      )
    ) {
      // Back to the page that was asked for once verified (a link from an
      // email, say), not to Home.
      redirect(mfaPath((await headers()).get(RETURN_PATH_HEADER)));
    }
  }

  // First run lands in onboarding rather than an unexplained dashboard
  // (§10.18). The session already read the whole profile row.
  const profile = session.profile;
  if (profile && !profile.onboarded_at) redirect("/welcome");

  // Live, permission-aware sidebar counts (Part IV §5.2), in one call:
  // unread notifications, open tasks (my_open_task_count, #115), an unread
  // flag for every channel the person is in, and unread direct
  // conversations. It used to be one query per count and one more per
  // channel, for the first ten channels only. supabase/tests/sidebar-state.sql
  // keeps it equal to those queries.
  // The Workspace OS switches the menus show entries for (epic #199), read
  // once here and passed down; the sidebar, tabs and palette never fetch them.
  const [
    state,
    { data: programs },
    navSwitches,
    { data: ledgerReader },
  ] = await Promise.all([
    getSidebarState(),
    supabase
      .from("program")
      .select("id, name")
      .eq("status", "active")
      .order("name")
      .limit(8),
    readNavigationSwitches(supabase),
    // The ledger screens open only for administrators and the staff an
    // administrator made ledger readers (audit M6). A reader sees them listed
    // before completing MFA too; getLedgerAccess then asks for it. Readers can
    // see their own row without MFA.
    session.isStaff && !session.isAdmin
      ? supabase
          .from("ledger_reader")
          .select("user_id")
          .eq("organization_id", session.organizationId)
          .eq("user_id", session.userId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);


  return (
    <WorkspaceShell
      name={session.profile.full_name}
      title={session.profile.title}
      avatarUrl={session.profile.avatar_url}
      isAdmin={session.isAdmin}
      isStaff={session.isStaff}
      canReadLedger={Boolean(ledgerReader)}
      navSwitches={navSwitches}
      unreadCount={state.unreadNotifications}
      channels={state.channels}
      programs={(programs ?? []).map((p) => ({ id: p.id, name: p.name }))}
      counts={{
        myWork: state.openTasks,
        inbox: state.unreadNotifications,
        messages: state.unreadConversations,
      }}
      density={(profile?.display_density as "comfortable" | "compact") ?? "comfortable"}
      reduceMotion={profile?.reduce_motion === true}
    >
      <LocaleSync saved={session.profile.locale} />
      {children}
    </WorkspaceShell>
  );
}
