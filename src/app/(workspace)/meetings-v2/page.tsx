import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { requireSession } from "@/lib/auth";
import { getFormatters, getLocale } from "@/lib/i18n/server";
import { meetingsV2Enabled } from "@/features/meetings-v2/flag";
import { meetingsV2T, type MeetingsV2T } from "@/features/meetings-v2/i18n";
import { listMeetingObjects, type MeetingListRow } from "@/features/meetings-v2/services/meeting-v2.queries";
import type { Formatters } from "@/lib/i18n/format";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return { title: meetingsV2T(await getLocale())("index.title") };
}

/**
 * Meetings as objects (Workspace OS V1-9): the index behind `wos_meetings_v2`,
 * the next meetings and the most recent ones, each opening its object page.
 * Loading is the route's skeleton; a failed read reaches the workspace error
 * page through the page client (P0-UX-05).
 */
export default async function MeetingObjectsPage() {
  if (!(await meetingsV2Enabled())) notFound();
  const session = await requireSession();
  const [locale, format, { upcoming, recent }] = await Promise.all([getLocale(), getFormatters(), listMeetingObjects()]);
  const t = meetingsV2T(locale);

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title={t("index.title")}
        description={t("index.description")}
        actions={
          <Link
            href="/meetings"
            className="inline-flex h-9.5 items-center rounded-(--radius-sm) border border-line bg-surface px-4 text-sm text-ink hover:bg-surface-soft"
          >
            {t("index.classicList")}
          </Link>
        }
      />

      <MeetingList id="mv2-upcoming" heading={t("index.upcoming")} empty={t("index.upcomingEmpty")} rows={upcoming} t={t} format={format} timeZone={session.timeZone} />
      <MeetingList id="mv2-recent" heading={t("index.recent")} empty={t("index.recentEmpty")} rows={recent} t={t} format={format} timeZone={session.timeZone} />
    </div>
  );
}

function MeetingList({
  id,
  heading,
  empty,
  rows,
  t,
  format,
  timeZone,
}: {
  id: string;
  heading: string;
  empty: string;
  rows: MeetingListRow[];
  t: MeetingsV2T;
  format: Formatters;
  timeZone: string;
}) {
  return (
    <section aria-labelledby={id} className="mb-8">
      <h2 id={id} className="section-heading mb-3">{heading}</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">{empty}</p>
      ) : (
        <ul className="card divide-y divide-line">
          {rows.map((meeting) => (
            <li key={meeting.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 p-3 text-sm">
              <div className="min-w-0 flex-1">
                <Link href={`/meetings-v2/${meeting.id}`} className="font-semibold text-ink hover:underline">
                  {meeting.title}
                </Link>
                <p className="mt-0.5 text-[12.5px] text-muted">
                  {[format.dateTime(meeting.startsAt, timeZone), meeting.organizer, meeting.project].filter(Boolean).join(" · ")}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="brand">{t(`status.${meeting.status}`)}</Badge>
                {meeting.openCaptures > 0 ? (
                  <Link href={`/meetings-v2/${meeting.id}/review`} className="text-brand-fg underline">
                    {t("index.review", { count: meeting.openCaptures })}
                  </Link>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
