import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { requireSession } from "@/lib/auth";
import { getFormatters, getLocale } from "@/lib/i18n/server";
import { decisionsV2Enabled } from "@/features/decisions/flag";
import { decisionsV2T } from "@/features/decisions/i18n";
import { getDecision } from "@/features/decisions/services/decision-v2.queries";
import { DecisionFields } from "@/features/decisions/components/decision-fields";
import { DecisionRecordForm } from "@/features/decisions/components/decision-record-form";
import { ParticipantsEditor } from "@/features/decisions/components/participants-editor";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return { title: decisionsV2T(await getLocale())("title") };
}

export default async function DecisionPage({ params }: { params: Promise<{ id: string }> }) {
  if (!(await decisionsV2Enabled())) notFound();
  await requireSession();
  const { id } = await params;
  const [locale, format] = await Promise.all([getLocale(), getFormatters()]);
  const t = decisionsV2T(locale);
  const found = await getDecision(id);
  if (!found) notFound();
  const { decision, canManage, people } = found;

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        eyebrow={t("title")}
        title={decision.title}
        actions={
          decision.project ? (
            <Link href={`/decisions/trail/${decision.project.id}`} className="text-sm text-brand-fg underline">
              {t("trailTitle")}
            </Link>
          ) : undefined
        }
      />
      <p className="mb-6 flex flex-wrap items-center gap-2 text-[13px] text-muted">
        <span>{t("decidedOn")} {format.date(decision.decidedAt)}</span>
        {decision.decidedBy ? <span>· {t("decidedBy", { name: decision.decidedBy })}</span> : null}
        {decision.meeting ? <span>· {t("inMeeting", { meeting: decision.meeting.title })}</span> : null}
        {decision.revisitOn ? (
          <Badge tone="info">{t("revisitOn", { date: format.date(`${decision.revisitOn}T12:00:00Z`) })}</Badge>
        ) : null}
        {decision.reopenedAt ? <Badge tone="warning">{t("reopened")}</Badge> : null}
      </p>

      <div className="grid gap-8 lg:grid-cols-[1fr_18rem]">
        <div className="min-w-0 space-y-6">
          {canManage ? (
            <DecisionRecordForm decision={decision} />
          ) : (
            <>
              <DecisionFields decision={decision} t={t} />
              <p className="text-[12.5px] text-muted">{t("form.readOnly")}</p>
            </>
          )}
        </div>
        <section aria-labelledby="dv2-participants" className="space-y-3">
          <h2 id="dv2-participants" className="section-heading">{t("fields.participants")}</h2>
          <ParticipantsEditor
            decisionId={decision.id}
            participants={decision.participants}
            people={people}
            canManage={canManage}
          />
        </section>
      </div>
    </div>
  );
}
