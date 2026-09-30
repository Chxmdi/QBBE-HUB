import { CheckCircle2, CircleAlert, CircleDashed, TrendingUp } from "lucide-react";
import type { Formatters } from "@/lib/i18n/format";
import type { InsightT } from "../i18n/translate";
import type { GoalStatus, GoalTrajectory } from "../operations/operations";

/**
 * A goal trajectory tile for dashboards (V3-5): the latest value against the
 * planned straight line, the pace carried forward, and a small line of the
 * measurements. Status is always words plus an icon, never colour alone.
 */

const STATUS_STYLE: Record<GoalStatus, { icon: typeof CheckCircle2; className: string }> = {
  ahead: { icon: TrendingUp, className: "text-success-fg" },
  on_track: { icon: CheckCircle2, className: "text-success-fg" },
  reached: { icon: CheckCircle2, className: "text-success-fg" },
  behind: { icon: CircleAlert, className: "text-danger-fg" },
  no_data: { icon: CircleDashed, className: "text-muted" },
  no_target: { icon: CircleDashed, className: "text-muted" },
};

const W = 220;
const H = 48;

function Sparkline({ trajectory, label }: { trajectory: GoalTrajectory; label: string }) {
  const values = trajectory.points.map((p) => p.value);
  const target = trajectory.metric.target;
  const all = target === null ? values : [...values, target];
  const min = Math.min(...all);
  const max = Math.max(...all);
  const span = max - min || 1;
  const x = (index: number) => (values.length === 1 ? W / 2 : 4 + (index * (W - 8)) / (values.length - 1));
  const y = (value: number) => H - 4 - ((value - min) / span) * (H - 8);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 h-12 w-full" role="img" aria-label={label}>
      {target !== null ? (
        <line x1={0} x2={W} y1={y(target)} y2={y(target)} className="stroke-muted" strokeDasharray="4 3" strokeWidth={1} />
      ) : null}
      <polyline
        points={values.map((value, index) => `${x(index)},${y(value)}`).join(" ")}
        className="fill-none stroke-chart-primary"
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {values.length ? <circle cx={x(values.length - 1)} cy={y(values.at(-1)!)} r={4} className="fill-chart-primary stroke-surface" strokeWidth={2} /> : null}
    </svg>
  );
}

export function GoalTile({ trajectory, t, format }: { trajectory: GoalTrajectory; t: InsightT; format: Formatters }) {
  const { metric, latest, expected, projected, status } = trajectory;
  const style = STATUS_STYLE[status];
  const Icon = style.icon;
  const number = (value: number) => format.number(value, { maximumFractionDigits: 1 });
  const date = (value: string) => format.inZone(`${value}T12:00:00Z`, "UTC", { dateStyle: "medium" });
  const statusText = t(`operations.goal.status.${status}`);
  return (
    <article className="rounded-(--radius-md) border border-line bg-surface p-4" aria-label={metric.name}>
      <h3 className="text-body font-semibold text-ink">{metric.name}</h3>
      <p className={`mt-1 flex items-center gap-1.5 text-body-sm font-medium ${style.className}`}>
        <Icon className="size-4" aria-hidden="true" />
        {statusText}
      </p>
      <ul className="mt-2 space-y-0.5 text-meta text-muted">
        {latest ? <li>{t("operations.goal.latest", { value: number(latest.value), unit: metric.unit, date: date(latest.on) })}</li> : null}
        {metric.target !== null && metric.targetOn ? (
          <li>{t("operations.goal.target", { value: number(metric.target), unit: metric.unit, date: date(metric.targetOn) })}</li>
        ) : null}
        {expected !== null && status !== "reached" ? <li>{t("operations.goal.expected", { value: number(expected) })}</li> : null}
        {projected !== null && status !== "reached" ? <li>{t("operations.goal.projected", { value: number(projected) })}</li> : null}
      </ul>
      {trajectory.points.length ? (
        <Sparkline
          trajectory={trajectory}
          label={t("operations.goal.chart", {
            name: metric.name,
            count: trajectory.points.length,
            value: number(latest!.value),
            unit: metric.unit,
            status: statusText,
          })}
        />
      ) : null}
    </article>
  );
}
