import Link from "next/link";
import { Network } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import type { InsightKey, InsightT } from "@/features/insight/i18n/translate";
import type { ObjectTypeKey, Uuid } from "@/lib/objects/contracts";
import {
  layoutGraph,
  outlineGraph,
  type GraphData,
  type GraphFilter,
  type OutlineItem,
} from "../graph";

/**
 * The graph lens (V2-1). A server component: the picture is an SVG whose
 * nodes are ordinary links (Tab moves between them, Enter re-centres the
 * graph), and the list view carries the same content as nested lists for
 * screen readers. S4's lens switcher mounts it with any GraphData.
 */

const SIZE = 720;

/** Design-token classes per type, so the picture follows the theme. */
const TYPE_FILL: Record<string, string> = {
  program: "fill-chart-primary",
  project: "fill-chart-progress",
  milestone: "fill-chart-todo",
  task: "fill-chart-good",
};

export type GraphView = "graph" | "list";

export interface GraphLensProps {
  data: GraphData;
  filter: GraphFilter;
  view: GraphView;
  t: InsightT;
  /** Builds the link for a changed filter or view, keeping the rest. */
  hrefFor: (change: Partial<GraphFilter> & { view?: GraphView }) => string;
  typeOrder: readonly ObjectTypeKey[];
}

export function typeLabel(t: InsightT, type: ObjectTypeKey): string {
  const key = `common.types.${type}` as InsightKey;
  const label = t(key);
  return label === key ? type : label;
}

function shorten(title: string, max = 26): string {
  return title.length > max ? `${title.slice(0, max - 1)}…` : title;
}

export function GraphLens({ data, filter, view, t, hrefFor, typeOrder }: GraphLensProps) {
  if (data.nodes.length === 0) {
    return (
      <EmptyState
        icon={<Network />}
        title={t("graph.emptyTitle")}
        description={t("graph.emptyDescription")}
      />
    );
  }
  const counts = { nodes: data.nodes.length, edges: data.edges.length };
  return (
    <section aria-labelledby="graph-lens-heading" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p id="graph-lens-heading" className="text-body-sm text-muted" aria-live="polite">
          {t("graph.summary", counts)}
        </p>
        <nav aria-label={t("graph.viewLabel")} className="flex gap-1 rounded-(--radius-sm) border border-line p-1">
          {(["graph", "list"] as const).map((option) => (
            <Link
              key={option}
              href={hrefFor({ view: option })}
              aria-current={view === option ? "page" : undefined}
              className="rounded-(--radius-sm) px-3 py-1 text-body-sm text-ink hover:bg-surface-soft aria-[current=page]:bg-brand aria-[current=page]:text-white"
            >
              {option === "graph" ? t("graph.viewGraph") : t("graph.viewList")}
            </Link>
          ))}
        </nav>
      </div>
      {view === "graph" ? (
        <GraphPicture data={data} filter={filter} t={t} hrefFor={hrefFor} typeOrder={typeOrder} counts={counts} />
      ) : (
        <GraphOutline data={data} rootId={filter.rootId} t={t} hrefFor={hrefFor} />
      )}
    </section>
  );
}

function GraphPicture({
  data,
  filter,
  t,
  hrefFor,
  typeOrder,
  counts,
}: Omit<GraphLensProps, "view"> & { counts: { nodes: number; edges: number } }) {
  const placed = layoutGraph(data, filter.rootId, SIZE, typeOrder);
  const at = new Map(placed.map((node) => [node.ref.id, node]));
  return (
    <div className="space-y-2">
      <div className="overflow-auto rounded-(--radius-md) border border-line bg-surface">
        <svg
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          className="mx-auto block h-auto w-full max-w-[720px] min-w-[480px]"
          role="group"
          aria-label={t("graph.graphLabel", counts)}
        >
          <g aria-hidden="true">
            {data.edges.map((edge) => {
              const from = at.get(edge.from.id);
              const to = at.get(edge.to.id);
              if (!from || !to) return null;
              return (
                <line
                  key={`${edge.from.id}-${edge.relationTypeKey}-${edge.to.id}`}
                  x1={from.x}
                  y1={from.y}
                  x2={to.x}
                  y2={to.y}
                  className={edge.relationTypeKey === "blocks" ? "stroke-chart-overdue" : "stroke-muted"}
                  strokeWidth={edge.relationTypeKey === "blocks" ? 1.6 : 1}
                  strokeDasharray={edge.relationTypeKey === "blocks" ? "5 4" : undefined}
                  strokeOpacity={0.7}
                />
              );
            })}
          </g>
          {placed.map((node) => {
            const isRoot = node.ref.id === filter.rootId;
            return (
              <a
                key={node.ref.id}
                href={hrefFor({ rootId: node.ref.id })}
                aria-label={t("graph.centreHere", { title: `${typeLabel(t, node.ref.type)}: ${node.title}` })}
                className="group outline-none"
              >
                <circle
                  cx={node.x}
                  cy={node.y}
                  r={isRoot ? 11 : 7}
                  className={`${TYPE_FILL[node.ref.type] ?? "fill-muted"} stroke-surface group-focus-visible:stroke-ink group-hover:stroke-ink`}
                  strokeWidth={isRoot ? 3 : 2}
                />
                <circle
                  cx={node.x}
                  cy={node.y}
                  r={isRoot ? 16 : 12}
                  className="fill-none stroke-none group-focus-visible:stroke-brand"
                  strokeWidth={2.5}
                />
                <text
                  x={node.x}
                  y={node.y + (isRoot ? 28 : 22)}
                  textAnchor="middle"
                  className={`fill-ink text-[11px] ${isRoot ? "font-semibold" : ""}`}
                >
                  {shorten(node.title)}
                </text>
              </a>
            );
          })}
        </svg>
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-meta text-muted" aria-label={t("graph.typesLegend")}>
        {[...new Set(placed.map((node) => node.ref.type))].map((type) => (
          <li key={type} className="flex items-center gap-1.5">
            <svg width="10" height="10" aria-hidden="true">
              <circle cx="5" cy="5" r="5" className={TYPE_FILL[type] ?? "fill-muted"} />
            </svg>
            {typeLabel(t, type)}
          </li>
        ))}
        <li>{t("graph.legendContains")}</li>
        <li>{t("graph.legendBlocks")}</li>
      </ul>
    </div>
  );
}

function relationText(t: InsightT, via: OutlineItem["via"]): string | null {
  if (!via) return null;
  const key = `graph.relation.${via.relationTypeKey}${via.direction === "out" ? "Out" : "In"}` as InsightKey;
  return t(key);
}

function OutlineList({
  items,
  t,
  hrefFor,
  rootId,
  level,
}: {
  items: OutlineItem[];
  t: InsightT;
  hrefFor: GraphLensProps["hrefFor"];
  rootId: Uuid | null;
  level: number;
}) {
  return (
    <ul className={level === 0 ? "space-y-1.5" : "mt-1 space-y-1 border-l border-line pl-4"}>
      {items.map((item) => {
        const relation = relationText(t, item.via);
        return (
          <li key={`${level}-${item.node.ref.id}`}>
            <div className="flex flex-wrap items-baseline gap-x-2 text-body-sm">
              {relation ? <span className="text-muted">{relation}</span> : null}
              <span className="text-meta uppercase tracking-wide text-muted">{typeLabel(t, item.node.ref.type)}</span>
              {item.node.href ? (
                <Link href={item.node.href} className="font-medium text-brand-fg underline-offset-2 hover:underline">
                  {item.node.title}
                </Link>
              ) : (
                <span className="font-medium text-ink">{item.node.title}</span>
              )}
              {item.node.ref.id !== rootId ? (
                <Link
                  href={hrefFor({ rootId: item.node.ref.id })}
                  className="text-meta text-muted underline underline-offset-2 hover:text-ink"
                  aria-label={t("graph.centreHere", { title: item.node.title })}
                >
                  {t("graph.viewGraph")}
                </Link>
              ) : null}
            </div>
            {item.children.length ? (
              <OutlineList items={item.children} t={t} hrefFor={hrefFor} rootId={rootId} level={level + 1} />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function GraphOutline({
  data,
  rootId,
  t,
  hrefFor,
}: {
  data: GraphData;
  rootId: Uuid | null;
  t: InsightT;
  hrefFor: GraphLensProps["hrefFor"];
}) {
  return (
    <div className="rounded-(--radius-md) border border-line bg-surface p-4">
      <OutlineList items={outlineGraph(data, rootId)} t={t} hrefFor={hrefFor} rootId={rootId} level={0} />
    </div>
  );
}
