import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/page-header";
import { AdminNav } from "@/features/admin/components/admin-nav";
import { TeamSignalsForm } from "@/features/people/components/team-signals-form";
import { settingsForForm } from "@/features/people/team-signals";
import { requireAdminAal2 } from "@/lib/auth";
import { createSupabasePageClient } from "@/lib/supabase/page";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("teamSignals.title") };
}
export const dynamic = "force-dynamic";

/**
 * Admin, Team signals (#136, phase 3): when a staff member's work needs
 * attention, whether the person gets a gentle reminder, and whether owners
 * and admins get the weekly digest. Owners and admins with MFA only.
 */
export default async function AdminTeamSignalsPage() {
  const session = await requireAdminAal2();
  const supabase = await createSupabasePageClient();
  const t = await getT();
  const { data } = await supabase
    .from("team_signal_settings")
    .select(
      "overdue_count, overdue_age_days, blocked_no_update_days, in_progress_no_update_days, flag_project_reports, flag_overdue_decisions, reminders_enabled, digest_enabled",
    )
    .eq("organization_id", session.organizationId)
    .maybeSingle();

  return (
    <div>
      <AdminNav />
      <PageHeader
        eyebrow={t("teamSignals.eyebrow")}
        title={t("teamSignals.title")}
        description={t("teamSignals.description")}
      />
      <div className="max-w-3xl">
        <TeamSignalsForm initial={settingsForForm(data)} />
      </div>
    </div>
  );
}
