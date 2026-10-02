"use client";

import * as React from "react";
import { ArrowDown, ArrowUp, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Checkbox, Input, Label, Select, Textarea } from "@/components/ui/input";
import { useLocale } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import { localized, type LensCatalog } from "@/lib/query/catalog";
import { RELATIVE_DATES } from "@/lib/query/spec";
import { OPEN_STATUSES } from "@/features/tasks/filters";
import { useLensT } from "@/features/lenses/i18n/client";
import { saveDashboardLayout } from "./actions";
import { TILE_KINDS, type DashboardFilters, type DashboardLayout, type Tile, type TileKind, type TileSource } from "./schema";
import { TileBody } from "./tiles";
import { CHART_KINDS, chartIsGrouped, chartNumberProperties, chartTotalOption, settingsFromTotalOption, totalsFor, type ChartKind } from "@/features/lenses/view-block/layouts/d3-chart";

export interface DashboardInfo {
  id: string;
  name: string;
  mine: boolean;
}

interface Option {
  id: string;
  label: string;
}

/** Kinds whose body is a query block with its own heading. */
const OWN_HEADING: TileKind[] = ["query", "table", "board", "calendar", "activity", "embed"];

const WIDTH_CLASS: Record<1 | 2 | 3, string> = {
  1: "lg:col-span-1",
  2: "lg:col-span-2",
  3: "lg:col-span-3",
};

function newId(): string {
  return `t-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * A dashboard lens (V1-5): a filter bar that applies to every tile, the
 * tiles in a three-column grid, and, for its owner, an edit mode to add,
 * order, resize and remove tiles.
 */
export function DashboardView({
  dashboard,
  layout,
  filters,
  catalog,
  programs,
  lenses,
  timeZone,
}: {
  dashboard: DashboardInfo;
  layout: DashboardLayout;
  filters: DashboardFilters;
  catalog: LensCatalog;
  programs: Option[];
  lenses: Option[];
  timeZone: string;
}) {
  const t = useLensT();
  const locale = useLocale();
  const [tiles, setTiles] = React.useState<Tile[]>(layout.tiles);
  const [editing, setEditing] = React.useState(false);
  const [adding, setAdding] = React.useState(false);
  const [message, setMessage] = React.useState("");
  const [pending, startTransition] = React.useTransition();

  const persist = (next: Tile[], nextFilters: DashboardFilters = layout.filters) => {
    setTiles(next);
    startTransition(async () => {
      const result = await saveDashboardLayout({ id: dashboard.id, layout: { tiles: next, filters: nextFilters } });
      // Local state is what the owner sees; the saved layout matches it, so no refresh.
      setMessage(result.ok ? t("dashboard.saved") : result.error ?? t("dashboard.saveFailed"));
    });
  };

  const move = (index: number, by: -1 | 1) => {
    const next = [...tiles];
    const target = index + by;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    persist(next);
  };

  const titleOf = (tile: Tile) => tile.title || t(`dashboard.kinds.${tile.kind}`);

  return (
    <div>
      <form method="get" action="/lenses/dashboard" className="mb-5 flex flex-wrap items-end gap-3" aria-label={t("dashboard.filters")}>
        <input type="hidden" name="lens" value={dashboard.id} />
        <div>
          <Label htmlFor="dash-program">{t("dashboard.program")}</Label>
          <Select id="dash-program" name="program" defaultValue={filters.program ?? ""}>
            <option value="">{t("dashboard.anyProgram")}</option>
            {programs.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="dash-dates">{t("dashboard.dates")}</Label>
          <Select id="dash-dates" name="dates" defaultValue={filters.dates ?? ""}>
            <option value="">{t("dashboard.anyDates")}</option>
            {RELATIVE_DATES.map((d) => (
              <option key={d} value={d}>
                {t(`dashboard.relative.${d}`)}
              </option>
            ))}
          </Select>
        </div>
        <label className="flex h-9.5 items-center gap-2 text-[13.5px] text-ink">
          <Checkbox name="mine" value="1" defaultChecked={filters.mine === true} />
          {/* Sent after the box, so "unticked" arrives as mine=0 and a ticked box wins. */}
          <input type="hidden" name="mine" value="0" />
          {t("dashboard.mine")}
        </label>
        <Button type="submit" variant="secondary">
          {t("dashboard.apply")}
        </Button>
        {dashboard.mine ? (
          <Button type="button" variant="ghost" loading={pending} onClick={() => persist(tiles, filters)}>
            {t("dashboard.saveFilters")}
          </Button>
        ) : null}
        {dashboard.mine ? (
          <Button type="button" variant={editing ? "primary" : "secondary"} className="ml-auto" onClick={() => setEditing((e) => !e)} aria-pressed={editing}>
            {editing ? t("dashboard.done") : t("dashboard.edit")}
          </Button>
        ) : null}
      </form>
      <p role="status" aria-live="polite" className="sr-only">
        {message}
      </p>

      {editing ? (
        <div className="mb-4">
          <Button type="button" onClick={() => setAdding(true)}>
            {t("dashboard.addTile")}
          </Button>
        </div>
      ) : null}

      {tiles.length === 0 ? (
        <p className="card px-4 py-8 text-center text-[13.5px] text-muted">{t("dashboard.empty")}</p>
      ) : (
        <ul className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {tiles.map((tile, index) => {
            const own = OWN_HEADING.includes(tile.kind);
            const headingId = `tile-${tile.id}`;
            return (
              <li key={tile.id} data-tile={tile.kind} className={cn(WIDTH_CLASS[tile.width], own ? "" : "card p-4")}>
                <section aria-labelledby={own ? undefined : headingId} aria-label={own ? titleOf(tile) : undefined}>
                  {editing ? (
                    <div className="mb-2 flex items-center justify-end gap-1">
                      <Button type="button" size="sm" variant="ghost" aria-label={t("dashboard.moveUp", { title: titleOf(tile) })} disabled={index === 0 || pending} onClick={() => move(index, -1)}>
                        <ArrowUp className="size-4" aria-hidden />
                      </Button>
                      <Button type="button" size="sm" variant="ghost" aria-label={t("dashboard.moveDown", { title: titleOf(tile) })} disabled={index === tiles.length - 1 || pending} onClick={() => move(index, 1)}>
                        <ArrowDown className="size-4" aria-hidden />
                      </Button>
                      <Button type="button" size="sm" variant="ghost" aria-label={t("dashboard.remove", { title: titleOf(tile) })} disabled={pending} onClick={() => persist(tiles.filter((x) => x.id !== tile.id))}>
                        <X className="size-4" aria-hidden />
                      </Button>
                    </div>
                  ) : null}
                  {own ? null : (
                    <h2 id={headingId} className="mb-2 text-[13px] font-semibold text-muted">
                      {titleOf(tile)}
                    </h2>
                  )}
                  <TileBody tile={tile} filters={filters} catalog={catalog} timeZone={timeZone} />
                </section>
              </li>
            );
          })}
        </ul>
      )}

      <AddTileDialog
        open={adding}
        catalog={catalog}
        lenses={lenses}
        locale={locale}
        onClose={() => setAdding(false)}
        onAdd={(tile) => {
          setAdding(false);
          persist([...tiles, tile]);
        }}
      />
    </div>
  );
}

function AddTileDialog({
  open,
  catalog,
  lenses,
  locale,
  onClose,
  onAdd,
}: {
  open: boolean;
  catalog: LensCatalog;
  lenses: Option[];
  locale: string;
  onClose: () => void;
  onAdd: (tile: Tile) => void;
}) {
  const t = useLensT();
  const [kind, setKind] = React.useState<TileKind>("metric");
  const [title, setTitle] = React.useState("");
  const [source, setSource] = React.useState("type:task");
  const [width, setWidth] = React.useState<1 | 2 | 3>(1);
  const [measure, setMeasure] = React.useState("count");
  const [groupBy, setGroupBy] = React.useState("status");
  const [chartKind, setChartKind] = React.useState<ChartKind>("bar");
  const [chartTotal, setChartTotal] = React.useState("count");
  const [target, setTarget] = React.useState("10");
  const [body, setBody] = React.useState("");
  const ids = React.useId();

  const typeOf = source === "type:project" ? "project" : "task";
  const props = catalog[typeOf]?.properties ?? [];
  const numbers = props.filter((p) => p.kind === "number");
  const groupables = props.filter((p) => p.groupable && !p.filterOnly);
  const chartNumbers = chartNumberProperties(catalog[typeOf]);

  const tileSource = (): TileSource => {
    if (source.startsWith("lens:")) return { lensId: source.slice(5) };
    if (source === "type:project") return { spec: { version: 1, type: "project" } };
    return { spec: { version: 1, type: "task", where: { and: [{ property: "status", operator: "is_any_of", value: [...OPEN_STATUSES] }] } } };
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const base = { id: newId(), title: title.trim(), width };
    const m = measure === "count" ? ({ kind: "count" } as const) : ({ kind: "sum", property: measure } as const);
    let tile: Tile;
    switch (kind) {
      case "text":
        tile = { ...base, kind, body };
        break;
      case "embed":
        if (!source.startsWith("lens:")) return;
        tile = { ...base, kind, lensId: source.slice(5), view: "table" };
        break;
      case "metric":
        tile = { ...base, kind, source: tileSource(), measure: m };
        break;
      case "goal":
        tile = { ...base, kind, source: tileSource(), measure: m, target: Math.max(1, Number(target) || 1) };
        break;
      case "chart":
        tile = { ...base, kind, source: tileSource(), groupBy, chart: settingsFromTotalOption(chartKind, chartTotal) };
        break;
      case "progress":
        tile = typeOf === "project"
          ? { ...base, kind, source: tileSource(), doneProperty: "stage", doneValue: "completed" }
          : { ...base, kind, source: tileSource(), doneProperty: "status", doneValue: "completed" };
        break;
      case "calendar":
        tile = { ...base, kind, source: tileSource(), dateProperty: typeOf === "project" ? "target" : "due", days: 14 };
        break;
      case "query":
      case "table":
        tile = { ...base, kind, source: tileSource(), rows: 10 };
        break;
      case "activity":
        tile = { ...base, kind, source: tileSource(), rows: 8 };
        break;
      default:
        tile = { ...base, kind: "board", source: tileSource() };
    }
    onAdd(tile);
    // Each tile starts from the defaults again, so one tile's settings never leak into the next.
    setTitle("");
    setBody("");
    setMeasure("count");
    setChartKind("bar");
    setChartTotal("count");
    setTarget("10");
    setWidth(1);
  };

  return (
    <Dialog open={open} onClose={onClose} title={t("dashboard.addTile")}>
      <form onSubmit={submit} className="space-y-3">
        <div>
          <Label htmlFor={`${ids}-kind`}>{t("dashboard.kind")}</Label>
          <Select id={`${ids}-kind`} value={kind} onChange={(e) => setKind(e.target.value as TileKind)}>
            {TILE_KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`dashboard.kinds.${k}`)}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor={`${ids}-title`}>{t("dashboard.tileTitle")}</Label>
          <Input id={`${ids}-title`} value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
        </div>
        {kind === "text" ? (
          <div>
            <Label htmlFor={`${ids}-body`}>{t("dashboard.body")}</Label>
            <Textarea id={`${ids}-body`} value={body} maxLength={2000} onChange={(e) => setBody(e.target.value)} />
          </div>
        ) : (
          <div>
            <Label htmlFor={`${ids}-source`}>{kind === "embed" ? t("dashboard.embedLens") : t("dashboard.source")}</Label>
            <Select
              id={`${ids}-source`}
              value={source}
              onChange={(e) => {
                setSource(e.target.value);
                // Another source has other number properties: a chart's total starts over as a count.
                setChartTotal("count");
              }}
            >
              {kind === "embed" ? null : (
                <>
                  <option value="type:task">{t("dashboard.allTasks")}</option>
                  <option value="type:project">{t("dashboard.allProjects")}</option>
                </>
              )}
              {lenses.map((l) => (
                <option key={l.id} value={`lens:${l.id}`}>
                  {l.label}
                </option>
              ))}
            </Select>
          </div>
        )}
        {kind === "metric" || kind === "goal" ? (
          <div>
            <Label htmlFor={`${ids}-measure`}>{t("dashboard.measure")}</Label>
            <Select id={`${ids}-measure`} value={measure} onChange={(e) => setMeasure(e.target.value)}>
              <option value="count">{t("dashboard.count")}</option>
              {numbers.map((p) => (
                <option key={p.key} value={p.key}>
                  {t("dashboard.sumOf", { property: localized(p.name, locale) })}
                </option>
              ))}
            </Select>
          </div>
        ) : null}
        {kind === "goal" ? (
          <div>
            <Label htmlFor={`${ids}-target`}>{t("dashboard.target")}</Label>
            <Input id={`${ids}-target`} type="number" min={1} value={target} onChange={(e) => setTarget(e.target.value)} />
          </div>
        ) : null}
        {kind === "chart" ? (
          <div>
            <Label htmlFor={`${ids}-chart-kind`}>{t("units.d3.settings.kind")}</Label>
            <Select
              id={`${ids}-chart-kind`}
              value={chartKind}
              onChange={(e) => {
                const next = e.target.value as ChartKind;
                setChartKind(next);
                setChartTotal(chartTotalOption(settingsFromTotalOption(next, chartTotal)));
              }}
            >
              {CHART_KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(`units.d3.kinds.${k}`)}
                </option>
              ))}
            </Select>
          </div>
        ) : null}
        {kind === "chart" ? (
          <div>
            <Label htmlFor={`${ids}-chart-total`}>{t("units.d3.settings.total")}</Label>
            <Select id={`${ids}-chart-total`} value={chartTotal} onChange={(e) => setChartTotal(e.target.value)}>
              <option value="count">{t("units.d3.settings.count")}</option>
              {chartNumbers.flatMap((p) =>
                totalsFor(chartKind).filter((fn) => fn !== "count").map((fn) => (
                  <option key={`${fn}:${p.key}`} value={`${fn}:${p.key}`}>
                    {t(`units.d3.settings.${fn}`, { property: localized(p.name, locale) })}
                  </option>
                )),
              )}
            </Select>
          </div>
        ) : null}
        {kind === "chart" && chartIsGrouped(chartKind) ? (
          <div>
            <Label htmlFor={`${ids}-group`}>{t("dashboard.groupBy")}</Label>
            <Select id={`${ids}-group`} value={groupBy} onChange={(e) => setGroupBy(e.target.value)}>
              {groupables.map((p) => (
                <option key={p.key} value={p.key}>
                  {localized(p.name, locale)}
                </option>
              ))}
            </Select>
          </div>
        ) : null}
        <div>
          <Label htmlFor={`${ids}-width`}>{t("dashboard.width")}</Label>
          <Select id={`${ids}-width`} value={String(width)} onChange={(e) => setWidth(Number(e.target.value) as 1 | 2 | 3)}>
            <option value="1">{t("dashboard.widths.one")}</option>
            <option value="2">{t("dashboard.widths.two")}</option>
            <option value="3">{t("dashboard.widths.three")}</option>
          </Select>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t("dashboard.cancel")}
          </Button>
          <Button type="submit" disabled={kind === "embed" && !source.startsWith("lens:")}>
            {t("dashboard.add")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
