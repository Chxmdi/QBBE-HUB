import type { DecisionsV2T } from "../i18n";
import type { DecisionRecord } from "../services/decision-v2.queries";

/** The record, read-only. Earlier rationale and alternatives fill in for empty new fields. */
export function DecisionFields({ decision, t }: { decision: DecisionRecord; t: DecisionsV2T }) {
  const reasoning = decision.reasoning ?? decision.legacyRationale;
  const rows: { label: string; value: React.ReactNode }[] = [
    { label: t("fields.problem"), value: decision.problem },
    {
      label: t("fields.options"),
      value:
        decision.options.length > 0 ? (
          <ul className="list-disc pl-5">
            {decision.options.map((o, i) => (
              <li key={i}>{o}</li>
            ))}
          </ul>
        ) : decision.legacyAlternatives,
    },
    { label: t("fields.evidence"), value: decision.evidence },
    { label: decision.reasoning ? t("fields.reasoning") : t("fields.legacyRationale"), value: reasoning },
  ];
  return (
    <dl className="grid gap-3 text-sm">
      {rows.map((row) => (
        <div key={row.label}>
          <dt className="font-medium text-muted">{row.label}</dt>
          <dd className="mt-0.5 whitespace-pre-wrap text-ink">{row.value || <span className="text-muted">{t("empty")}</span>}</dd>
        </div>
      ))}
    </dl>
  );
}
