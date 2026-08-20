import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/page-header";
import { NotificationPreferencesForm } from "@/features/onboarding/components/notification-preferences-form";
import { requireSession } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Account settings" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const session = await requireSession();
  const supabase = await createSupabaseServerClient();
  const [{ data: preference }, { data: memberships }] = await Promise.all([
    supabase
      .from("notification_preference")
      .select("email_critical, email_digest, quiet_hours_start, quiet_hours_end")
      .eq("user_id", session.userId)
      .maybeSingle(),
    supabase
      .from("channel_member")
      .select("channel_id, muted_level, channel:channel_id(id, slug, archived_at)")
      .eq("user_id", session.userId),
  ]);

  type MembershipRow = {
    channel_id: string;
    muted_level: "all" | "mentions" | "muted";
    channel: { id: string; slug: string; archived_at: string | null } | null;
  };
  const channels = ((memberships ?? []) as unknown as MembershipRow[])
    .filter((membership) => membership.channel && !membership.channel.archived_at)
    .map((membership) => ({
      id: membership.channel_id,
      label: membership.channel!.slug,
      mutedLevel: membership.muted_level,
    }));

  return (
    <div>
      <PageHeader
        eyebrow="Account"
        title="Settings"
        description="Manage how QBBE Hub notifies you. Workspace admins manage organization-wide defaults separately."
      />
      <NotificationPreferencesForm
        initial={{
          emailCritical: preference?.email_critical ?? true,
          emailDigest: preference?.email_digest ?? false,
          quietHoursStart: preference?.quiet_hours_start ?? null,
          quietHoursEnd: preference?.quiet_hours_end ?? null,
        }}
        channels={channels}
      />
    </div>
  );
}
