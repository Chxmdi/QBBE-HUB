"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/features/tasks/services/task.commands";

/**
 * Notification preferences.
 *
 * Every field is optional so a partial form — onboarding's two switches, or
 * the settings page's full set — writes only what it collected and leaves the
 * rest alone. Absent means "unchanged", not "reset to default".
 *
 * The row is written under the signed-in user's own credentials, so RLS
 * (`notification_pref_own`) is what actually prevents editing someone else's
 * preferences; the `user_id` below is a convenience, not the control.
 */

function isRealTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

const hour = z.coerce.number().int().min(0).max(23);
const deliveryMode = z.enum(["off", "immediate", "daily", "weekly"]);

const preferencesSchema = z.object({
  emailCritical: z.boolean().optional(),
  emailDigest: z.boolean().optional(),
  emailAssignments: z.boolean().optional(),
  emailMentions: z.boolean().optional(),
  emailAnnouncements: z.boolean().optional(),
  emailDueDates: z.boolean().optional(),
  quietHoursStart: hour.nullable().optional(),
  quietHoursEnd: hour.nullable().optional(),
  digestHour: hour.optional(),
  digestWeekday: z.coerce.number().int().min(0).max(6).optional(),
  timezone: z
    .string()
    .trim()
    .max(80)
    .refine(isRealTimezone, "That is not a recognised time zone.")
    .optional(),
  categoryModes: z
    .object({
      assignment: deliveryMode,
      mention: deliveryMode,
      announcement: deliveryMode,
      due_date: deliveryMode,
    })
    .optional(),
  mutedProjectIds: z.array(z.string().uuid()).max(100).optional(),
  mutedThreadIds: z.array(z.string().uuid()).max(100).optional(),
});

const COLUMNS = {
  emailCritical: "email_critical",
  emailDigest: "email_digest",
  emailAssignments: "email_assignments",
  emailMentions: "email_mentions",
  emailAnnouncements: "email_announcements",
  emailDueDates: "email_due_dates",
  quietHoursStart: "quiet_hours_start",
  quietHoursEnd: "quiet_hours_end",
  digestHour: "digest_hour",
  digestWeekday: "digest_weekday",
  timezone: "timezone",
};

export async function saveNotificationPreferences(
  input: unknown,
): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = preferencesSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Those preferences are not valid.",
    };
  }

  const patch: Record<string, unknown> = {
    user_id: session.userId,
    updated_at: new Date().toISOString(),
  };
  for (const [key, column] of Object.entries(COLUMNS)) {
    const value = parsed.data[key as keyof typeof COLUMNS];
    if (value !== undefined) patch[column] = value;
  }

  if (parsed.data.categoryModes) {
    const modes = parsed.data.categoryModes;
    patch.category_modes = modes;
    patch.email_assignments = modes.assignment !== "off";
    patch.email_mentions = modes.mention !== "off";
    patch.email_announcements = modes.announcement !== "off";
    patch.email_due_dates = modes.due_date !== "off";
    patch.email_digest = Object.values(modes).some(
      (mode) => mode === "daily" || mode === "weekly",
    );
  }
  if (parsed.data.mutedProjectIds) patch.muted_project_ids = parsed.data.mutedProjectIds;
  if (parsed.data.mutedThreadIds) patch.muted_thread_ids = parsed.data.mutedThreadIds;

  // A quiet window needs both ends or neither. A CHECK constraint cannot catch
  // this — a comparison against NULL yields NULL, which passes — so the rule
  // lives here.
  if ("quiet_hours_start" in patch || "quiet_hours_end" in patch) {
    const start = patch.quiet_hours_start ?? null;
    const end = patch.quiet_hours_end ?? null;
    if ((start === null) !== (end === null)) {
      return {
        ok: false,
        error: "Set both a start and an end for quiet hours, or clear both.",
      };
    }
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("notification_preference")
    .upsert(patch, { onConflict: "user_id" });

  if (error) return { ok: false, error: "Could not save your preferences." };

  revalidatePath("/settings/notifications");
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Mute or unmute one thread. Required announcements are not threads. */
export async function setThreadMuted(
  threadId: string,
  muted: boolean,
): Promise<ActionResult> {
  const session = await requireSession();
  if (!z.string().uuid().safeParse(threadId).success) {
    return { ok: false, error: "Unknown thread." };
  }
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("notification_preference")
    .select("muted_thread_ids")
    .eq("user_id", session.userId)
    .maybeSingle();
  const current = ((data?.muted_thread_ids as string[] | null) ?? []).filter(Boolean);
  const next = muted
    ? [...new Set([...current, threadId])]
    : current.filter((id) => id !== threadId);
  const { error } = await supabase.from("notification_preference").upsert(
    {
      user_id: session.userId,
      muted_thread_ids: next,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  if (error) return { ok: false, error: "Could not update that thread." };
  revalidatePath("/", "layout");
  return { ok: true };
}
