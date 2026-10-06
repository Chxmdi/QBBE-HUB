import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { requireSession } from "@/lib/auth";
import { getFormatters, getLocale } from "@/lib/i18n/server";
import { calendarDateInZone, DEFAULT_TIME_ZONE } from "@/lib/time";
import { decisionsV2Enabled } from "@/features/decisions/flag";
import { decisionsV2T } from "@/features/decisions/i18n";
import { getDecisionTrail } from "@/features/decisions/services/decision-v2.queries";
import { DecisionFields } from "@/features/decisions/components/decision-fields";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return { title: decisionsV2T(await getLocale())("trailTitle") };
}

/** Every decision on one project, newest first, with the full record. */
export default async function DecisionTrailPage({ params }: { params: Promise<{ projectId: string }> }) {
  if (!(await decisionsV2Enabled())) notFound();
  const session = await requireSession();
  const { projectId } = await params;
  const [locale, format] = await Promise.all([getLocale(), getFormatters()]);
  const t = decisionsV2T(locale);
  const trail = await getDecisionTrail(projectId);
  if (!trail) notFound();
  const today = calendarDateInZone(new Date(), session.timeZone ?? DEFAULT_TIME_ZONE) ?? new Date().toISOString().slice(0, 10);

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        eyebrow={trail.project.name}
        title={t("trailTitle")}
        description={t("trailDescription", { project: trail.project.name })}
        actions={
          <Link href={`/projects/${trail.project.id}`} className="text-sm text-brand-fg underline">
            {t("backToProject")}
          </Link>
        }
      />
      {trail.decisions.length === 0 ? (
        <p className="text-sm text-muted">{t("trailEmpty")}</p>
      ) : (
        <ol className="relative space-y-6 border-l border-line pl-6">
          {trail.decisions.map((d) => (
            <li key={d.id} className="card relative p-4">
              <span aria-hidden className="absolute -left-[31px] top-5 size-3 rounded-full border-2 border-surface bg-brand" />
              <h2 className="text-[15px] font-semibold text-ink">
                <Link href={`/decisions/${d.id}`} className="hover:underline">{d.title}</Link>
              </h2>
              <p className="mb-3 mt-1 flex flex-wrap items-center gap-2 text-[12.5px] text-muted">
                <time dateTime={d.decidedAt}>{format.date(d.decidedAt)}</time>
                {d.decidedBy ? <span>· {t("decidedBy", { name: d.decidedBy })}</span> : null}
                {d.meeting ? <span>· {t("inMeeting", { meeting: d.meeting.title })}</span> : null}
                {d.participants.length > 0 ? <span>· {d.participants.map((p) => p.name).join(", ")}</span> : null}
                {d.reopenedAt ? <Badge tone="warning">{t("reopened")}</Badge> : null}
                {d.revisitOn ? (
                  <Badge tone={d.revisitOn <= today ? "warning" : "info"}>
                    {d.revisitOn <= today ? t("revisitDue") : t("revisitOn", { date: format.date(`${d.revisitOn}T12:00:00Z`) })}
                  </Badge>
                ) : null}
              </p>
              <DecisionFields decision={d} t={t} />
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
