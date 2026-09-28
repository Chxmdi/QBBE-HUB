import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { decisionOverdue, formatMoney } from "@/features/crm/opportunity-schemas";
import { stageLabel } from "@/features/crm/labels";
import type { Pipeline } from "@/features/crm/services/opportunity.queries";
import { getFormatters, getLocale, getT } from "@/lib/i18n/server";

/**
 * The pipeline at organization level, on the relationships index.
 *
 * Two questions, in the order they get asked: how much is in play, and what
 * are we waiting to hear about. Amounts are grouped by currency because a
 * single summed figure across currencies would be wrong in all of them.
 */

export async function PipelineTotals({ pipeline }: { pipeline: Pipeline }) {
  if (pipeline.open.length === 0 && pipeline.awardedByCurrency.length === 0) {
    return null;
  }
  const [t, locale] = await Promise.all([getT(), getLocale()]);

  return (
    <dl className="mb-5 flex flex-wrap gap-x-8 gap-y-3">
      <Figure
        label={t("crm.pipeline.inPlayCount", { count: pipeline.open.length })}
        value={pipeline.requestedByCurrency
          .map((entry) => formatMoney(entry.total, entry.currency, locale))
          .join(" + ")}
      />
      <Figure
        label={t("crm.pipeline.awarded")}
        value={pipeline.awardedByCurrency
          .map((entry) => formatMoney(entry.total, entry.currency, locale))
          .join(" + ")}
      />
      {pipeline.overdueDecisions > 0 ? (
        <Figure
          label={t("crm.pipeline.overdueDecisions")}
          value={String(pipeline.overdueDecisions)}
          tone="warning"
        />
      ) : null}
    </dl>
  );
}

function Figure({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "warning";
}) {
  if (!value) return null;
  return (
    <div>
      <dt className="meta">{label}</dt>
      <dd
        className={
          tone === "warning"
            ? "text-[17px] font-semibold text-warning-fg tabular-nums"
            : "text-[17px] font-semibold tabular-nums"
        }
      >
        {value}
      </dd>
    </div>
  );
}

/** The bids waiting on an answer, soonest first. */
export async function DecisionsExpected({
  pipeline,
  today,
  limit = 6,
}: {
  pipeline: Pipeline;
  today: string;
  limit?: number;
}) {
  const waiting = pipeline.open
    .filter((row) => row.decision_expected_at !== null)
    .slice(0, limit);

  if (waiting.length === 0) return null;
  const [t, format, locale] = await Promise.all([getT(), getFormatters(), getLocale()]);

  return (
    <section aria-labelledby="decisions-expected">
      <h2 id="decisions-expected" className="section-heading mb-3">
        {t("crm.pipeline.decisionsExpected")}
      </h2>
      <ul className="card divide-y divide-line">
        {waiting.map((opportunity) => {
          const overdue = decisionOverdue(opportunity, today);
          return (
            <li key={opportunity.id} className="px-4 py-2.5">
              <Link
                href={
                  opportunity.crm_organization
                    ? `/crm/${opportunity.crm_organization.id}?opportunity=${opportunity.id}`
                    : "/crm"
                }
                className="text-[13.5px] font-medium hover:text-brand-fg"
              >
                {opportunity.title}
              </Link>
              <div className="mt-0.5 flex flex-wrap items-center gap-2">
                <span className="meta min-w-0 flex-1 truncate">
                  {opportunity.crm_organization?.name ?? "—"} ·{" "}
                  {formatMoney(opportunity.amount_requested, opportunity.currency, locale)}
                </span>
                <span
                  className={
                    overdue
                      ? "text-[12.5px] font-medium text-warning-fg"
                      : "meta whitespace-nowrap"
                  }
                >
                  {format.date(opportunity.decision_expected_at!)}
                </span>
                <Badge tone="neutral">{stageLabel(opportunity.stage, t)}</Badge>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
