import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import {
  NotificationPreferencesForm,
  type PreferenceValues,
} from "@/features/notifications/components/notification-preferences-form";
import { DEFAULT_PREFERENCES } from "@/features/notifications/services/delivery-rules";
import { requireSession } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatDateTime, relativeTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Email preferences" };
export const dynamic = "force-dynamic";

interface RecentDelivery {
  id: string;
  subject: string;
  status: string;
  created_at: string;
  sent_at: string | null;
  scheduled_for: string | null;
}

/**
 * A person's own email settings, with the last few messages the Hub actually
 * sent them. Showing the record next to the switches is what makes the
 * switches believable — you can see the effect of the setting you just chose.
 */
export default async function NotificationSettingsPage() {
  const session = await requireSession();
  const supabase = await createSupabaseServerClient();

  const [{ data: prefRow }, { data: deliveryRows }] = await Promise.all([
    supabase
      .from("notification_preference")
      .select(
        "email_critical, email_digest, email_assignments, email_mentions, email_announcements, email_due_dates, quiet_hours_start, quiet_hours_end, digest_hour, timezone",
      )
      .eq("user_id", session.userId)
      .maybeSingle(),
    supabase
      .from("email_delivery")
      .select("id, subject, status, created_at, sent_at, scheduled_for")
      .eq("recipient_user_id", session.userId)
      .order("created_at", { ascending: false })
      .limit(8),
  ]);

  const values: PreferenceValues = {
    ...DEFAULT_PREFERENCES,
    timezone: session.profile.timezone || DEFAULT_PREFERENCES.timezone,
    ...((prefRow ?? {}) as Partial<PreferenceValues>),
  };

  const deliveries = (deliveryRows ?? []) as unknown as RecentDelivery[];

  return (
    <div className="max-w-3xl">
      <PageHeader
        eyebrow="Settings"
        title="Email preferences"
        description="Choose what reaches your inbox, and when. Everything still appears in the Hub either way."
      />

      <NotificationPreferencesForm values={values} />

      <section aria-labelledby="recent-email" className="mt-10">
        <h2 id="recent-email" className="section-heading mb-3">
          Recent email to you
        </h2>
        {deliveries.length === 0 ? (
          <p className="card px-4 py-6 text-center text-[13px] text-muted">
            Nothing sent yet. Mail from the Hub will be listed here with its
            delivery status.
          </p>
        ) : (
          <ul className="card divide-y divide-line">
            {deliveries.map((delivery) => (
              <li
                key={delivery.id}
                className="flex flex-wrap items-center gap-3 px-4 py-2.5"
              >
                <span className="min-w-0 flex-1 basis-48">
                  <span className="block truncate text-[13.5px]">
                    {delivery.subject}
                  </span>
                  <span className="meta">
                    {delivery.sent_at
                      ? `sent ${formatDateTime(delivery.sent_at)}`
                      : delivery.scheduled_for
                        ? `held until ${formatDateTime(delivery.scheduled_for)}`
                        : relativeTime(delivery.created_at)}
                  </span>
                </span>
                <Badge
                  tone={
                    delivery.status === "sent"
                      ? "success"
                      : delivery.status === "bounced" || delivery.status === "failed"
                        ? "danger"
                        : delivery.status === "suppressed"
                          ? "neutral"
                          : "info"
                  }
                >
                  {delivery.status}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
