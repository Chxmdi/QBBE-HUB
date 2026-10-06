import type { ReactNode } from "react";
import type { WeekBucket } from "../metrics";

/**
 * Chart pieces shared by the Insight screens, rendered on the server.
 *
 * One series per chart, so no legend is needed: the heading names it. Bars
 * use the chart tokens, text stays in ink and muted, each bar carries a
 * native tooltip, and every chart has the same numbers as a table.
 */

export function StatTile({
  label,
  value,
  caption,
  tone = "neutral",
}: {
  label: string;
  value: string;
  caption?: string;
  /** Status tones come with words in the caption, never colour alone. */
  tone?: "neutral" | "attention";
}) {
  return (
    <div className="rounded-(--radius-md) border border-line bg-surface p-4">
      <dt className="text-body-sm text-muted">{label}</dt>
      <dd className={`mt-1 font-display text-[28px] leading-none ${tone === "attention" ? "text-danger-fg" : "text-ink"}`}>
        {value}
      </dd>
      {caption ? <dd className="mt-1.5 text-meta text-muted">{caption}</dd> : null}
    </div>
  );
}

const WIDTH = 480;
const HEIGHT = 160;
const PAD = { top: 12, right: 8, bottom: 24, left: 36 };

/** A round top for the axis: 1, 2, 5 or 10 times a power of ten. */
export function niceMax(value: number): number {
  if (value <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 5, 10].find((m) => m * power >= value)!;
  return step * power;
}

export function WeeklyBars({
  title,
  summary,
  buckets,
  formatWeek,
  formatValue,
  tableLabel,
  weekHeader,
  valueHeader,
  footer,
}: {
  title: string;
  /** One sentence for screen readers: what the chart shows and its latest value. */
  summary: string;
  buckets: WeekBucket[];
  formatWeek: (start: string) => string;
  formatValue: (value: number) => string;
  tableLabel: string;
  weekHeader: string;
  valueHeader: string;
  footer?: ReactNode;
}) {
  const max = niceMax(Math.max(0, ...buckets.map((bucket) => bucket.count)));
  const innerW = WIDTH - PAD.left - PAD.right;
  const innerH = HEIGHT - PAD.top - PAD.bottom;
  const slot = innerW / Math.max(buckets.length, 1);
  const barW = Math.max(slot - 4, 2);
  const y = (value: number) => PAD.top + innerH - (value / max) * innerH;
  return (
    <figure className="rounded-(--radius-md) border border-line bg-surface p-4">
      <figcaption className="mb-2 text-body font-semibold text-ink">{title}</figcaption>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="h-auto max-h-56 w-full" role="img" aria-label={summary}>
        {(Number.isInteger(max / 2) ? [0, max / 2, max] : [0, max]).map((tick) => (
          <g key={tick}>
            <line x1={PAD.left} x2={WIDTH - PAD.right} y1={y(tick)} y2={y(tick)} className="stroke-line" strokeWidth={1} />
            <text x={PAD.left - 6} y={y(tick) + 4} textAnchor="end" className="fill-muted text-[10px]">
              {formatValue(tick)}
            </text>
          </g>
        ))}
        {buckets.map((bucket, index) => {
          const top = y(bucket.count);
          const height = PAD.top + innerH - top;
          return (
            <rect
              key={bucket.start}
              x={PAD.left + index * slot + 2}
              y={height > 0 ? top : PAD.top + innerH - 1}
              width={barW}
              height={Math.max(height, 1)}
              rx={2}
              className={height > 0 ? "fill-chart-primary" : "fill-line"}
            >
              <title>{`${formatWeek(bucket.start)}: ${formatValue(bucket.count)}`}</title>
            </rect>
          );
        })}
        {buckets.length ? (
          <>
            <text x={PAD.left} y={HEIGHT - 6} className="fill-muted text-[10px]">
              {formatWeek(buckets[0].start)}
            </text>
            <text x={WIDTH - PAD.right} y={HEIGHT - 6} textAnchor="end" className="fill-muted text-[10px]">
              {formatWeek(buckets[buckets.length - 1].start)}
            </text>
          </>
        ) : null}
      </svg>
      {footer}
      <details className="mt-2 text-body-sm">
        <summary className="cursor-pointer text-muted hover:text-ink">{tableLabel}</summary>
        <table className="mt-2 w-full text-left text-body-sm">
          <thead>
            <tr className="border-b border-line text-muted">
              <th scope="col" className="py-1 font-medium">{weekHeader}</th>
              <th scope="col" className="py-1 text-right font-medium">{valueHeader}</th>
            </tr>
          </thead>
          <tbody>
            {buckets.map((bucket) => (
              <tr key={bucket.start} className="border-b border-line/60">
                <th scope="row" className="py-1 font-normal text-ink">{formatWeek(bucket.start)}</th>
                <td className="py-1 text-right tabular-nums text-ink">{formatValue(bucket.count)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
