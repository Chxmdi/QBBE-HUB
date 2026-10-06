import { z } from "zod";

/**
 * Admin, Team signals (#136, phase 3): the thresholds and the two switches
 * an organization stores in `team_signal_settings`. The ranges match the
 * table's CHECK constraints, which remain the real boundary.
 */

export const THRESHOLD_LIMITS = {
  overdueCount: { min: 1, max: 100 },
  overdueAgeDays: { min: 1, max: 365 },
  blockedNoUpdateDays: { min: 1, max: 365 },
  inProgressNoUpdateDays: { min: 1, max: 365 },
} as const;

const whole = (limit: { min: number; max: number }) =>
  z.coerce.number().int().min(limit.min).max(limit.max);

export const teamSignalSettingsSchema = z.object({
  overdueCount: whole(THRESHOLD_LIMITS.overdueCount),
  overdueAgeDays: whole(THRESHOLD_LIMITS.overdueAgeDays),
  blockedNoUpdateDays: whole(THRESHOLD_LIMITS.blockedNoUpdateDays),
  inProgressNoUpdateDays: whole(THRESHOLD_LIMITS.inProgressNoUpdateDays),
  flagProjectReports: z.boolean(),
  flagOverdueDecisions: z.boolean(),
  remindersEnabled: z.boolean(),
  digestEnabled: z.boolean(),
});

export type TeamSignalSettingsInput = z.infer<typeof teamSignalSettingsSchema>;

/** The stored row in the form's shape; a missing row reads as the defaults. */
export function settingsForForm(
  row: {
    overdue_count: number;
    overdue_age_days: number;
    blocked_no_update_days: number;
    in_progress_no_update_days: number;
    flag_project_reports: boolean;
    flag_overdue_decisions: boolean;
    reminders_enabled: boolean;
    digest_enabled: boolean;
  } | null,
): TeamSignalSettingsInput {
  return {
    overdueCount: row?.overdue_count ?? 3,
    overdueAgeDays: row?.overdue_age_days ?? 7,
    blockedNoUpdateDays: row?.blocked_no_update_days ?? 5,
    inProgressNoUpdateDays: row?.in_progress_no_update_days ?? 7,
    flagProjectReports: row?.flag_project_reports ?? true,
    flagOverdueDecisions: row?.flag_overdue_decisions ?? true,
    remindersEnabled: row?.reminders_enabled ?? false,
    digestEnabled: row?.digest_enabled ?? false,
  };
}

/** The first field out of range, for the error message, or null when all fit. */
export function firstOutOfRange(
  input: Partial<Record<keyof typeof THRESHOLD_LIMITS, unknown>>,
): keyof typeof THRESHOLD_LIMITS | null {
  for (const key of Object.keys(THRESHOLD_LIMITS) as (keyof typeof THRESHOLD_LIMITS)[]) {
    const value = Number(input[key]);
    const limit = THRESHOLD_LIMITS[key];
    if (!Number.isInteger(value) || value < limit.min || value > limit.max) return key;
  }
  return null;
}
