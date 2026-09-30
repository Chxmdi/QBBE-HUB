import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Checkbox, Select } from "@/components/ui/input";
import { requireInsightEnabled } from "@/features/insight/gate";
import { getInsightT } from "@/features/insight/i18n/translate";
import { GraphLens, typeLabel, type GraphView } from "@/features/lenses-graph/components/graph-lens";
import { clampDepth, filterGraph, MAX_DEPTH, type GraphFilter } from "@/features/lenses-graph/graph";
import { GRAPH_TYPES, loadWorkGraph } from "@/features/lenses-graph/graph.source";
import { requireSession } from "@/lib/auth";
import { createSupabasePageClient } from "@/lib/supabase/page";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getInsightT())("graph.title") };
}
export const dynamic = "force-dynamic";

type Params = Record<string, string | string[] | undefined>;

const list = (value: string | string[] | undefined) =>
  value === undefined ? [] : Array.isArray(value) ? value : [value];

export default async function GraphPage({ searchParams }: { searchParams: Promise<Params> }) {
  await requireInsightEnabled();
  await requireSession();
  const [params, t, client] = await Promise.all([searchParams, getInsightT(), createSupabasePageClient()]);
  const { data, truncated } = await loadWorkGraph(client);

  const requestedTypes = list(params.type).filter((type) =>
    (GRAPH_TYPES as readonly string[]).includes(type),
  );
  const rootParam = list(params.root)[0] ?? "";
  const filter: GraphFilter = {
    types: requestedTypes.length ? requestedTypes : [...GRAPH_TYPES],
    rootId: data.nodes.some((node) => node.ref.id === rootParam) ? rootParam : null,
    depth: clampDepth(list(params.depth)[0] ?? 2),
  };
  const view: GraphView = list(params.view)[0] === "list" ? "list" : "graph";

  const hrefFor = (change: Partial<GraphFilter> & { view?: GraphView }) => {
    const next = { ...filter, view, ...change };
    const query = new URLSearchParams();
    if (next.types.length !== GRAPH_TYPES.length) for (const type of next.types) query.append("type", type);
    if (next.rootId) query.set("root", next.rootId);
    query.set("depth", String(next.depth));
    if (next.view === "list") query.set("view", "list");
    return `/insight/graph?${query.toString()}`;
  };

  const shown = filterGraph(data, filter);
  const roots = data.nodes
    .filter((node) => node.ref.type !== "task")
    .sort((a, b) => GRAPH_TYPES.indexOf(a.ref.type as never) - GRAPH_TYPES.indexOf(b.ref.type as never) || a.title.localeCompare(b.title));

  return (
    <div>
      <PageHeader eyebrow={t("common.eyebrow")} title={t("graph.title")} description={t("graph.description")} />
      <form
        method="get"
        action="/insight/graph"
        aria-label={t("graph.filters")}
        className="mb-5 flex flex-wrap items-end gap-4 rounded-(--radius-md) border border-line bg-surface p-4"
      >
        <fieldset className="flex flex-wrap items-center gap-3">
          <legend className="mb-1 text-body-sm font-medium text-ink">{t("graph.typesLegend")}</legend>
          {GRAPH_TYPES.map((type) => (
            <label key={type} className="flex items-center gap-1.5 text-body-sm text-ink">
              <Checkbox name="type" value={type} defaultChecked={filter.types.includes(type)} />
              {typeLabel(t, type)}
            </label>
          ))}
        </fieldset>
        <label className="flex flex-col gap-1 text-body-sm font-medium text-ink">
          {t("graph.root")}
          <Select name="root" defaultValue={filter.rootId ?? ""} className="max-w-72">
            <option value="">{t("graph.rootAll")}</option>
            {roots.map((node) => (
              <option key={node.ref.id} value={node.ref.id}>
                {typeLabel(t, node.ref.type)}: {node.title}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-body-sm font-medium text-ink">
          {t("graph.depth")}
          <Select name="depth" defaultValue={String(filter.depth)}>
            {Array.from({ length: MAX_DEPTH }, (_, index) => index + 1).map((depth) => (
              <option key={depth} value={depth}>
                {depth === 1 ? t("graph.depthOne") : t("graph.depthOption", { count: depth })}
              </option>
            ))}
          </Select>
        </label>
        {view === "list" ? <input type="hidden" name="view" value="list" /> : null}
        <Button type="submit">{t("common.apply")}</Button>
      </form>
      {truncated ? <p className="mb-3 text-body-sm text-warning-fg">{t("graph.truncated")}</p> : null}
      <GraphLens data={shown} filter={filter} view={view} t={t} hrefFor={hrefFor} typeOrder={GRAPH_TYPES} />
    </div>
  );
}
