"use client";

import * as React from "react";
import Link from "next/link";
import { useLocale } from "@/lib/i18n/client";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { DEFAULT_TIME_ZONE } from "@/lib/time";
import { cn } from "@/lib/utils";
import { findProperty, localized, type CatalogProperty, type LensCatalog } from "@/lib/query/catalog";
import { loadCatalog, runLens, type LensResult, type RpcClient } from "@/lib/query/run";
import type { LensSpec } from "@/lib/query/spec";
import { useLensT } from "@/features/lenses/i18n/client";
import { formatLensValue } from "@/features/lenses/format";
import { parseQueryBlockProps, type QueryBlockProps } from "./schema";

type State =
  | { status: "loading" }
  | { status: "invalid" | "missing" | "failed" }
  | { status: "ready"; result: LensResult; catalog: LensCatalog; title: string | null; lensId: string | null; spec: LensSpec };

interface LensSource {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: string) => { maybeSingle: () => PromiseLike<{ data: unknown; error: unknown }> };
    };
  };
}

/**
 * A live lens inside a page (M8e), exported for the editor stream.
 *
 * It reads with the browser session of whoever is looking at the page, so the
 * rows are always that reader's rows. Read-only and compact: a table, a list
 * or a small board, the first `maxRows` rows, and a link to open the full
 * lens. Bad props, a lens that is gone or not shared, and load failures each
 * show their own message instead of an empty block.
 */
export function QueryBlock(props: QueryBlockProps & { timeZone?: string; client?: RpcClient & LensSource }) {
  const t = useLensT();
  const locale = useLocale();
  const headingId = React.useId();
  const { timeZone: zone, client: injected, ...blockProps } = props;
  const propsKey = JSON.stringify(blockProps);
  // Keyed on the serialised props, so a parent re-render with equal props
  // does not reload the block.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const parsed = React.useMemo(() => parseQueryBlockProps(blockProps), [propsKey]);
  const [state, setState] = React.useState<State>({ status: "loading" });
  const [attempt, setAttempt] = React.useState(0);
  const timeZone = zone ?? DEFAULT_TIME_ZONE;

  React.useEffect(() => {
    let live = true;
    const run = async () => {
      if (!parsed) return setState({ status: "invalid" });
      const client = injected ?? (createSupabaseBrowserClient() as unknown as RpcClient & LensSource);
      let spec: LensSpec;
      let title = parsed.title ?? null;
      let lensId: string | null = null;
      if ("lensId" in parsed.source) {
        lensId = parsed.source.lensId;
        const { data, error } = await client.from("lens").select("name, spec").eq("id", lensId).maybeSingle();
        if (error) return live && setState({ status: "failed" });
        if (!data) return live && setState({ status: "missing" });
        const row = data as { name: string; spec: LensSpec };
        spec = row.spec;
        title = title ?? row.name;
      } else {
        spec = parsed.source.spec;
      }
      try {
        const [catalog, result] = await Promise.all([
          loadCatalog(client),
          runLens(client, { ...spec, limit: parsed.maxRows, offset: 0, ...(parsed.view === "board" && !spec.groupBy ? { groupBy: { property: "status" } } : {}) }, { timeZone }),
        ]);
        if (live) setState({ status: "ready", result, catalog, title, lensId, spec });
      } catch {
        if (live) setState({ status: "failed" });
      }
    };
    void run();
    return () => {
      live = false;
    };
  }, [parsed, injected, timeZone, attempt]);

  const heading = state.status === "ready" ? state.title ?? t("block.fallbackTitle") : parsed?.title ?? t("block.fallbackTitle");

  return (
    <section aria-labelledby={headingId} className="card my-3 overflow-hidden" data-query-block>
      <header className="flex items-center justify-between gap-3 border-b border-line bg-surface-soft px-4 py-2.5">
        <h3 id={headingId} className="text-[13.5px] font-semibold text-ink">
          {heading}
        </h3>
        {state.status === "ready" ? (
          <Link
            href={state.lensId ? `/lenses/table?lens=${state.lensId}` : `/lenses/table?type=${state.spec.type}`}
            className="text-[12.5px] font-medium text-brand-fg hover:underline"
          >
            {t("block.openFull")}
          </Link>
        ) : null}
      </header>
      <div aria-live="polite" aria-busy={state.status === "loading"}>
        {state.status === "loading" ? <p className="px-4 py-4 text-[13px] text-muted">{t("block.loading")}</p> : null}
        {state.status === "invalid" || state.status === "missing" || state.status === "failed" ? (
          <div role="alert" className="px-4 py-4 text-[13px]">
            <p className="text-danger-fg">{t(`block.${state.status}`)}</p>
            {state.status === "failed" ? (
              <button type="button" onClick={() => {
                  setState({ status: "loading" });
                  setAttempt((a) => a + 1);
                }} className="mt-1 font-medium text-brand-fg hover:underline">
                {t("block.retry")}
              </button>
            ) : null}
          </div>
        ) : null}
        {state.status === "ready" && parsed ? (
          <BlockBody
            view={parsed.view}
            result={state.result}
            properties={blockColumns(state.catalog, state.result.type, parsed.columns ?? state.spec.select ?? [])}
            groupProperty={state.result.groupBy ? findProperty(state.catalog, state.result.type, state.result.groupBy) ?? null : null}
            locale={locale}
            timeZone={timeZone}
          />
        ) : null}
      </div>
    </section>
  );
}

function blockColumns(catalog: LensCatalog, type: string, keys: string[]): CatalogProperty[] {
  return keys
    .filter((k) => k !== "title")
    .map((k) => findProperty(catalog, type, k))
    .filter((p): p is CatalogProperty => Boolean(p && !p.filterOnly))
    .slice(0, 6);
}

function BlockBody({
  view,
  result,
  properties,
  groupProperty,
  locale,
  timeZone,
}: {
  view: "table" | "list" | "board";
  result: LensResult;
  properties: CatalogProperty[];
  groupProperty: CatalogProperty | null;
  locale: "en" | "fr-CA";
  timeZone: string;
}) {
  const t = useLensT();
  const more = result.total - result.rows.length;
  const titleOf = (id: string, title: string) =>
    result.type === "task" ? (
      <Link href={`/my-work?task=${id}`} className="font-medium text-ink hover:text-brand-fg">
        {title}
      </Link>
    ) : (
      <span className="font-medium">{title}</span>
    );

  if (result.rows.length === 0) return <p className="px-4 py-4 text-[13px] text-muted">{t("block.empty")}</p>;

  let body: React.ReactNode;
  if (view === "table") {
    body = (
      <div className="overflow-x-auto" tabIndex={0} role="region" aria-label={t("block.fallbackTitle")}>
        <table className="w-full text-[13px]">
          <thead className="text-left text-muted">
            <tr>
              <th scope="col" className="px-4 py-2 font-semibold">{t("common.type")}</th>
              {properties.map((p) => (
                <th key={p.key} scope="col" className={cn("px-3 py-2 font-semibold", p.kind === "number" && "text-right")}>
                  {localized(p.name, locale)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {result.rows.map((row) => (
              <tr key={row.id}>
                <td className="px-4 py-2">{titleOf(row.id, row.title)}</td>
                {properties.map((p) => (
                  <td key={p.key} className={cn("px-3 py-2", p.kind === "number" && "text-right tabular-nums")}>
                    {formatLensValue(p, row.values[p.key] ?? null, locale, timeZone)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  } else if (view === "list") {
    body = (
      <ul className="divide-y divide-line">
        {result.rows.map((row) => (
          <li key={row.id} className="flex flex-wrap items-baseline gap-x-3 px-4 py-2 text-[13px]">
            {titleOf(row.id, row.title)}
            <span className="meta flex flex-wrap gap-x-2">
              {properties.map((p) => {
                const text = formatLensValue(p, row.values[p.key] ?? null, locale, timeZone);
                return text ? <span key={p.key}>{text}</span> : null;
              })}
            </span>
          </li>
        ))}
      </ul>
    );
  } else {
    const groups = result.groups ?? [];
    body = (
      <div className="flex gap-3 overflow-x-auto p-3" tabIndex={0} role="region" aria-label={t("block.fallbackTitle")}>
        {groups.map((g) => {
          const label = g.key === null ? t("common.notSet") : groupProperty ? formatLensValue(groupProperty, g.label ?? g.key, locale, timeZone) : g.key;
          const rows = result.rows.filter((r) => r.group === g.key);
          return (
            <div key={g.key ?? "none"} className="w-56 shrink-0 rounded-(--radius-sm) border border-line bg-surface-soft/50 p-2">
              <h4 className="mb-1.5 flex justify-between px-1 text-[12px] font-bold uppercase tracking-[0.05em] text-ink">
                <span>{label}</span>
                <span className="text-muted">{g.total}</span>
              </h4>
              <ul className="space-y-1.5">
                {rows.map((row) => (
                  <li key={row.id} className="card px-2.5 py-2 text-[12.5px]">
                    {titleOf(row.id, row.title)}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    );
  }
  return (
    <>
      {body}
      {more > 0 ? <p className="border-t border-line px-4 py-2 text-[12.5px] text-muted">{t("block.more", { count: more })}</p> : null}
    </>
  );
}
