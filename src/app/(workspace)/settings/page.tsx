import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/page-header";
import { NotificationPreferencesForm } from "@/features/onboarding/components/notification-preferences-form";
import { MfaSettings } from "@/features/auth/components/mfa-settings";
import { ReduceMotionSetting } from "@/features/onboarding/components/reduce-motion-setting";
import { verifiedTotpFactors } from "@/features/auth/mfa";
import { requireSession } from "@/lib/auth";
import { createSupabasePageClient } from "@/lib/supabase/page";
import { LanguageSettings } from "@/features/preferences/components/language-switcher";
import { isLocale } from "@/lib/i18n/config";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("settings.title") };
}
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const session = await requireSession();
  const t = await getT();
  const supabase = await createSupabasePageClient();
  const [{ data: preference }, { data: memberships }, factorResult, { data: profile }] = await Promise.all([
    supabase
      .from("notification_preference")
      .select("email_critical, email_digest, quiet_hours_start, quiet_hours_end")
      .eq("user_id", session.userId)
      .maybeSingle(),
    supabase
      .from("channel_member")
      .select("channel_id, muted_level, channel:channel_id(id, slug, archived_at)")
      .eq("user_id", session.userId),
    session.isAdmin
      ? supabase.auth.mfa.listFactors()
      : Promise.resolve({ data: null, error: null }),
    supabase.from("user_profile").select("reduce_motion").eq("id", session.userId).maybeSingle(),
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
        eyebrow={t("settings.eyebrow")}
        title={t("settings.heading")}
        description={t("settings.description")}
      />
      <LanguageSettings
        current={isLocale(session.profile.locale) ? session.profile.locale : "auto"}
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
      <ReduceMotionSetting initial={profile?.reduce_motion === true} />
      {session.isAdmin && factorResult.data ? (
        <MfaSettings initialFactors={verifiedTotpFactors(factorResult.data.all, t)} />
      ) : null}
    </div>
  );
}
