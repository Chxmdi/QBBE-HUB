import type { Metadata } from "next";
import { ShieldCheck } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { AdminNav } from "@/features/admin/components/admin-nav";
import { PolicyEditor } from "@/features/retention/components/policy-editor";
import {
  actionLabel,
  describeDuration as describeDays,
  localizeSubject,
} from "@/features/retention/schemas";
import { getRetentionOverview } from "@/features/retention/services/retention.queries";
import { requireAdminAal2 } from "@/lib/auth";
import { getFormatters, getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("retention.title") };
}
export const dynamic = "force-dynamic";

/**
 * Admin → Retention.
 *
 * The page is built around one idea: nobody should switch on a deletion rule
 * without seeing the number first. Every row shows what the current settings
 * would remove tonight, computed by the same code the job will run, and a
 * policy is created switched off so that number can be read before anything
 * happens.
 */
export default async function AdminRetentionPage() {
  const session = await requireAdminAal2();
  const now = new Date();
  const { subjects, runs } = await getRetentionOverview(session.organizationId, now);
  const t = await getT();
  const format = await getFormatters();
  const describeDuration = (days: number) =>
    describeDays(days, t, (value) => format.number(value));

  return (
    <div>
      <AdminNav />
      <PageHeader
        eyebrow={t("retention.eyebrow")}
        title={t("retention.title")}
        description={t("retention.description")}
      />

      <ul className="space-y-3">
        {subjects.map(({ subject: stored, policy, wouldAffect }) => {
          const subject = localizeSubject(stored, t);
          return (
          <li key={subject.key} className="card px-4 py-3">
            <div className="flex flex-wrap items-start gap-2">
              <span className="min-w-0 flex-1 text-[13.5px] font-medium">
                {subject.label}
              </span>
              {policy?.enabled ? (
                <Badge tone="success">
                  {t("retention.enabledBadge", {
                    duration: describeDuration(policy.retain_days),
                    outcome: t(
                      policy.action === "delete"
                        ? "retention.outcomeDeleted"
                        : "retention.outcomeRedacted",
                    ),
                  })}
                </Badge>
              ) : policy ? (
                <Badge tone="neutral">{t("retention.setNotOn")}</Badge>
              ) : (
                <Badge tone="neutral">{t("retention.keptIndefinitely")}</Badge>
              )}
            </div>

            <p className="meta mt-0.5">{subject.description}</p>

            <p className="meta">
              {t("retention.floor", { duration: describeDuration(subject.minimum_days) })}
              {" · "}
              {subject.allowed_actions.map((a) => actionLabel(a, t)).join(t("retention.or"))}
            </p>

            {subject.caution ? (
              <p className="mt-1 text-[13px] text-muted">{subject.caution}</p>
            ) : null}

            {wouldAffect !== null ? (
              <p
                className={
                  wouldAffect > 0
                    ? "mt-1 text-[13px] font-medium text-warning-fg"
                    : "meta mt-1"
                }
              >
                {wouldAffect > 0
                  ? t("retention.wouldAffect", {
                      count: format.number(wouldAffect),
                      duration: describeDuration(policy?.retain_days ?? subject.default_days),
                    })
                  : t("retention.nothingOlder", {
                      duration: describeDuration(policy?.retain_days ?? subject.default_days),
                    })}
              </p>
            ) : null}

            {policy?.last_run_at ? (
              <p className="meta">
                {t("retention.lastRun", { when: format.relative(policy.last_run_at) })}
                {policy.last_affected !== null
                  ? t("retention.lastAffected", { count: format.number(policy.last_affected) })
                  : ""}
                .
              </p>
            ) : null}

            {policy?.note ? (
              <p className="mt-1 text-[13px] text-muted">{policy.note}</p>
            ) : null}

            <PolicyEditor
              subject={subject}
              policy={policy}
              wouldAffect={wouldAffect}
            />
          </li>
          );
        })}
      </ul>

      <section aria-labelledby="retention-runs" className="mt-8">
        <h2 id="retention-runs" className="section-heading mb-3">
          {t("retention.runsHeading")}
        </h2>
        {runs.length === 0 ? (
          <p className="card px-4 py-6 text-center text-[13px] text-muted">
            {t("retention.runsEmpty")}
          </p>
        ) : (
          <ul className="card divide-y divide-line">
            {runs.map((run) => (
              <li key={run.id} className="px-4 py-2.5 text-[13px]">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{run.subject_key}</span>
                  <Badge tone={run.error ? "danger" : "neutral"}>
                    {run.error
                      ? t("retention.runFailed")
                      : t("retention.runAffected", { count: format.number(run.affected) })}
                  </Badge>
                  <span className="meta ml-auto">{format.relative(run.ran_at)}</span>
                </div>
                <p className="meta">
                  {t("retention.runCutoff", {
                    date: format.dateTime(run.cutoff),
                    method: t(
                      run.action === "delete"
                        ? "retention.methodDeletion"
                        : "retention.methodRedaction",
                    ),
                  })}
                </p>
                {run.error ? (
                  <p className="text-[12.5px] text-danger-fg">{run.error}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="meta mt-6 flex max-w-2xl items-start gap-2">
        <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>
          {t("retention.footer")}
        </span>
      </p>
    </div>
  );
}
