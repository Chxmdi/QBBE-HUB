import { AlertTriangle, ShieldAlert } from "lucide-react";
import { EntityFormDialog } from "@/components/shared/entity-form-dialog";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import {
  ISSUE_SEVERITIES,
  RISK_BAND_LABELS,
  RISK_IMPACTS,
  RISK_LIKELIHOODS,
  riskBand,
  riskNeedsReview,
} from "@/features/risks/schemas";
import { createIssue, createRisk } from "@/features/risks/services/risk.commands";
import type { IssueRow, RaidLog, RiskRow } from "@/features/risks/services/risk.queries";
import { IssueControls, RiskControls } from "./raid-controls";
import { cn, formatDate } from "@/lib/utils";

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

const OPTION = (values: readonly string[]) =>
  values.map((value) => ({
    value,
    label: value.charAt(0).toUpperCase() + value.slice(1),
  }));

export function RaidLogPanel({
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
  const today = new Date().toISOString().slice(0, 10);
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
            {log.needingReview} {log.needingReview === 1 ? "risk is" : "risks are"} due
            for review.
          </strong>{" "}
          Confirm the likelihood and impact still hold, or settle them.
        </p>
      ) : null}

      {/* Risks — what might happen */}
      <section aria-labelledby="project-risks">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 id="project-risks" className="section-heading">
            Risks
            <span className="ml-2 font-normal text-muted">{log.openRisks.length} open</span>
          </h2>
          {canManage ? (
            <EntityFormDialog
              triggerLabel="Log a risk"
              triggerVariant="secondary"
              title="Log a risk"
              submitLabel="Log risk"
              extraValues={{ projectId }}
              action={createRisk}
              fields={[
                { name: "title", label: "What might happen", type: "text", required: true },
                { name: "description", label: "Detail", type: "textarea" },
                {
                  name: "likelihood",
                  label: "Likelihood",
                  type: "select",
                  required: true,
                  defaultValue: "medium",
                  colSpan: 1,
                  options: OPTION(RISK_LIKELIHOODS),
                },
                {
                  name: "impact",
                  label: "Impact if it happens",
                  type: "select",
                  required: true,
                  defaultValue: "medium",
                  colSpan: 1,
                  options: OPTION(RISK_IMPACTS),
                },
                {
                  name: "mitigation",
                  label: "What we are doing about it",
                  type: "textarea",
                  hint: "Required before a risk can be accepted or closed.",
                },
                {
                  name: "ownerId",
                  label: "Owner",
                  type: "select",
                  colSpan: 1,
                  options: peopleOptions,
                },
                { name: "reviewAt", label: "Review on", type: "date", colSpan: 1 },
              ]}
            />
          ) : null}
        </div>

        {log.openRisks.length === 0 ? (
          <EmptyState
            icon={<ShieldAlert aria-hidden />}
            title="No open risks"
            description="Log what might go wrong while there is still time to do something about it."
          />
        ) : (
          <ul className="card divide-y divide-line">
            {log.openRisks.map((risk) => (
              <RiskItem
                key={risk.id}
                risk={risk}
                today={today}
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
              Settled risks ({log.settledRisks.length})
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
                    <Badge tone="neutral">{risk.status}</Badge>
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
            Issues
            <span className="ml-2 font-normal text-muted">{log.openIssues.length} open</span>
          </h2>
          {canManage ? (
            <EntityFormDialog
              triggerLabel="Raise an issue"
              triggerVariant="secondary"
              title="Raise an issue"
              submitLabel="Raise issue"
              extraValues={{ projectId }}
              action={createIssue}
              fields={[
                { name: "title", label: "What has happened", type: "text", required: true },
                { name: "description", label: "Detail", type: "textarea" },
                {
                  name: "severity",
                  label: "Severity",
                  type: "select",
                  required: true,
                  defaultValue: "medium",
                  colSpan: 1,
                  options: OPTION(ISSUE_SEVERITIES),
                },
                { name: "dueAt", label: "Resolve by", type: "date", colSpan: 1 },
                {
                  name: "ownerId",
                  label: "Owner",
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
            title="No open issues"
            description="Issues are things that have already happened and need resolving."
          />
        ) : (
          <ul className="card divide-y divide-line">
            {log.openIssues.map((issue) => (
              <IssueItem
                key={issue.id}
                issue={issue}
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
              Resolved issues ({log.settledIssues.length})
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
                    <Badge tone="neutral">{issue.status}</Badge>
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
}: {
  risk: RiskRow;
  today: string;
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
        <Badge tone={BAND_TONE[band]}>{RISK_BAND_LABELS[band]}</Badge>
        <Badge tone="neutral">{risk.status}</Badge>
      </div>

      <p className="meta mt-0.5">
        {risk.likelihood} likelihood · {risk.impact} impact
        {risk.owner ? ` · ${risk.owner.full_name}` : " · unowned"}
        {risk.review_at ? ` · review ${formatDate(risk.review_at)}` : ""}
        {dueForReview ? " · due for review" : ""}
      </p>

      {risk.description ? (
        <p className="mt-1 text-[13px] text-muted">{risk.description}</p>
      ) : null}
      {risk.mitigation ? (
        <p className="mt-1 text-[13px]">
          <span className="text-muted">Mitigation: </span>
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
}: {
  issue: IssueRow;
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
        <Badge tone={SEVERITY_TONE[issue.severity]}>{issue.severity}</Badge>
        <Badge tone="neutral">{issue.status}</Badge>
      </div>

      <p className="meta mt-0.5">
        {issue.owner ? issue.owner.full_name : "unowned"}
        {issue.due_at ? ` · resolve by ${formatDate(issue.due_at)}` : ""}
        {issue.risk_id ? " · escalated from a risk" : ""}
      </p>

      {issue.description ? (
        <p className="mt-1 text-[13px] text-muted">{issue.description}</p>
      ) : null}

      {canManage ? (
        <IssueControls issueId={issue.id} status={issue.status} people={people} />
      ) : null}
    </li>
  );
}
