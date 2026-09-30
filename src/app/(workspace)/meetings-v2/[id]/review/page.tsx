import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { requireSession } from "@/lib/auth";
import { getLocale } from "@/lib/i18n/server";
import { meetingsV2Enabled } from "@/features/meetings-v2/flag";
import { meetingsV2T } from "@/features/meetings-v2/i18n";
import { getMeetingObject } from "@/features/meetings-v2/services/meeting-v2.queries";
import { ReviewForm } from "@/features/meetings-v2/components/review-form";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return { title: meetingsV2T(await getLocale())("review.title") };
}

export default async function MeetingReviewPage({ params }: { params: Promise<{ id: string }> }) {
  if (!(await meetingsV2Enabled())) notFound();
  await requireSession();
  const { id } = await params;
  const t = meetingsV2T(await getLocale());
  const view = await getMeetingObject(id);
  if (!view) notFound();
  const { meeting, captures, canManage } = view;
  const open = captures.filter((c) => c.status === "open");
  const reviewed = captures.filter((c) => c.status !== "open");

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        eyebrow={meeting.title}
        title={t("review.title")}
        description={t("review.description")}
        actions={
          <Link href={`/meetings-v2/${meeting.id}`} className="text-sm text-brand-fg underline">
            {t("review.backToMeeting")}
          </Link>
        }
      />

      {!canManage ? (
        <p role="note" className="card mb-6 p-4 text-sm text-ink">{t("review.notOrganizer")}</p>
      ) : null}

      {open.length === 0 ? (
        <p className="mb-6 text-sm text-muted">{t("review.nothingOpen")}</p>
      ) : canManage ? (
        <ReviewForm
          meetingId={meeting.id}
          captures={open.map((c) => ({ id: c.id, kind: c.kind, body: c.body, ownerName: c.ownerName, dueOn: c.dueOn }))}
        />
      ) : (
        <ul className="mb-6 space-y-2">
          {open.map((c) => (
            <li key={c.id} className="card p-3 text-sm text-ink">{t(`kind.${c.kind}`)}: {c.body}</li>
          ))}
        </ul>
      )}

      {reviewed.length > 0 ? (
        <section aria-labelledby="mv2-reviewed" className="mt-8">
          <h2 id="mv2-reviewed" className="section-heading mb-3">{t("review.reviewed")}</h2>
          <ul className="space-y-2">
            {reviewed.map((c) => (
              <li key={c.id} className="card flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
                <span className="text-ink">{t(`kind.${c.kind}`)}: {c.body}</span>
                <span className="flex items-center gap-2">
                  <Badge tone={c.status === "approved" ? "success" : "neutral"}>{t(`captureStatus.${c.status}`)}</Badge>
                  {c.createdObjectType === "task" && c.createdObjectId ? (
                    <Link href={`/my-work?task=${c.createdObjectId}`} className="text-brand-fg underline">{t("review.createdTask")}</Link>
                  ) : c.createdObjectType === "decision" ? (
                    <span className="text-[12.5px] text-muted">{t("review.createdDecision")}</span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
