import { Banknote } from "lucide-react";
import { EntityFormDialog } from "@/components/shared/entity-form-dialog";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import {
  OPPORTUNITY_KINDS,
  decisionOverdue,
  formatMoney,
} from "@/features/crm/opportunity-schemas";
import { kindLabel, stageLabel } from "@/features/crm/labels";
import type { Locale } from "@/lib/i18n/config";
import type { Formatters } from "@/lib/i18n/format";
import { getFormatters, getLocale, getT } from "@/lib/i18n/server";
import type { TranslateFn } from "@/lib/i18n/translate";
import type { OpportunityRow, Pipeline } from "@/features/crm/services/opportunity.queries";
import { createOpportunity } from "@/features/crm/services/opportunity.commands";
import { cn } from "@/lib/utils";
import { OpportunityControls } from "./opportunity-controls";

/**
 * The funding pipeline for one relationship.
 *
 * Live bids stay open on the page and settled ones fold away, for the same
 * reason the RAID log does it: a declined application is the record of why,
 * which the next application to the same funder needs, but it is not today's
 * work.
 *
 * Totals are shown per currency. Adding £10,000 to €10,000 produces a number
 * that is wrong in both, and a fundraiser reading a single figure would have
 * no way to tell.
 */

const HIGHLIGHT = "bg-accent/15 ring-1 ring-brand/40";

const STAGE_TONE = {
  identified: "neutral",
  qualifying: "neutral",
  preparing: "info",
  submitted: "info",
  awarded: "success",
  declined: "danger",
  withdrawn: "neutral",
} as const;

export async function OpportunityPipeline({
  pipeline,
  crmOrganizationId,
  people,
  programs,
  projects,
  contacts,
  today,
  highlightId = null,
}: {
  pipeline: Pipeline;
  crmOrganizationId: string;
  people: { id: string; label: string }[];
  programs: { id: string; label: string }[];
  projects: { id: string; label: string }[];
  contacts: { id: string; label: string }[];
  today: string;
  highlightId?: string | null;
}) {
  const [t, format, locale] = await Promise.all([getT(), getFormatters(), getLocale()]);
  const option = (rows: { id: string; label: string }[]) =>
    rows.map((row) => ({ value: row.id, label: row.label }));

  return (
    <section aria-labelledby="opportunities-heading">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 id="opportunities-heading" className="section-heading">
          {t("crm.pipeline.heading")}
          <span className="ml-2 font-normal text-muted">
            {t("crm.pipeline.live", { count: pipeline.open.length })}
          </span>
        </h2>
        <EntityFormDialog
          triggerLabel={t("crm.pipeline.addOpportunity")}
          triggerVariant="secondary"
          title={t("crm.pipeline.addOpportunity")}
          submitLabel={t("crm.add")}
          action={createOpportunity}
          extraValues={{ crmOrganizationId }}
          fields={[
            { name: "title", label: t("crm.pipeline.fields.title"), type: "text", required: true },
            { name: "description", label: t("crm.pipeline.fields.description"), type: "textarea" },
            {
              name: "kind",
              label: t("crm.pipeline.fields.kind"),
              type: "select",
              required: true,
              colSpan: 1,
              defaultValue: "grant",
              options: OPPORTUNITY_KINDS.map((value) => ({
                value,
                label: kindLabel(value, t),
              })),
            },
            {
              name: "ownerId",
              label: t("crm.pipeline.fields.owner"),
              type: "select",
              required: true,
              colSpan: 1,
              options: option(people),
            },
            {
              name: "amountRequested",
              label: t("crm.pipeline.fields.amountRequested"),
              type: "number",
              colSpan: 1,
            },
            {
              name: "currency",
              label: t("crm.pipeline.fields.currency"),
              type: "text",
              colSpan: 1,
              defaultValue: "GBP",
              hint: t("crm.pipeline.fields.currencyHint"),
            },
            {
              name: "decisionExpectedAt",
              label: t("crm.pipeline.fields.decisionExpected"),
              type: "date",
              required: true,
              colSpan: 1,
            },
            {
              name: "contactId",
              label: t("crm.pipeline.fields.contact"),
              type: "select",
              colSpan: 1,
              options: option(contacts),
            },
            {
              name: "programId",
              label: t("crm.pipeline.fields.program"),
              type: "select",
              colSpan: 1,
              options: option(programs),
            },
            {
              name: "projectId",
              label: t("crm.pipeline.fields.project"),
              type: "select",
              colSpan: 1,
              options: option(projects),
            },
          ]}
        />
      </div>

      {pipeline.open.length > 0 || pipeline.awardedByCurrency.length > 0 ? (
        <dl className="mb-3 flex flex-wrap gap-x-8 gap-y-2">
          <Total label={t("crm.pipeline.inPlay")} totals={pipeline.requestedByCurrency} locale={locale} />
          <Total label={t("crm.pipeline.awarded")} totals={pipeline.awardedByCurrency} locale={locale} />
          {pipeline.overdueDecisions > 0 ? (
            <div>
              <dt className="meta">{t("crm.pipeline.overdueDecisions")}</dt>
              <dd className="text-[15px] font-semibold text-warning-fg tabular-nums">
                {pipeline.overdueDecisions}
              </dd>
            </div>
          ) : null}
        </dl>
      ) : null}

      {pipeline.open.length === 0 ? (
        <EmptyState
          icon={<Banknote aria-hidden />}
          title={t("crm.pipeline.emptyTitle")}
          description={t("crm.pipeline.emptyDescription")}
        />
      ) : (
        <ul className="card divide-y divide-line">
          {pipeline.open.map((opportunity) => (
            <OpportunityItem
              key={opportunity.id}
              opportunity={opportunity}
              today={today}
              highlighted={opportunity.id === highlightId}
              t={t}
              format={format}
              locale={locale}
            />
          ))}
        </ul>
      )}

      {pipeline.settled.length > 0 ? (
        <details
          className="card mt-3 px-4 py-3"
          open={pipeline.settled.some((row) => row.id === highlightId)}
        >
          <summary className="cursor-pointer text-[13.5px] font-medium">
            {t("crm.pipeline.decidedCount", { count: pipeline.settled.length })}
          </summary>
          <ul className="mt-2 divide-y divide-line">
            {pipeline.settled.map((opportunity) => (
              <li
                key={opportunity.id}
                id={`opportunity-${opportunity.id}`}
                className={cn(
                  "py-2.5",
                  opportunity.id === highlightId && HIGHLIGHT,
                )}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 flex-1 text-[13.5px]">
                    {opportunity.title}
                  </span>
                  {opportunity.stage === "awarded" ? (
                    <span className="text-[13.5px] font-semibold tabular-nums">
                      {formatMoney(opportunity.amount_awarded, opportunity.currency, locale)}
                    </span>
                  ) : null}
                  <Badge tone={STAGE_TONE[opportunity.stage]}>
                    {stageLabel(opportunity.stage, t)}
                  </Badge>
                </div>
                <p className="meta mt-0.5">
                  {opportunity.decided_at
                    ? t("crm.pipeline.decidedOn", { date: format.date(opportunity.decided_at) })
                    : t("crm.pipeline.decided")}
                  {opportunity.owner ? ` · ${opportunity.owner.full_name}` : ""}
                </p>
                {opportunity.outcome_note ? (
                  <p className="mt-0.5 text-[13px] text-muted">
                    {opportunity.outcome_note}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}

function Total({
  label,
  totals,
  locale,
}: {
  label: string;
  totals: { currency: string; total: number; count: number }[];
  locale: Locale;
}) {
  if (totals.length === 0) return null;
  return (
    <div>
      <dt className="meta">{label}</dt>
      <dd className="text-[15px] font-semibold tabular-nums">
        {totals.map((entry, index) => (
          <span key={entry.currency}>
            {index > 0 ? <span className="mx-1.5 text-muted">+</span> : null}
            {formatMoney(entry.total, entry.currency, locale)}
          </span>
        ))}
      </dd>
    </div>
  );
}

function OpportunityItem({
  opportunity,
  today,
  highlighted,
  t,
  format,
  locale,
}: {
  opportunity: OpportunityRow;
  today: string;
  highlighted: boolean;
  t: TranslateFn;
  format: Formatters;
  locale: Locale;
}) {
  const overdue = decisionOverdue(opportunity, today);

  return (
    <li
      id={`opportunity-${opportunity.id}`}
      className={cn("px-4 py-3", highlighted && HIGHLIGHT)}
    >
      <div className="flex flex-wrap items-start gap-2">
        <span className="min-w-0 flex-1 text-[13.5px] font-medium">
          {opportunity.title}
        </span>
        <span className="text-[13.5px] font-semibold tabular-nums">
          {formatMoney(opportunity.amount_requested, opportunity.currency, locale)}
        </span>
        <Badge tone={STAGE_TONE[opportunity.stage]}>
          {stageLabel(opportunity.stage, t)}
        </Badge>
      </div>

      <p className="meta mt-0.5">
        {kindLabel(opportunity.kind, t)}
        {opportunity.owner ? ` · ${opportunity.owner.full_name}` : ""}
        {opportunity.decision_expected_at
          ? ` · ${t("crm.pipeline.decisionOn", { date: format.date(opportunity.decision_expected_at) })}`
          : ""}
        {opportunity.program ? ` · ${opportunity.program.name}` : ""}
        {opportunity.project ? ` · ${opportunity.project.name}` : ""}
      </p>

      {overdue ? (
        <p className="mt-1 text-[13px] text-warning-fg">
          {t("crm.pipeline.chase")}
        </p>
      ) : null}

      {opportunity.description ? (
        <p className="mt-1 text-[13px] text-muted">{opportunity.description}</p>
      ) : null}

      <OpportunityControls
        opportunityId={opportunity.id}
        stage={opportunity.stage}
        currency={opportunity.currency}
        outcomeNote={opportunity.outcome_note}
        today={today}
      />
    </li>
  );
}
