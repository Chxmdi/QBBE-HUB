import { AlertTriangle, ShieldAlert } from "lucide-react";
import { EntityFormDialog } from "@/components/shared/entity-form-dialog";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import {
  ISSUE_SEVERITIES,
  RISK_IMPACTS,
  RISK_LIKELIHOODS,
  issueSeverityLabel,
  issueStatusLabel,
  riskBand,
  riskBandLabel,
  riskLevelLabel,
  riskNeedsReview,
  riskStatusLabel,
} from "@/features/risks/schemas";
import { createIssue, createRisk } from "@/features/risks/services/risk.commands";
import type { IssueRow, RaidLog, RiskRow } from "@/features/risks/services/risk.queries";
import { IssueControls, RiskControls } from "./raid-controls";
import { cn } from "@/lib/utils";
import { getFormatters, getT } from "@/lib/i18n/server";
import type { Formatters } from "@/lib/i18n/format";
import type { TranslateFn } from "@/lib/i18n/translate";

/**
 * The project's risk and issue log on one screen.
 *
 * Risks and issues are separated because they ask different things of a reader
 * — one to watch, one to fix — but they sit together because a lead reviews
 * them in one pass, and because a risk becoming an issue is a move between the
 * two halves rather than a jump between screens.
 *
 * Settled items stay, folded away. A closed risk is the record of a decision;
 * deleting it would erase the reasoning.
 */

const BAND_TONE = {
  low: "neutral",
  moderate: "info",
  high: "warning",
  severe: "danger",
} as const;

const SEVERITY_TONE = {
  low: "neutral",
  medium: "info",
  high: "warning",
  critical: "danger",
} as const;

/**
 * How a deep-linked row announces itself. Colour alone would fail WCAG 1.4.1,
 * so the ring carries the same message as the tint.
 */
const HIGHLIGHT = "bg-accent/15 ring-1 ring-brand/40";

const OPTION = (
  values: readonly ("low" | "medium" | "high" | "critical")[],
  kind: "likelihood" | "impact" | "severity",
  t: TranslateFn,
) =>
  values.map((value) => ({
    value,
    label: riskLevelLabel(value, kind, t),
  }));

export async function RaidLogPanel({
  log,
  projectId,
  people,
  canManage,
  highlightRiskId = null,
  highlightIssueId = null,
}: {
  log: RaidLog;
  projectId: string;
  /** Picker options, in the shape the rest of the project page already uses. */
  people: { id: string; label: string }[];
  canManage: boolean;
  /** Deep-linked from search; the row is anchored and marked. */
  highlightRiskId?: string | null;
  highlightIssueId?: string | null;
}) {
  // The date the log was built against, not a fresh one. Deriving it here from
  // the browser's clock is what let a row read "due for review" while the count
  // above it disagreed.
  const today = log.today;
  const t = await getT();
  const format = await getFormatters();
  const peopleOptions = people.map((p) => ({ value: p.id, label: p.label }));

  // A search result pointing at a settled risk must not land on a collapsed
  // section: that looks like the link went nowhere.
  const settledRiskLinked = log.settledRisks.some((r) => r.id === highlightRiskId);
  const settledIssueLinked = log.settledIssues.some((i) => i.id === highlightIssueId);

  return (
    <div className="space-y-10">
      {log.needingReview > 0 ? (
        <p className="card border-warning/40 bg-warning/8 px-4 py-3 text-[13.5px]">
          <strong className="font-semibold">
            {t(
              log.needingReview === 1
                ? "risks.log.dueForReviewOne"
                : "risks.log.dueForReviewOther",
              { count: log.needingReview },
            )}
          </strong>{" "}
          {t("risks.log.dueForReviewBody")}
        </p>
      ) : null}

      {/* Risks — what might happen */}
      <section aria-labelledby="project-risks">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 id="project-risks" className="section-heading">
            {t("risks.log.risksHeading")}
            <span className="ml-2 font-normal text-muted">
              {t("risks.log.openCount", { count: log.openRisks.length })}
            </span>
          </h2>
          {canManage ? (
            <EntityFormDialog
              triggerLabel={t("risks.log.logRisk")}
              triggerVariant="secondary"
              title={t("risks.log.logRisk")}
              submitLabel={t("risks.log.logRiskSubmit")}
              extraValues={{ projectId }}
              action={createRisk}
              fields={[
                { name: "title", label: t("risks.log.riskTitle"), type: "text", required: true },
                { name: "description", label: t("risks.log.detail"), type: "textarea" },
                {
                  name: "likelihood",
                  label: t("risks.log.likelihood"),
                  type: "select",
                  required: true,
                  defaultValue: "medium",
                  colSpan: 1,
                  options: OPTION(RISK_LIKELIHOODS, "likelihood", t),
                },
                {
                  name: "impact",
                  label: t("risks.log.impactIfHappens"),
                  type: "select",
                  required: true,
                  defaultValue: "medium",
                  colSpan: 1,
                  options: OPTION(RISK_IMPACTS, "impact", t),
                },
                {
                  name: "trigger",
                  label: t("risks.log.trigger"),
                  type: "textarea",
                },
                {
                  name: "mitigation",
                  label: t("risks.log.mitigation"),
                  type: "textarea",
                  hint: t("risks.log.mitigationHint"),
                },
                {
                  name: "ownerId",
                  label: t("risks.log.owner"),
                  type: "select",
                  colSpan: 1,
                  options: peopleOptions,
                },
                { name: "reviewAt", label: t("risks.log.reviewOn"), type: "date", colSpan: 1 },
              ]}
            />
          ) : null}
        </div>

        {log.openRisks.length === 0 ? (
          <EmptyState
            icon={<ShieldAlert aria-hidden />}
            title={t("risks.log.noRisksTitle")}
            description={t("risks.log.noRisksBody")}
          />
        ) : (
          <ul className="card divide-y divide-line">
            {log.openRisks.map((risk) => (
              <RiskItem
                key={risk.id}
                risk={risk}
                today={today}
                t={t}
                format={format}
                people={peopleOptions}
                canManage={canManage}
                highlighted={risk.id === highlightRiskId}
              />
            ))}
          </ul>
        )}

        {log.settledRisks.length > 0 ? (
          <details className="card mt-3 px-4 py-3" open={settledRiskLinked}>
            <summary className="cursor-pointer text-[13.5px] font-medium">
              {t("risks.log.settledRisks", { count: log.settledRisks.length })}
            </summary>
            <ul className="mt-2 divide-y divide-line">
              {log.settledRisks.map((risk) => (
                <li
                  key={risk.id}
                  id={`risk-${risk.id}`}
                  className={cn(
                    "py-2.5",
                    risk.id === highlightRiskId && HIGHLIGHT,
                  )}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 flex-1 text-[13.5px]">{risk.title}</span>
                    <Badge tone="neutral">{riskStatusLabel(risk.status, t)}</Badge>
                  </div>
                  {risk.mitigation ? (
                    <p className="meta mt-0.5">{risk.mitigation}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </section>

      {/* Issues — what has happened */}
      <section aria-labelledby="project-issues">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 id="project-issues" className="section-heading">
            {t("risks.log.issuesHeading")}
            <span className="ml-2 font-normal text-muted">
              {t("risks.log.openCount", { count: log.openIssues.length })}
            </span>
          </h2>
          {canManage ? (
            <EntityFormDialog
              triggerLabel={t("risks.log.raiseIssue")}
              triggerVariant="secondary"
              title={t("risks.log.raiseIssue")}
              submitLabel={t("risks.log.raiseIssueSubmit")}
              extraValues={{ projectId }}
              action={createIssue}
              fields={[
                { name: "title", label: t("risks.log.issueTitle"), type: "text", required: true },
                { name: "description", label: t("risks.log.detail"), type: "textarea" },
                { name: "impact", label: t("risks.log.impact"), type: "textarea" },
                { name: "resolutionPlan", label: t("risks.log.resolutionPlan"), type: "textarea" },
                {
                  name: "severity",
                  label: t("risks.log.severity"),
                  type: "select",
                  required: true,
                  defaultValue: "medium",
                  colSpan: 1,
                  options: OPTION(ISSUE_SEVERITIES, "severity", t),
                },
                { name: "dueAt", label: t("risks.log.resolveBy"), type: "date", colSpan: 1 },
                {
                  name: "ownerId",
                  label: t("risks.log.owner"),
                  type: "select",
                  options: peopleOptions,
                },
              ]}
            />
          ) : null}
        </div>

        {log.openIssues.length === 0 ? (
          <EmptyState
            icon={<AlertTriangle aria-hidden />}
            title={t("risks.log.noIssuesTitle")}
            description={t("risks.log.noIssuesBody")}
          />
        ) : (
          <ul className="card divide-y divide-line">
            {log.openIssues.map((issue) => (
              <IssueItem
                key={issue.id}
                issue={issue}
                t={t}
                format={format}
                people={peopleOptions}
                canManage={canManage}
                highlighted={issue.id === highlightIssueId}
              />
            ))}
          </ul>
        )}

        {log.settledIssues.length > 0 ? (
          <details className="card mt-3 px-4 py-3" open={settledIssueLinked}>
            <summary className="cursor-pointer text-[13.5px] font-medium">
              {t("risks.log.resolvedIssues", { count: log.settledIssues.length })}
            </summary>
            <ul className="mt-2 divide-y divide-line">
              {log.settledIssues.map((issue) => (
                <li
                  key={issue.id}
                  id={`issue-${issue.id}`}
                  className={cn(
                    "py-2.5",
                    issue.id === highlightIssueId && HIGHLIGHT,
                  )}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 flex-1 text-[13.5px]">{issue.title}</span>
                    <Badge tone="neutral">{issueStatusLabel(issue.status, t)}</Badge>
                  </div>
                  {issue.resolution ? (
                    <p className="meta mt-0.5">{issue.resolution}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </section>
    </div>
  );
}

function RiskItem({
  risk,
  today,
  people,
  canManage,
  highlighted,
  t,
  format,
}: {
  risk: RiskRow;
  today: string;
  t: TranslateFn;
  format: Formatters;
  people: { value: string; label: string }[];
  canManage: boolean;
  highlighted: boolean;
}) {
  const band = riskBand(risk.score);
  const dueForReview = riskNeedsReview(risk, today);

  return (
    <li
      id={`risk-${risk.id}`}
      className={cn("px-4 py-3", highlighted && HIGHLIGHT)}
    >
      <div className="flex flex-wrap items-start gap-2">
        <span className="min-w-0 flex-1 text-[13.5px] font-medium">{risk.title}</span>
        <Badge tone={BAND_TONE[band]}>{riskBandLabel(band, t)}</Badge>
        <Badge tone="neutral">{riskStatusLabel(risk.status, t)}</Badge>
      </div>

      <p className="meta mt-0.5">
        {t(`risks.likelihoodPhrase.${risk.likelihood}`)} ·{" "}
        {t(`risks.impactPhrase.${risk.impact}`)}
        {risk.owner ? ` · ${risk.owner.full_name}` : t("risks.log.unownedSuffix")}
        {risk.review_at
          ? t("risks.log.reviewSuffix", { date: format.date(risk.review_at) })
          : ""}
        {dueForReview ? t("risks.log.dueForReviewSuffix") : ""}
      </p>

      {risk.trigger ? (
        <p className="mt-1 text-[13px]">
          <span className="text-muted">{t("risks.log.triggerPrefix")}</span>
          {risk.trigger}
        </p>
      ) : null}
      {risk.description ? (
        <p className="mt-1 text-[13px] text-muted">{risk.description}</p>
      ) : null}
      {risk.mitigation ? (
        <p className="mt-1 text-[13px]">
          <span className="text-muted">{t("risks.log.mitigationPrefix")}</span>
          {risk.mitigation}
        </p>
      ) : null}

      {canManage ? (
        <RiskControls
          riskId={risk.id}
          status={risk.status}
          mitigation={risk.mitigation}
          people={people}
        />
      ) : null}
    </li>
  );
}

function IssueItem({
  issue,
  people,
  canManage,
  highlighted,
  t,
  format,
}: {
  issue: IssueRow;
  t: TranslateFn;
  format: Formatters;
  people: { value: string; label: string }[];
  canManage: boolean;
  highlighted: boolean;
}) {
  return (
    <li
      id={`issue-${issue.id}`}
      className={cn("px-4 py-3", highlighted && HIGHLIGHT)}
    >
      <div className="flex flex-wrap items-start gap-2">
        <span className="min-w-0 flex-1 text-[13.5px] font-medium">{issue.title}</span>
        <Badge tone={SEVERITY_TONE[issue.severity]}>
          {issueSeverityLabel(issue.severity, t)}
        </Badge>
        <Badge tone="neutral">{issueStatusLabel(issue.status, t)}</Badge>
      </div>

      <p className="meta mt-0.5">
        {issue.owner ? issue.owner.full_name : t("risks.log.unowned")}
        {issue.due_at
          ? t("risks.log.resolveBySuffix", { date: format.date(issue.due_at) })
          : ""}
        {issue.risk_id ? t("risks.log.escalatedSuffix") : ""}
      </p>

      {issue.impact ? (
        <p className="mt-1 text-[13px]">
          <span className="text-muted">{t("risks.log.impactPrefix")}</span>
          {issue.impact}
        </p>
      ) : null}
      {issue.resolution_plan ? (
        <p className="mt-1 text-[13px]">
          <span className="text-muted">{t("risks.log.resolutionPlanPrefix")}</span>
          {issue.resolution_plan}
        </p>
      ) : null}
      {issue.description ? (
        <p className="mt-1 text-[13px] text-muted">{issue.description}</p>
      ) : null}

      {canManage ? (
        <IssueControls issueId={issue.id} status={issue.status} people={people} />
      ) : null}
    </li>
  );
}
