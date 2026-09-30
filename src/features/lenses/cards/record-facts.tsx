import type { Locale } from "@/lib/i18n/config";
import { localized, type CatalogProperty } from "@/lib/query/catalog";
import type { LensRow } from "@/lib/query/run";
import { formatLensValue } from "@/features/lenses/format";

/** A record's key facts as a description list (label: value), skipping empty ones. */
export function RecordFacts({ row, facts, locale, timeZone }: { row: LensRow; facts: CatalogProperty[]; locale: Locale; timeZone: string }) {
  const shown = facts
    .map((p) => ({ p, text: formatLensValue(p, row.values[p.key] ?? null, locale, timeZone) }))
    .filter((f) => f.text);
  if (!shown.length) return null;
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12.5px]">
      {shown.map(({ p, text }) => (
        <div key={p.key} className="contents">
          <dt className="text-muted">{localized(p.name, locale)}</dt>
          <dd className="truncate text-ink">{text}</dd>
        </div>
      ))}
    </dl>
  );
}
