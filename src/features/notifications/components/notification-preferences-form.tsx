import { requireSession } from "@/lib/auth";
import { isEnabled } from "@/lib/feature-flags";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { normalizeHubMuted } from "@/features/notifications/categories";
import {
  NotificationPreferencesFormClient,
  type PreferenceValues,
} from "./notification-preferences-form.client";

export type { PreferenceValues };

/**
 * Email and Hub preferences. While the `wos_pages` switch is on (wave 2, C3)
 * the form also offers comments, approvals and watched pages, and lets each
 * of the five main categories be kept out of the Hub entirely.
 */
export async function NotificationPreferencesForm(props: {
  values: PreferenceValues;
  timezoneOptions?: string[];
  projects?: { id: string; name: string }[];
}) {
  if (!(await isEnabled("wos_pages"))) return <NotificationPreferencesFormClient {...props} />;
  const session = await requireSession();
  const db = await createSupabaseServerClient();
  const { data } = await db
    .from("notification_preference")
    .select("hub_muted_categories")
    .eq("user_id", session.userId)
    .maybeSingle();
  return (
    <NotificationPreferencesFormClient
      {...props}
      pageCategories={{ hubMuted: normalizeHubMuted(data?.hub_muted_categories) }}
    />
  );
}
