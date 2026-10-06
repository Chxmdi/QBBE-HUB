"use server";

import { revalidatePath } from "next/cache";
import { authorizeAdminAction } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/features/tasks/services/task.commands";
import { getT } from "@/lib/i18n/server";
import {
  firstOutOfRange,
  teamSignalSettingsSchema,
  THRESHOLD_LIMITS,
} from "@/features/people/team-signals";

/**
 * Saving Admin, Team signals. The authorization here gives a clear sentence;
 * `team_signal_settings_manage` (owners and admins with MFA) is what holds.
 */
export async function saveTeamSignalSettings(input: unknown): Promise<ActionResult> {
  const authorization = await authorizeAdminAction();
  if (!authorization.ok) return { ok: false, error: authorization.error };
  const session = authorization.session;
  const t = await getT();

  const parsed = teamSignalSettingsSchema.safeParse(input);
  if (!parsed.success) {
    const field = firstOutOfRange((input ?? {}) as Record<string, unknown>);
    return {
      ok: false,
      error: field
        ? t("teamSignals.errors.range", THRESHOLD_LIMITS[field])
        : t("teamSignals.errors.generic"),
    };
  }
  const value = parsed.data;

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("team_signal_settings").upsert(
    {
      organization_id: session.organizationId,
      overdue_count: value.overdueCount,
      overdue_age_days: value.overdueAgeDays,
      blocked_no_update_days: value.blockedNoUpdateDays,
      in_progress_no_update_days: value.inProgressNoUpdateDays,
      flag_project_reports: value.flagProjectReports,
      flag_overdue_decisions: value.flagOverdueDecisions,
      reminders_enabled: value.remindersEnabled,
      digest_enabled: value.digestEnabled,
      updated_by: session.userId,
    },
    { onConflict: "organization_id" },
  );
  if (error) return { ok: false, error: t("teamSignals.errors.generic") };

  // Who is told about whom is a governance decision, so it is audited.
  await supabase.from("audit_event").insert({
    organization_id: session.organizationId,
    actor_id: session.userId,
    event_type: "governance",
    action: "team_signal_settings_saved",
    object_type: "team_signal_settings",
    metadata: {
      overdue_count: value.overdueCount,
      overdue_age_days: value.overdueAgeDays,
      blocked_no_update_days: value.blockedNoUpdateDays,
      in_progress_no_update_days: value.inProgressNoUpdateDays,
      flag_project_reports: value.flagProjectReports,
      flag_overdue_decisions: value.flagOverdueDecisions,
      reminders_enabled: value.remindersEnabled,
      digest_enabled: value.digestEnabled,
    },
  });

  revalidatePath("/admin/team-signals");
  revalidatePath("/people/overview");
  return { ok: true };
}
