import { Activity, Target } from "lucide-react";
import { EntityFormDialog } from "@/components/shared/entity-form-dialog";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import {
  DIRECTION_LABELS,
  METRIC_DIRECTIONS,
  OPERATION_STATUSES,
  OPERATION_STATUS_LABELS,
} from "@/features/outcomes/schemas";
import {
  createOutcomeMetric,
  recordMeasurement,
  recordOperation,
} from "@/features/outcomes/services/outcome.commands";
import type {
  MetricWithProgress,
  OperationRow,
  ProgramOutcomes,
} from "@/features/outcomes/services/outcome.queries";
import { formatDate } from "@/lib/utils";

/**
 * A program's delivery and its outcomes, side by side but never mixed.
 *
 * Outputs above, outcomes below, and the headline figures say which is which
 * in words — "sessions delivered" and "attendance" are not evidence of change,
 * and a panel that let them read as though they were would be helping a
 * charity write a misleading report.
 */

const STATUS_TONE = {
  planned: "info",
  delivered: "success",
  cancelled: "neutral",
} as const;

export function OutcomesPanel({
  outcomes,
  programId,
  people,
  projects,
  canManage,
}: {
  outcomes: ProgramOutcomes;
  programId: string;
  people: { id: string; label: string }[];
  projects: { id: string; label: string }[];
  canManage: boolean;
}) {
  const { summary } = outcomes;
  const option = (rows: { id: string; label: string }[]) =>
    rows.map((row) => ({ value: row.id, label: row.label }));

  return (
    <div className="space-y-10">
      <section aria-labelledby="program-delivery">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 id="program-delivery" className="section-heading">
            Delivery
            <span className="ml-2 font-normal text-muted">what we did</span>
          </h2>
          {canManage ? (
            <EntityFormDialog
              triggerLabel="Record a session"
              triggerVariant="secondary"
              title="Record a session"
              submitLabel="Record"
              extraValues={{ programId }}
              action={recordOperation}
              fields={[
                { name: "title", label: "What was it", type: "text", required: true },
                { name: "occurredOn", label: "Date", type: "date", required: true, colSpan: 1 },
                {
                  name: "status",
                  label: "Status",
                  type: "select",
                  required: true,
                  colSpan: 1,
                  defaultValue: "delivered",
                  options: OPERATION_STATUSES.map((value) => ({
                    value,
                    label: OPERATION_STATUS_LABELS[value],
                  })),
                },
                { name: "location", label: "Where", type: "text", colSpan: 1 },
                {
                  name: "attendeeCount",
                  label: "People who came",
                  type: "number",
                  colSpan: 1,
                  hint: "Required once it is marked delivered.",
                },
                { name: "durationHours", label: "Hours it ran", type: "number", colSpan: 1 },
                { name: "volunteerCount", label: "Volunteers", type: "number", colSpan: 1 },
                {
                  name: "ledBy",
                  label: "Led by",
                  type: "select",
                  colSpan: 1,
                  options: option(people),
                },
                {
                  name: "projectId",
                  label: "Part of project",
                  type: "select",
                  colSpan: 1,
                  options: option(projects),
                },
                { name: "notes", label: "Notes", type: "textarea" },
                {
                  name: "cancellationReason",
                  label: "If cancelled, why",
                  type: "textarea",
                },
              ]}
            />
          ) : null}
        </div>

        {summary.delivered > 0 || summary.planned > 0 ? (
          <dl className="mb-3 flex flex-wrap gap-x-8 gap-y-2">
            <Figure label="Sessions delivered" value={summary.delivered} />
            <Figure label="Attendance" value={summary.attendees} />
            <Figure label="Contact hours" value={summary.contactHours} />
            {summary.planned > 0 ? (
              <Figure label="Still planned" value={summary.planned} />
            ) : null}
            {summary.cancelled > 0 ? (
              <Figure label="Cancelled" value={summary.cancelled} />
            ) : null}
          </dl>
        ) : null}

        {outcomes.operations.length === 0 ? (
          <EmptyState
            icon={<Activity aria-hidden />}
            title="Nothing recorded yet"
            description="Record each session as it happens. Attendance reconstructed from memory at the end of a funding year is the number nobody can defend."
          />
        ) : (
          <ul className="card divide-y divide-line">
            {outcomes.operations.slice(0, 30).map((operation) => (
              <OperationItem key={operation.id} operation={operation} />
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="program-outcomes">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 id="program-outcomes" className="section-heading">
            Outcomes
            <span className="ml-2 font-normal text-muted">what changed</span>
          </h2>
          {canManage ? (
            <EntityFormDialog
              triggerLabel="Add a measure"
              triggerVariant="secondary"
              title="Add an outcome measure"
              submitLabel="Add"
              extraValues={{ programId }}
              action={createOutcomeMetric}
              fields={[
                {
                  name: "name",
                  label: "What are you trying to change",
                  type: "text",
                  required: true,
                },
                { name: "description", label: "How it is measured", type: "textarea" },
                {
                  name: "unit",
                  label: "Unit",
                  type: "text",
                  required: true,
                  colSpan: 1,
                  defaultValue: "people",
                  placeholder: "people, %, score out of 10",
                },
                {
                  name: "direction",
                  label: "Which way is good",
                  type: "select",
                  required: true,
                  colSpan: 1,
                  defaultValue: "increase",
                  options: METRIC_DIRECTIONS.map((value) => ({
                    value,
                    label: DIRECTION_LABELS[value],
                  })),
                },
                { name: "baseline", label: "Starting point", type: "number", colSpan: 1 },
                { name: "baselineOn", label: "Measured on", type: "date", colSpan: 1 },
                { name: "target", label: "Target", type: "number", colSpan: 1 },
                { name: "targetOn", label: "By when", type: "date", colSpan: 1 },
                {
                  name: "ownerId",
                  label: "Owner",
                  type: "select",
                  colSpan: 1,
                  options: option(people),
                },
              ]}
            />
          ) : null}
        </div>

        {outcomes.metrics.length === 0 ? (
          <EmptyState
            icon={<Target aria-hidden />}
            title="No outcome measures yet"
            description="Sessions run and people attended are outputs. An outcome is the change those sessions were meant to produce — say what it is, and what it was before you started."
          />
        ) : (
          <ul className="space-y-3">
            {outcomes.metrics.map((metric) => (
              <MetricCard key={metric.id} metric={metric} canManage={canManage} />
            ))}
          </ul>
        )}

        {outcomes.retiredMetrics.length > 0 ? (
          <details className="card mt-3 px-4 py-3">
            <summary className="cursor-pointer text-[13.5px] font-medium">
              Retired measures ({outcomes.retiredMetrics.length})
            </summary>
            <ul className="mt-2 divide-y divide-line">
              {outcomes.retiredMetrics.map((metric) => (
                <li key={metric.id} className="py-2.5 text-[13.5px]">
                  {metric.name}
                  <span className="meta ml-2">
                    {metric.measurements.length} readings kept
                  </span>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </section>
    </div>
  );
}

function Figure({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="meta">{label}</dt>
      <dd className="text-[17px] font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

function OperationItem({ operation }: { operation: OperationRow }) {
  const hours = operation.contact_hours ? Number(operation.contact_hours) : null;

  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-start gap-2">
        <span className="min-w-0 flex-1 text-[13.5px] font-medium">
          {operation.title}
        </span>
        <Badge tone={STATUS_TONE[operation.status]}>
          {OPERATION_STATUS_LABELS[operation.status]}
        </Badge>
      </div>
      <p className="meta mt-0.5">
        {formatDate(operation.occurred_on)}
        {operation.location ? ` · ${operation.location}` : ""}
        {operation.attendee_count !== null
          ? ` · ${operation.attendee_count} attended`
          : ""}
        {hours ? ` · ${hours} contact hours` : ""}
        {operation.leader ? ` · led by ${operation.leader.full_name}` : ""}
      </p>
      {operation.cancellation_reason ? (
        <p className="mt-0.5 text-[13px] text-muted">
          Cancelled: {operation.cancellation_reason}
        </p>
      ) : null}
      {operation.notes ? (
        <p className="mt-0.5 text-[13px] text-muted">{operation.notes}</p>
      ) : null}
    </li>
  );
}

function MetricCard({
  metric,
  canManage,
}: {
  metric: MetricWithProgress;
  canManage: boolean;
}) {
  const { progress, latest } = metric;

  return (
    <li className="card px-4 py-3">
      <div className="flex flex-wrap items-start gap-2">
        <span className="min-w-0 flex-1 text-[13.5px] font-medium">{metric.name}</span>
        {progress.met ? (
          <Badge tone="success">Target met</Badge>
        ) : progress.regressed ? (
          <Badge tone="warning">Moving the wrong way</Badge>
        ) : null}
      </div>

      <p className="meta mt-0.5">
        {DIRECTION_LABELS[metric.direction]} · measured in {metric.unit}
        {metric.owner ? ` · ${metric.owner.full_name}` : ""}
        {metric.target_on ? ` · target by ${formatDate(metric.target_on)}` : ""}
      </p>

      <dl className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-[13px]">
        <span>
          <dt className="inline text-muted">Baseline: </dt>
          <dd className="inline tabular-nums">{metric.baseline ?? "—"}</dd>
        </span>
        <span>
          <dt className="inline text-muted">Latest: </dt>
          <dd className="inline font-medium tabular-nums">
            {latest ? latest.value : "—"}
            {latest ? ` (${formatDate(latest.measured_on)})` : ""}
          </dd>
        </span>
        <span>
          <dt className="inline text-muted">Target: </dt>
          <dd className="inline tabular-nums">{metric.target ?? "—"}</dd>
        </span>
      </dl>

      {progress.percent !== null ? (
        <div className="mt-2">
          <div
            className="h-1.5 w-full overflow-hidden rounded-full bg-surface-soft"
            role="img"
            aria-label={`${progress.percent}% of the way from the baseline to the target`}
          >
            <div
              className={progress.met ? "h-full bg-success" : "h-full bg-brand"}
              style={{ width: `${progress.percent}%` }}
            />
          </div>
          <p className="meta mt-1">
            {progress.percent}% of the way from baseline to target
            {progress.change !== null
              ? ` · moved ${progress.change > 0 ? "+" : ""}${progress.change} ${metric.unit}`
              : ""}
          </p>
        </div>
      ) : (
        <p className="meta mt-2">
          {metric.baseline === null
            ? "Set a baseline to show progress."
            : "No readings yet."}
        </p>
      )}

      {canManage ? (
        <div className="mt-2">
          <EntityFormDialog
            triggerLabel="Record a reading"
            triggerVariant="secondary"
            title={`Record a reading — ${metric.name}`}
            submitLabel="Record"
            extraValues={{ metricId: metric.id }}
            action={recordMeasurement}
            fields={[
              { name: "measuredOn", label: "Measured on", type: "date", required: true, colSpan: 1 },
              {
                name: "value",
                label: `Value (${metric.unit})`,
                type: "number",
                required: true,
                colSpan: 1,
              },
              {
                name: "source",
                label: "Where it came from",
                type: "text",
                hint: "A measurement without a source is an assertion, and a funder will ask.",
              },
              { name: "sampleSize", label: "How many people", type: "number", colSpan: 1 },
              { name: "note", label: "Note", type: "textarea" },
            ]}
          />
        </div>
      ) : null}
    </li>
  );
}
