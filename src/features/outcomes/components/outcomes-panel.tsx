import { Activity, Target } from "lucide-react";
import { EntityFormDialog } from "@/components/shared/entity-form-dialog";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import {
  METRIC_DIRECTIONS,
  OPERATION_STATUSES,
  directionLabel,
  operationStatusLabel,
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
import { getFormatters, getT } from "@/lib/i18n/server";
import type { Formatters } from "@/lib/i18n/format";
import type { TranslateFn } from "@/lib/i18n/translate";

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

export async function OutcomesPanel({
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
  const t = await getT();
  const format = await getFormatters();
  const option = (rows: { id: string; label: string }[]) =>
    rows.map((row) => ({ value: row.id, label: row.label }));

  return (
    <div className="space-y-10">
      <section aria-labelledby="program-delivery">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 id="program-delivery" className="section-heading">
            {t("outcomes.panel.deliveryHeading")}
            <span className="ml-2 font-normal text-muted">
              {t("outcomes.panel.deliveryAside")}
            </span>
          </h2>
          {canManage ? (
            <EntityFormDialog
              triggerLabel={t("outcomes.panel.recordSession")}
              triggerVariant="secondary"
              title={t("outcomes.panel.recordSession")}
              submitLabel={t("outcomes.panel.record")}
              extraValues={{ programId }}
              action={recordOperation}
              fields={[
                { name: "title", label: t("outcomes.panel.whatWasIt"), type: "text", required: true },
                {
                  name: "occurredOn",
                  label: t("outcomes.panel.date"),
                  type: "date",
                  required: true,
                  colSpan: 1,
                },
                {
                  name: "status",
                  label: t("outcomes.panel.status"),
                  type: "select",
                  required: true,
                  colSpan: 1,
                  defaultValue: "delivered",
                  options: OPERATION_STATUSES.map((value) => ({
                    value,
                    label: operationStatusLabel(value, t),
                  })),
                },
                { name: "location", label: t("outcomes.panel.where"), type: "text", colSpan: 1 },
                {
                  name: "attendeeCount",
                  label: t("outcomes.panel.peopleCame"),
                  type: "number",
                  colSpan: 1,
                  hint: t("outcomes.panel.peopleCameHint"),
                },
                {
                  name: "durationHours",
                  label: t("outcomes.panel.hoursRan"),
                  type: "number",
                  colSpan: 1,
                },
                {
                  name: "volunteerCount",
                  label: t("outcomes.panel.volunteers"),
                  type: "number",
                  colSpan: 1,
                },
                {
                  name: "ledBy",
                  label: t("outcomes.panel.ledBy"),
                  type: "select",
                  colSpan: 1,
                  options: option(people),
                },
                {
                  name: "projectId",
                  label: t("outcomes.panel.partOfProject"),
                  type: "select",
                  colSpan: 1,
                  options: option(projects),
                },
                { name: "notes", label: t("outcomes.panel.notes"), type: "textarea" },
                {
                  name: "cancellationReason",
                  label: t("outcomes.panel.cancelReason"),
                  type: "textarea",
                },
              ]}
            />
          ) : null}
        </div>

        {summary.delivered > 0 || summary.planned > 0 ? (
          <dl className="mb-3 flex flex-wrap gap-x-8 gap-y-2">
            <Figure
              label={t("outcomes.panel.sessionsDelivered")}
              value={format.number(summary.delivered)}
            />
            <Figure label={t("outcomes.panel.attendance")} value={format.number(summary.attendees)} />
            <Figure
              label={t("outcomes.panel.contactHours")}
              value={format.number(summary.contactHours)}
            />
            {summary.planned > 0 ? (
              <Figure
                label={t("outcomes.panel.stillPlanned")}
                value={format.number(summary.planned)}
              />
            ) : null}
            {summary.cancelled > 0 ? (
              <Figure
                label={t("outcomes.panel.cancelled")}
                value={format.number(summary.cancelled)}
              />
            ) : null}
          </dl>
        ) : null}

        {outcomes.operations.length === 0 ? (
          <EmptyState
            icon={<Activity aria-hidden />}
            title={t("outcomes.panel.nothingTitle")}
            description={t("outcomes.panel.nothingBody")}
          />
        ) : (
          <ul className="card divide-y divide-line">
            {outcomes.operations.slice(0, 30).map((operation) => (
              <OperationItem key={operation.id} operation={operation} t={t} format={format} />
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="program-outcomes">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 id="program-outcomes" className="section-heading">
            {t("outcomes.panel.outcomesHeading")}
            <span className="ml-2 font-normal text-muted">
              {t("outcomes.panel.outcomesAside")}
            </span>
          </h2>
          {canManage ? (
            <EntityFormDialog
              triggerLabel={t("outcomes.panel.addMeasure")}
              triggerVariant="secondary"
              title={t("outcomes.panel.addMeasureTitle")}
              submitLabel={t("outcomes.panel.add")}
              extraValues={{ programId }}
              action={createOutcomeMetric}
              fields={[
                {
                  name: "name",
                  label: t("outcomes.panel.tryingToChange"),
                  type: "text",
                  required: true,
                },
                { name: "description", label: t("outcomes.panel.howMeasured"), type: "textarea" },
                {
                  name: "unit",
                  label: t("outcomes.panel.unit"),
                  type: "text",
                  required: true,
                  colSpan: 1,
                  defaultValue: t("outcomes.panel.unitDefault"),
                  placeholder: t("outcomes.panel.unitPlaceholder"),
                },
                {
                  name: "direction",
                  label: t("outcomes.panel.whichWay"),
                  type: "select",
                  required: true,
                  colSpan: 1,
                  defaultValue: "increase",
                  options: METRIC_DIRECTIONS.map((value) => ({
                    value,
                    label: directionLabel(value, t),
                  })),
                },
                {
                  name: "baseline",
                  label: t("outcomes.panel.startingPoint"),
                  type: "number",
                  colSpan: 1,
                },
                {
                  name: "baselineOn",
                  label: t("outcomes.panel.measuredOn"),
                  type: "date",
                  colSpan: 1,
                },
                { name: "target", label: t("outcomes.panel.target"), type: "number", colSpan: 1 },
                { name: "targetOn", label: t("outcomes.panel.byWhen"), type: "date", colSpan: 1 },
                {
                  name: "ownerId",
                  label: t("outcomes.panel.owner"),
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
            title={t("outcomes.panel.noMeasuresTitle")}
            description={t("outcomes.panel.noMeasuresBody")}
          />
        ) : (
          <ul className="space-y-3">
            {outcomes.metrics.map((metric) => (
              <MetricCard
                key={metric.id}
                metric={metric}
                canManage={canManage}
                t={t}
                format={format}
              />
            ))}
          </ul>
        )}

        {outcomes.retiredMetrics.length > 0 ? (
          <details className="card mt-3 px-4 py-3">
            <summary className="cursor-pointer text-[13.5px] font-medium">
              {t("outcomes.panel.retired", { count: outcomes.retiredMetrics.length })}
            </summary>
            <ul className="mt-2 divide-y divide-line">
              {outcomes.retiredMetrics.map((metric) => (
                <li key={metric.id} className="py-2.5 text-[13.5px]">
                  {metric.name}
                  <span className="meta ml-2">
                    {t("outcomes.panel.readingsKept", {
                      count: format.number(metric.measurements.length),
                    })}
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

/**
 * A stored numeric reading (Postgres returns `numeric` as a string) in the
 * reader's number format. Anything that is not a finite number is shown as is.
 */
function formatValue(value: string | number, format: Formatters): string {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? format.number(parsed) : String(value);
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="meta">{label}</dt>
      <dd className="text-[17px] font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

function OperationItem({
  operation,
  t,
  format,
}: {
  operation: OperationRow;
  t: TranslateFn;
  format: Formatters;
}) {
  const hours = operation.contact_hours ? Number(operation.contact_hours) : null;

  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-start gap-2">
        <span className="min-w-0 flex-1 text-[13.5px] font-medium">
          {operation.title}
        </span>
        <Badge tone={STATUS_TONE[operation.status]}>
          {operationStatusLabel(operation.status, t)}
        </Badge>
      </div>
      <p className="meta mt-0.5">
        {format.date(operation.occurred_on)}
        {operation.location ? ` · ${operation.location}` : ""}
        {operation.attendee_count !== null
          ? t("outcomes.panel.attendedSuffix", {
              count: format.number(operation.attendee_count),
            })
          : ""}
        {hours
          ? t("outcomes.panel.contactHoursSuffix", { count: format.number(hours) })
          : ""}
        {operation.leader
          ? t("outcomes.panel.ledBySuffix", { name: operation.leader.full_name })
          : ""}
      </p>
      {operation.cancellation_reason ? (
        <p className="mt-0.5 text-[13px] text-muted">
          {t("outcomes.panel.cancelledPrefix", { reason: operation.cancellation_reason })}
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
  t,
  format,
}: {
  metric: MetricWithProgress;
  canManage: boolean;
  t: TranslateFn;
  format: Formatters;
}) {
  const { progress, latest } = metric;

  return (
    <li className="card px-4 py-3">
      <div className="flex flex-wrap items-start gap-2">
        <span className="min-w-0 flex-1 text-[13.5px] font-medium">{metric.name}</span>
        {progress.met ? (
          <Badge tone="success">{t("outcomes.panel.targetMet")}</Badge>
        ) : progress.regressed ? (
          <Badge tone="warning">{t("outcomes.panel.wrongWay")}</Badge>
        ) : null}
      </div>

      <p className="meta mt-0.5">
        {directionLabel(metric.direction, t)}
        {t("outcomes.panel.measuredIn", { unit: metric.unit })}
        {metric.owner ? ` · ${metric.owner.full_name}` : ""}
        {metric.target_on
          ? t("outcomes.panel.targetBySuffix", { date: format.date(metric.target_on) })
          : ""}
      </p>

      <dl className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-[13px]">
        <span>
          <dt className="inline text-muted">{t("outcomes.panel.baseline")}</dt>
          <dd className="inline tabular-nums">{metric.baseline === null ? "—" : formatValue(metric.baseline, format)}</dd>
        </span>
        <span>
          <dt className="inline text-muted">{t("outcomes.panel.latest")}</dt>
          <dd className="inline font-medium tabular-nums">
            {latest ? formatValue(latest.value, format) : "—"}
            {latest ? ` (${format.date(latest.measured_on)})` : ""}
          </dd>
        </span>
        <span>
          <dt className="inline text-muted">{t("outcomes.panel.targetPrefix")}</dt>
          <dd className="inline tabular-nums">{metric.target === null ? "—" : formatValue(metric.target, format)}</dd>
        </span>
      </dl>

      {progress.percent !== null ? (
        <div className="mt-2">
          <div
            className="h-1.5 w-full overflow-hidden rounded-full bg-surface-soft"
            role="img"
            aria-label={t("outcomes.panel.progressAria", { percent: progress.percent })}
          >
            <div
              className={progress.met ? "h-full bg-success" : "h-full bg-brand"}
              style={{ width: `${progress.percent}%` }}
            />
          </div>
          <p className="meta mt-1">
            {t("outcomes.panel.progress", { percent: progress.percent })}
            {progress.change !== null
              ? t("outcomes.panel.moved", {
                  change: `${progress.change > 0 ? "+" : ""}${format.number(progress.change)}`,
                  unit: metric.unit,
                })
              : ""}
          </p>
        </div>
      ) : (
        <p className="meta mt-2">
          {metric.baseline === null
            ? t("outcomes.panel.setBaseline")
            : t("outcomes.panel.noReadings")}
        </p>
      )}

      {canManage ? (
        <div className="mt-2">
          <EntityFormDialog
            triggerLabel={t("outcomes.panel.recordReading")}
            triggerVariant="secondary"
            title={t("outcomes.panel.recordReadingTitle", { name: metric.name })}
            submitLabel={t("outcomes.panel.record")}
            extraValues={{ metricId: metric.id }}
            action={recordMeasurement}
            fields={[
              {
                name: "measuredOn",
                label: t("outcomes.panel.measuredOn"),
                type: "date",
                required: true,
                colSpan: 1,
              },
              {
                name: "value",
                label: t("outcomes.panel.value", { unit: metric.unit }),
                type: "number",
                required: true,
                colSpan: 1,
              },
              {
                name: "source",
                label: t("outcomes.panel.source"),
                type: "text",
                hint: t("outcomes.panel.sourceHint"),
              },
              {
                name: "sampleSize",
                label: t("outcomes.panel.howManyPeople"),
                type: "number",
                colSpan: 1,
              },
              { name: "note", label: t("outcomes.panel.note"), type: "textarea" },
            ]}
          />
        </div>
      ) : null}
    </li>
  );
}
