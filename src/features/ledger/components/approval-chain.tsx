import { Badge } from "@/components/ui/badge";
import { APPROVAL_STATUS_KEY, type ApprovalChain } from "@/features/ledger/approval-chain";
import { formatCents } from "@/features/ledger/money";
import { getLocale, getT } from "@/lib/i18n/server";

const STATUS_TONE = {
  pending: "warning",
  approved: "success",
  rejected: "danger",
  withdrawn: "neutral",
} as const;

/**
 * Who approved the bill or payment behind a journal entry, step by step.
 * Read-only: approvals are decided on the Approvals screen, not here.
 */
export async function ApprovalChainSection({
  chains,
  source,
}: {
  chains: ApprovalChain[];
  source: "bill" | "payment";
}) {
  const t = await getT();
  const locale = await getLocale();
  return (
    <section className="mt-6" aria-labelledby="approval-heading">
      <h2 id="approval-heading" className="mb-2 text-base font-semibold">
        {t("finance.ledger.approval.heading")}
      </h2>
      {chains.length === 0 ? (
        <p className="text-[13.5px] text-muted">
          {source === "payment"
            ? t("finance.ledger.approval.noneForPayment")
            : t("finance.ledger.approval.noneForBill")}
        </p>
      ) : (
        <div className="space-y-3">
          {chains.map((c) => (
            <div key={c.itemId} className="card text-[13.5px]">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2">
                <span className="font-medium">{c.title}</span>
                <span className="flex items-center gap-2">
                  {c.amountCents !== null ? (
                    <span className="tabular-nums">{formatCents(c.amountCents, locale)}</span>
                  ) : null}
                  <Badge tone={STATUS_TONE[c.status]}>{t(APPROVAL_STATUS_KEY[c.status])}</Badge>
                </span>
              </div>
              <ol
                className="divide-y divide-line"
                aria-label={t("finance.ledger.approval.chainLabel", { title: c.title })}
              >
                {c.steps.map((s, i) => (
                  <li key={`${c.itemId}-${i}`} className="flex flex-wrap justify-between gap-3 px-4 py-2">
                    <span>
                      <span className={s.kind === "waiting" ? "text-muted" : undefined}>{s.text}</span>
                      {s.stepText ? <span className="meta block">{s.stepText}</span> : null}
                      {s.note ? (
                        <span className="meta block">
                          {locale === "fr-CA" ? `« ${s.note} »` : `“${s.note}”`}
                        </span>
                      ) : null}
                    </span>
                    <span className="tabular-nums text-muted">
                      {s.occurredAt
                        ? `${s.occurredAt.slice(0, 16).replace("T", " ")} UTC`
                        : t("finance.ledger.approval.notDecided")}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
