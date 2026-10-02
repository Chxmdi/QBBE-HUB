import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import {
  NotificationPreferencesForm,
  type PreferenceValues,
} from "@/features/notifications/components/notification-preferences-form";
import { DEFAULT_PREFERENCES, PREFERENCE_COLUMNS } from "@/features/notifications/services/delivery-rules";
import { requireSession } from "@/lib/auth";
import { createSupabasePageClient } from "@/lib/supabase/page";
import { getFormatters, getT } from "@/lib/i18n/server";
import { isEnabled } from "@/lib/feature-flags";
import { getPagesT } from "@/features/pages/i18n/server";
import type { MessageKey } from "@/lib/i18n/translate";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("notifications.page.title") };
}

const STATUSES = new Set(["sent", "queued", "sending", "bounced", "failed", "suppressed"]);
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
  const [t, format] = await Promise.all([getT(), getFormatters()]);
  const supabase = await createSupabasePageClient();

  const [{ data: prefRow }, { data: deliveryRows }, { data: projects }] = await Promise.all([
    supabase
      .from("notification_preference")
      .select(PREFERENCE_COLUMNS)
      .eq("user_id", session.userId)
      .maybeSingle(),
    supabase
      .from("email_delivery")
      .select("id, subject, status, created_at, sent_at, scheduled_for")
      .eq("recipient_user_id", session.userId)
      .order("created_at", { ascending: false })
      .limit(8),
    supabase.from("project").select("id, name").is("archived_at", null).order("name").limit(50),
  ]);

  const values: PreferenceValues = {
    ...DEFAULT_PREFERENCES,
    timezone: session.profile.timezone || DEFAULT_PREFERENCES.timezone,
    ...((prefRow ?? {}) as Partial<PreferenceValues>),
    category_modes:
      ((prefRow as { category_modes?: PreferenceValues["category_modes"] } | null)?.category_modes) ??
      {},
    muted_project_ids:
      ((prefRow as { muted_project_ids?: string[] } | null)?.muted_project_ids) ?? [],
  };

  const deliveries = (deliveryRows ?? []) as unknown as RecentDelivery[];

  return (
    <div className="max-w-3xl">
      <PageHeader
        eyebrow={t("notifications.page.eyebrow")}
        title={t("notifications.page.heading")}
        description={
          // With wos_pages on (C3) a kind of notice can also be kept out of the Hub.
          (await isEnabled("wos_pages"))
            ? (await getPagesT())("units.c3.preferences.description")
            : t("notifications.page.description")
        }
      />

      <NotificationPreferencesForm
        values={values}
        projects={(projects ?? []) as { id: string; name: string }[]}
      />

      <section aria-labelledby="recent-email" className="mt-10">
        <h2 id="recent-email" className="section-heading mb-3">
          {t("notifications.page.recentHeading")}
        </h2>
        {deliveries.length === 0 ? (
          <p className="card px-4 py-6 text-center text-[13px] text-muted">
            {t("notifications.page.recentEmpty")}
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
                      ? t("notifications.page.sentAt", {
                          when: format.dateTime(delivery.sent_at),
                        })
                      : delivery.scheduled_for
                        ? t("notifications.page.heldUntil", {
                            when: format.dateTime(delivery.scheduled_for),
                          })
                        : format.relative(delivery.created_at)}
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
                  {STATUSES.has(delivery.status)
                    ? t(`notifications.page.status.${delivery.status}` as MessageKey)
                    : delivery.status}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
