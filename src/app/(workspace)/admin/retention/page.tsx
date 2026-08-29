import type { Metadata } from "next";
import { ShieldCheck } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { AdminNav } from "@/features/admin/components/admin-nav";
import { PolicyEditor } from "@/features/retention/components/policy-editor";
import { ACTION_LABELS, describeDuration } from "@/features/retention/schemas";
import { getRetentionOverview } from "@/features/retention/services/retention.queries";
import { requireAdmin } from "@/lib/auth";
import { formatDateTime, relativeTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Retention" };
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
  const session = await requireAdmin();
  const now = new Date();
  const { subjects, runs } = await getRetentionOverview(session.organizationId, now);

  return (
    <div>
      <AdminNav />
      <PageHeader
        eyebrow="Administration"
        title="Retention"
        description="How long each kind of record is kept. Policies are off until you switch them on, and each one shows what it would remove before it removes anything."
      />

      <ul className="space-y-3">
        {subjects.map(({ subject, policy, wouldAffect }) => (
          <li key={subject.key} className="card px-4 py-3">
            <div className="flex flex-wrap items-start gap-2">
              <span className="min-w-0 flex-1 text-[13.5px] font-medium">
                {subject.label}
              </span>
              {policy?.enabled ? (
                <Badge tone="success">
                  {describeDuration(policy.retain_days)}, then{" "}
                  {policy.action === "delete" ? "deleted" : "redacted"}
                </Badge>
              ) : policy ? (
                <Badge tone="neutral">Set but not switched on</Badge>
              ) : (
                <Badge tone="neutral">Kept indefinitely</Badge>
              )}
            </div>

            <p className="meta mt-0.5">{subject.description}</p>

            <p className="meta">
              Floor: {describeDuration(subject.minimum_days)}
              {" · "}
              {subject.allowed_actions.map((a) => ACTION_LABELS[a]).join(" or ")}
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
                  ? `${wouldAffect.toLocaleString()} records are already older than ${describeDuration(
                      policy?.retain_days ?? subject.default_days,
                    )}.`
                  : `Nothing is older than ${describeDuration(
                      policy?.retain_days ?? subject.default_days,
                    )} yet.`}
              </p>
            ) : null}

            {policy?.last_run_at ? (
              <p className="meta">
                Last run {relativeTime(policy.last_run_at)}
                {policy.last_affected !== null
                  ? `, ${policy.last_affected} affected`
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
        ))}
      </ul>

      <section aria-labelledby="retention-runs" className="mt-8">
        <h2 id="retention-runs" className="section-heading mb-3">
          What has been removed
        </h2>
        {runs.length === 0 ? (
          <p className="card px-4 py-6 text-center text-[13px] text-muted">
            Nothing yet. Every pass is recorded here, including the ones that
            removed nothing — deletion without a record of it is
            indistinguishable from data loss.
          </p>
        ) : (
          <ul className="card divide-y divide-line">
            {runs.map((run) => (
              <li key={run.id} className="px-4 py-2.5 text-[13px]">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{run.subject_key}</span>
                  <Badge tone={run.error ? "danger" : "neutral"}>
                    {run.error ? "Failed" : `${run.affected} affected`}
                  </Badge>
                  <span className="meta ml-auto">{relativeTime(run.ran_at)}</span>
                </div>
                <p className="meta">
                  Everything before {formatDateTime(run.cutoff)}, by{" "}
                  {run.action === "delete" ? "deletion" : "redaction"}.
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
          Only the record types listed above can be governed at all. Adding
          another is a schema change, deliberately — a retention system that can
          be pointed at any table is a compliance hole waiting for a
          well-meaning administrator.
        </span>
      </p>
    </div>
  );
}
