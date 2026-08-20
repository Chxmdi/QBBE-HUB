/**
 * Dashboard charts — plain SVG/CSS, no chart library. Colors come from the
 * validated chart tokens; every status color is paired with a text label
 * and an sr-only data table (A11Y-004, dataviz method).
 */

export interface DonutSlice {
  label: string;
  value: number;
  colorVar: string; // CSS var name, e.g. "--color-chart-good"
}

export function StatusDonut({ slices }: { slices: DonutSlice[] }) {
  const total = slices.reduce((sum, s) => sum + s.value, 0);
  const radius = 44;
  const circumference = 2 * Math.PI * radius;
  const gap = total > 0 ? 2.5 : 0; // 2px+ surface gap between fills

  let offset = 0;
  const segments = slices
    .filter((s) => s.value > 0)
    .map((slice) => {
      const fraction = slice.value / total;
      const length = Math.max(fraction * circumference - gap, 0.5);
      const segment = {
        ...slice,
        dasharray: `${length} ${circumference - length}`,
        dashoffset: -offset,
      };
      offset += fraction * circumference;
      return segment;
    });

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-5">
      <svg
        viewBox="0 0 120 120"
        className="size-32 shrink-0"
        role="img"
        aria-label={`Tasks by status. Total ${total}.`}
      >
        {total === 0 ? (
          <circle
            cx="60"
            cy="60"
            r={radius}
            fill="none"
            stroke="var(--color-surface-soft)"
            strokeWidth="12"
          />
        ) : (
          segments.map((segment) => (
            <circle
              key={segment.label}
              cx="60"
              cy="60"
              r={radius}
              fill="none"
              stroke={`var(${segment.colorVar})`}
              strokeWidth="12"
              strokeDasharray={segment.dasharray}
              strokeDashoffset={segment.dashoffset}
              transform="rotate(-90 60 60)"
            >
              <title>{`${segment.label}: ${segment.value}`}</title>
            </circle>
          ))
        )}
        <text
          x="60"
          y="57"
          textAnchor="middle"
          className="fill-(--color-ink)"
          fontSize="22"
          fontWeight="600"
        >
          {total}
        </text>
        <text
          x="60"
          y="74"
          textAnchor="middle"
          className="fill-(--color-muted)"
          fontSize="10"
        >
          tasks
        </text>
      </svg>
      <ul className="w-full min-w-0 space-y-1.5">
        {slices.map((slice) => (
          <li key={slice.label} className="flex min-w-0 items-center gap-2 text-[12.5px]">
            <span
              aria-hidden
              className="size-2.5 rounded-full"
              style={{ background: `var(${slice.colorVar})` }}
            />
            <span className="min-w-0 truncate text-muted">{slice.label}</span>
            <span className="ml-auto shrink-0 pl-3 font-semibold tabular-nums">
              {slice.value}
              {total > 0 ? (
                <span className="ml-1 font-normal text-muted">
                  ({Math.round((slice.value / total) * 100)}%)
                </span>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
      {/* Table view for assistive tech / no-color reading */}
      <table className="sr-only">
        <caption>Tasks by status</caption>
        <thead>
          <tr>
            <th scope="col">Status</th>
            <th scope="col">Count</th>
          </tr>
        </thead>
        <tbody>
          {slices.map((slice) => (
            <tr key={slice.label}>
              <td>{slice.label}</td>
              <td>{slice.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export interface WeekBar {
  label: string;
  value: number;
}

export function WeeklyBars({ weeks }: { weeks: WeekBar[] }) {
  const max = Math.max(...weeks.map((w) => w.value), 1);
  return (
    <div>
      <div
        className="flex h-28 items-end gap-2"
        role="img"
        aria-label={`Tasks completed per week: ${weeks.map((w) => `${w.label} ${w.value}`).join(", ")}.`}
      >
        {weeks.map((week) => (
          <div
            key={week.label}
            className="group flex h-full flex-1 flex-col items-center justify-end gap-1"
            title={`${week.label}: ${week.value} completed`}
          >
            <span className="text-[10.5px] text-muted tabular-nums opacity-0 transition-opacity group-hover:opacity-100">
              {week.value}
            </span>
            <div
              className="w-full max-w-7 rounded-t-[4px]"
              style={{
                height: `${Math.max((week.value / max) * 100, week.value > 0 ? 6 : 2)}%`,
                background:
                  week.value > 0
                    ? "var(--color-chart-primary)"
                    : "var(--color-surface-soft)",
              }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-2 border-t border-line pt-1">
        {weeks.map((week, i) => (
          <span
            key={week.label}
            className="flex-1 text-center text-[10px] text-muted"
          >
            {i % 2 === 0 ? week.label : ""}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Thin health progress bar with label carried by surrounding text. */
export function ProgressBar({
  percent,
  tone,
  label = "Progress",
}: {
  percent: number;
  tone: "good" | "attention" | "risk" | "neutral";
  label?: string;
}) {
  const color =
    tone === "good"
      ? "var(--color-chart-good)"
      : tone === "attention"
        ? "var(--color-chart-todo)"
        : tone === "risk"
          ? "var(--color-chart-overdue)"
          : "var(--color-muted)";
  return (
    <div
      className="h-1.5 w-full overflow-hidden rounded-full bg-surface-soft"
      role="progressbar"
      aria-label={label}
      aria-valuenow={Math.round(percent)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className="h-full rounded-full"
        style={{ width: `${Math.min(Math.max(percent, 0), 100)}%`, background: color }}
      />
    </div>
  );
}
