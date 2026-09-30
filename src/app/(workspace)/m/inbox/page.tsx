import type { Metadata } from "next";
import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { getFormatters, getLocale } from "@/lib/i18n/server";
import { Badge } from "@/components/ui/badge";
import { MarkReadButton } from "@/features/inbox/components/mark-read-button";
import { mobileT } from "@/features/mobile/i18n";
import { myNotifications } from "@/features/mobile/services/mobile.queries";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return { title: mobileT(await getLocale())("inbox.title") };
}

export default async function PhoneInbox() {
  const session = await requireSession();
  const [locale, format] = await Promise.all([getLocale(), getFormatters()]);
  const t = mobileT(locale);
  const items = await myNotifications();
  return (
    <div className="space-y-4">
      <h1 className="page-title">{t("inbox.title")}</h1>
      {items.length === 0 ? (
        <p className="text-sm text-muted">{t("inbox.empty")}</p>
      ) : (
        <ul className="space-y-2">
          {items.map((n) => (
            <li key={n.id} className="card space-y-1 p-3 text-sm">
              <div className="flex items-start justify-between gap-2">
                <p className="break-words font-medium text-ink">{n.title}</p>
                {!n.readAt ? <Badge tone="brand">{t("inbox.unread")}</Badge> : null}
              </div>
              {n.body ? <p className="break-words text-muted">{n.body}</p> : null}
              <div className="flex items-center justify-between gap-2 pt-1">
                <span className="text-[12.5px] text-muted">{format.dateTime(n.createdAt, session.timeZone)}</span>
                <span className="flex items-center gap-2">
                  {n.link ? (
                    <Link href={n.link} className="inline-flex min-h-11 items-center px-2 text-brand-fg underline">{t("inbox.open")}</Link>
                  ) : null}
                  {!n.readAt ? <MarkReadButton notificationId={n.id} /> : null}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
