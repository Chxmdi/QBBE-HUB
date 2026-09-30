"use client";

import * as React from "react";
import { useLocale } from "@/lib/i18n/client";
import { intlLocale } from "@/lib/i18n/config";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { findProperty, localized, type LensCatalog } from "@/lib/query/catalog";
import { runLens, runLensAll, type RpcClient } from "@/lib/query/run";
import type { LensNode, LensSpec } from "@/lib/query/spec";
import { QueryBlock } from "@/features/lenses/query-block";
import { useLensT } from "@/features/lenses/i18n/client";
import { formatLensValue } from "@/features/lenses/format";
import { applyDashboardFilters } from "./filters";
import type { DashboardFilters, Tile, TileSource } from "./schema";

const SUM_CAP = 5000;

type Client = RpcClient & {
  from: (t: string) => { select: (c: string) => { eq: (c: string, v: string) => { maybeSingle: () => PromiseLike<{ data: unknown; error: unknown }> } } };
};

/** A tile's spec: its lens's (read as the viewer) or its own, with the dashboard's filters. */
async function resolveSpec(client: Client, source: TileSource, filters: DashboardFilters, catalog: LensCatalog): Promise<LensSpec | "missing"> {
  let spec: LensSpec;
  if ("lensId" in source) {
    const { data, error } = await client.from("lens").select("spec").eq("id", source.lensId).maybeSingle();
    if (error) throw error;
    if (!data) return "missing";
    spec = (data as { spec: LensSpec }).spec;
  } else {
    spec = source.spec;
  }
  return applyDashboardFilters(spec, filters, catalog);
}

function and(spec: LensSpec, extra: LensNode): LensSpec {
  const own: LensNode[] = spec.where ? ("and" in spec.where ? spec.where.and : [spec.where]) : [];
  return { ...spec, where: { and: [...own, extra] } };
}

type Loaded<T> = { status: "loading" } | { status: "failed" | "missing" } | { status: "ready"; value: T };

/** Runs `load` whenever its inputs change; the tile shows loading, failure and missing on its own. */
function useTileData<T>(load: (client: Client) => Promise<T | "missing">, deps: unknown[]): Loaded<T> {
  const [state, setState] = React.useState<Loaded<T>>({ status: "loading" });
  React.useEffect(() => {
    let live = true;
    const run = async () => {
      try {
        const value = await load(createSupabaseBrowserClient() as unknown as Client);
        if (live) setState(value === "missing" ? { status: "missing" } : { status: "ready", value });
      } catch {
        if (live) setState({ status: "failed" });
      }
    };
    void run();
    return () => {
      live = false;
    };
    // The caller lists what the load depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
}

function TileState({ state }: { state: Loaded<unknown> }) {
  const t = useLensT();
  if (state.status === "loading") return <p className="text-[13px] text-muted">{t("dashboard.loading")}</p>;
  if (state.status === "failed" || state.status === "missing") {
    return (
      <p role="alert" className="text-[13px] text-danger-fg">
        {t(state.status === "failed" ? "dashboard.failed" : "dashboard.missing")}
      </p>
    );
  }
  return null;
}

interface TileProps {
  tile: Tile;
  filters: DashboardFilters;
  catalog: LensCatalog;
  timeZone: string;
}

async function measureValue(client: Client, spec: LensSpec, measure: { kind: "count" } | { kind: "sum"; property: string }, timeZone: string) {
  if (measure.kind === "count") {
    const result = await runLens(client, { ...spec, limit: 1, offset: 0 }, { timeZone });
    return { value: result.total, capped: false };
  }
  const result = await runLensAll(client, { ...spec, select: [measure.property], limit: 1000, offset: 0 }, { timeZone, maxRows: SUM_CAP });
  const value = result.rows.reduce((sum, r) => sum + (Number(r.values[measure.property]) || 0), 0);
  return { value: Math.round(value * 100) / 100, capped: result.total > result.rows.length };
}

function MetricTile({ tile, filters, catalog, timeZone }: TileProps & { tile: Extract<Tile, { kind: "metric" }> }) {
  const t = useLensT();
  const locale = useLocale();
  const state = useTileData(async (client) => {
    const spec = await resolveSpec(client, tile.source, filters, catalog);
    return spec === "missing" ? spec : measureValue(client, spec, tile.measure, timeZone);
  }, [JSON.stringify(tile), JSON.stringify(filters)]);
  if (state.status !== "ready") return <TileState state={state} />;
  return (
    <div>
      <p className="text-[32px] font-semibold tabular-nums text-ink" data-metric>
        {new Intl.NumberFormat(intlLocale(locale)).format(state.value.value)}
      </p>
      {state.value.capped ? <p className="text-[12px] text-muted">{t("dashboard.capped", { count: SUM_CAP })}</p> : null}
    </div>
  );
}

function GoalTile({ tile, filters, catalog, timeZone }: TileProps & { tile: Extract<Tile, { kind: "goal" }> }) {
  const t = useLensT();
  const locale = useLocale();
  const state = useTileData(async (client) => {
    const spec = await resolveSpec(client, tile.source, filters, catalog);
    return spec === "missing" ? spec : measureValue(client, spec, tile.measure, timeZone);
  }, [JSON.stringify(tile), JSON.stringify(filters)]);
  if (state.status !== "ready") return <TileState state={state} />;
  const num = new Intl.NumberFormat(intlLocale(locale));
  const percent = Math.min(100, Math.round((state.value.value / tile.target) * 100));
  const label = t("dashboard.ofTarget", { value: num.format(state.value.value), target: num.format(tile.target) });
  return <Bar percent={percent} label={label} detail={t("dashboard.percent", { percent })} />;
}

function ProgressTile({ tile, filters, catalog, timeZone }: TileProps & { tile: Extract<Tile, { kind: "progress" }> }) {
  const t = useLensT();
  const state = useTileData(async (client) => {
    const spec = await resolveSpec(client, tile.source, filters, catalog);
    if (spec === "missing") return spec;
    const [all, done] = await Promise.all([
      runLens(client, { ...spec, limit: 1, offset: 0 }, { timeZone }),
      runLens(client, { ...and(spec, { property: tile.doneProperty, operator: "is", value: tile.doneValue }), limit: 1, offset: 0 }, { timeZone }),
    ]);
    return { total: all.total, done: done.total };
  }, [JSON.stringify(tile), JSON.stringify(filters)]);
  if (state.status !== "ready") return <TileState state={state} />;
  const percent = state.value.total ? Math.round((state.value.done / state.value.total) * 100) : 0;
  return <Bar percent={percent} label={t("dashboard.progressLabel", { done: state.value.done, total: state.value.total })} detail={t("dashboard.percent", { percent })} />;
}

function Bar({ percent, label, detail }: { percent: number; label: string; detail: string }) {
  return (
    <div>
      <p className="text-[20px] font-semibold text-ink">{label}</p>
      <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label={label} className="mt-2 h-2.5 overflow-hidden rounded-full bg-surface-soft">
        <div className="h-full rounded-full bg-brand" style={{ width: `${percent}%` }} />
      </div>
      <p className="mt-1 text-[12.5px] text-muted">{detail}</p>
    </div>
  );
}

function ChartTile({ tile, filters, catalog, timeZone }: TileProps & { tile: Extract<Tile, { kind: "chart" }> }) {
  const t = useLensT();
  const locale = useLocale();
  const state = useTileData(async (client) => {
    const spec = await resolveSpec(client, tile.source, filters, catalog);
    if (spec === "missing") return spec;
    const result = await runLens(client, { ...spec, groupBy: { property: tile.groupBy }, sort: [], limit: 1, offset: 0 }, { timeZone });
    return { groups: result.groups ?? [], type: result.type };
  }, [JSON.stringify(tile), JSON.stringify(filters)]);
  if (state.status !== "ready") return <TileState state={state} />;
  const property = findProperty(catalog, state.value.type, tile.groupBy);
  const max = Math.max(1, ...state.value.groups.map((g) => g.total));
  if (!state.value.groups.length) return <p className="text-[13px] text-muted">{t("dashboard.noData")}</p>;
  // A table with a bar in each row: readable by screen readers as is, no separate fallback needed.
  return (
    <table className="w-full text-[13px]">
      <caption className="sr-only">{tile.title || (property ? localized(property.name, locale) : tile.groupBy)}</caption>
      <thead className="sr-only">
        <tr>
          <th scope="col">{property ? localized(property.name, locale) : tile.groupBy}</th>
          <th scope="col">{t("dashboard.count")}</th>
        </tr>
      </thead>
      <tbody>
        {state.value.groups.map((g) => {
          const label = g.key === null ? t("common.notSet") : property ? formatLensValue(property, g.label ?? g.key, locale, timeZone) : g.key;
          return (
            <tr key={g.key ?? "none"}>
              <th scope="row" className="w-2/5 truncate py-1 pr-2 text-left font-normal text-ink">{label}</th>
              <td className="py-1">
                <span className="flex items-center gap-2">
                  <span className="h-3 rounded-sm bg-(--color-chart-primary)" style={{ width: `${Math.max(2, (g.total / max) * 100)}%` }} aria-hidden />
                  <span className="tabular-nums text-muted">{g.total}</span>
                </span>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** Tiles that show rows reuse the query block, fed the tile's filtered spec. */
function RowsTile({ tile, filters, catalog, timeZone }: TileProps & { tile: Extract<Tile, { kind: "query" | "table" | "board" | "calendar" | "activity" }> }) {
  const t = useLensT();
  const state = useTileData(async (client) => resolveSpec(client, tile.source, filters, catalog), [JSON.stringify(tile), JSON.stringify(filters)]);
  if (state.status !== "ready") return <TileState state={state} />;
  let spec = state.value;
  let view: "table" | "list" | "board" = "table";
  let rows = 10;
  let columns: string[] | undefined;
  if (tile.kind === "board") view = "board";
  if (tile.kind === "query" || tile.kind === "table") rows = tile.rows;
  if (tile.kind === "calendar") {
    const days = tile.days;
    const today = new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date());
    const end = new Date(`${today}T00:00:00Z`);
    end.setUTCDate(end.getUTCDate() + days - 1);
    spec = { ...and(spec, { property: tile.dateProperty, operator: "between", value: { from: { date: today }, to: { date: end.toISOString().slice(0, 10) } } }), sort: [{ property: tile.dateProperty, direction: "asc" }] };
    view = "list";
    rows = 20;
    columns = [tile.dateProperty];
  }
  if (tile.kind === "activity") {
    spec = { ...spec, sort: [{ property: "edited_time", direction: "desc" }] };
    view = "list";
    rows = tile.rows;
    columns = ["edited_time"];
  }
  return <QueryBlock source={{ spec: { ...spec, limit: rows, offset: 0 } }} view={view} maxRows={rows} title={tile.title || t(`dashboard.kinds.${tile.kind}`)} columns={columns} timeZone={timeZone} />;
}

function TextTile({ tile }: { tile: Extract<Tile, { kind: "text" }> }) {
  // Plain text only: paragraphs split on blank lines, never HTML.
  return (
    <div className="space-y-2 text-[13.5px] leading-relaxed text-ink">
      {tile.body.split(/\n{2,}/).filter(Boolean).map((p, i) => (
        <p key={i} className="whitespace-pre-line">
          {p}
        </p>
      ))}
    </div>
  );
}

function EmbedTile({ tile, timeZone }: { tile: Extract<Tile, { kind: "embed" }>; timeZone: string }) {
  const t = useLensT();
  return (
    <div>
      <QueryBlock source={{ lensId: tile.lensId }} view={tile.view} maxRows={10} title={tile.title || undefined} timeZone={timeZone} />
      <p className="text-[11.5px] text-muted">{t("dashboard.filtersNote")}</p>
    </div>
  );
}

/** One tile's body, by kind. */
export function TileBody(props: TileProps) {
  const { tile } = props;
  switch (tile.kind) {
    case "metric":
      return <MetricTile {...props} tile={tile} />;
    case "goal":
      return <GoalTile {...props} tile={tile} />;
    case "progress":
      return <ProgressTile {...props} tile={tile} />;
    case "chart":
      return <ChartTile {...props} tile={tile} />;
    case "text":
      return <TextTile tile={tile} />;
    case "embed":
      return <EmbedTile tile={tile} timeZone={props.timeZone} />;
    default:
      return <RowsTile {...props} tile={tile} />;
  }
}
