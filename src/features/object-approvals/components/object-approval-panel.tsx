import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import type { Formatters } from "@/lib/i18n/format";
import type { ObjectApprovalsT } from "../i18n";
import type { ObjectApprovalRow } from "../services/object-approval.queries";

const TONE = { pending: "warning", approved: "success", rejected: "danger", withdrawn: "neutral" } as const;

/**
 * An object's approvals, for anyone who can read the object. The panel any
 * object page can mount; the item itself opens in Approvals for the people
 * the engine lets see it.
 */
export function ObjectApprovalPanel({
  approvals,
  t,
  format,
}: {
  approvals: ObjectApprovalRow[];
  t: ObjectApprovalsT;
  format: Pick<Formatters, "date">;
}) {
  if (approvals.length === 0) return <p className="text-sm text-muted">{t("none")}</p>;
  return (
    <ul className="space-y-2">
      {approvals.map((a) => (
        <li key={a.approvalItemId} className="card space-y-1 p-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-ink">{a.title}</span>
            <Badge tone={TONE[a.status]}>{t(`status.${a.status}`)}</Badge>
          </div>
          <p className="text-[12.5px] text-muted">
            {t("requestedBy", { name: a.requestedByName ?? "—", date: format.date(a.requestedAt) })}
            {a.status === "pending" && a.stepLabel ? ` · ${t("currentStep", { label: a.stepLabel })}` : ""}
            {a.decidedAt ? ` · ${t("decidedOn", { date: format.date(a.decidedAt) })}` : ""}
          </p>
          {a.canOpen ? (
            <Link href={`/approvals?tab=mine&item=${a.approvalItemId}`} className="text-[13px] text-brand-fg underline">
              {t("openItem")}
            </Link>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
