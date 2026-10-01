import type { Locale } from "@/lib/i18n/config";
import type { PropertyValue, QueryResult, QuerySpec, RunQuery } from "@/lib/objects/contracts";
import { findProperty, localized, type CatalogProperty, type LensCatalog } from "@/lib/query/catalog";
import { isQueryRefusal } from "@/lib/query/errors";
import { fill, pick, type AppsMessages } from "../i18n";
import type { AppScreen } from "../schema";

/**
 * One app screen. Views and dashboard tiles run a QuerySpec through `query`
 * (the lens query engine, as the viewer), so the viewer only ever sees
 * records their own access allows. The engine's catalog says which columns a
 * type has and how its options are labelled, in both languages. A type the
 * engine does not know says so plainly instead of showing an empty list that
 * looks like "no records".
 */

const LIST_LIMIT = 25;
const TILE_LIST_LIMIT = 5;
/** Counts stop here and show "100+". */
const COUNT_LIMIT = 100;
/** Shown beside the title when the type has them, in this order, two at most. */
const PREFERRED_COLUMNS = ["status", "due", "starts", "decided_time", "stage", "kind", "score", "likelihood", "edited_time"];

type Props = {
  screen: AppScreen;
  query: RunQuery;
  catalog: LensCatalog;
  messages: AppsMessages;
  locale: Locale;
};

async function tryQuery(query: RunQuery, spec: QuerySpec): Promise<QueryResult | null> {
  try {
    return await query(spec);
  } catch (error) {
    // Only a refusal ("this type or spec cannot be answered") becomes a notice; real failures reach the error boundary.
    if (isQueryRefusal(error)) return null;
    throw error;
  }
}

/** The columns a screen shows for a type: the preferred ones it has, shown and sortable or grouped. */
export function screenColumns(catalog: LensCatalog, type: string): CatalogProperty[] {
  const properties = catalog[type]?.properties ?? [];
  return PREFERRED_COLUMNS.map((key) => properties.find((p) => p.key === key && !p.filterOnly))
    .filter((p): p is CatalogProperty => p !== undefined)
    .slice(0, 2);
}

/** The property a board groups by: the screen's choice, else status, else the first groupable one with options. */
export function boardGroup(catalog: LensCatalog, type: string, chosen: string | undefined): string | undefined {
  const properties = catalog[type]?.properties ?? [];
  if (chosen) return chosen;
  return (properties.find((p) => p.key === "status" && p.groupable) ?? properties.find((p) => p.groupable && p.choices))?.key;
}

function label(property: CatalogProperty | undefined, key: string, locale: Locale): string {
  const choice = property?.choices?.find((c) => c.key === key);
  return choice ? localized(choice.label, locale) : key;
}

function display(property: CatalogProperty | undefined, value: PropertyValue | null | undefined, locale: Locale): string {
  if (!value || value.value === null || value.value === undefined) return "—";
  if ((value.kind === "status" || value.kind === "select") && typeof value.value === "string") {
    return label(property, value.value, locale);
  }
  if ((value.kind === "date" || value.kind === "created_time" || value.kind === "edited_time") && typeof value.value === "string") {
    const date = new Date(value.value.length === 10 ? `${value.value}T12:00:00Z` : value.value);
    return Number.isNaN(date.getTime()) ? value.value : new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(date);
  }
  if (Array.isArray(value.value)) return value.value.length ? String(value.value.length) : "—";
  if (typeof value.value === "object") return "—";
  return String(value.value);
}

function RowsTable({ result, columns, messages, locale, caption }: { result: QueryResult; columns: CatalogProperty[]; messages: AppsMessages; locale: Locale; caption: string }) {
  if (result.rows.length === 0) return <p className="text-[13.5px] text-muted">{messages.screens.empty}</p>;
  return (
    <div className="overflow-x-auto rounded-(--radius-md) border border-line bg-surface">
      <table className="w-full text-left text-[13.5px]">
        <caption className="sr-only">{caption}</caption>
        <thead className="border-b border-line bg-surface-soft text-[12.5px] text-muted">
          <tr>
            <th scope="col" className="px-3 py-2 font-medium">{messages.screens.title}</th>
            {columns.map((c) => (
              <th key={c.key} scope="col" className="px-3 py-2 font-medium">
                {localized(c.name, locale)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {result.rows.map((row) => (
            <tr key={row.ref.id}>
              <td className="px-3 py-2 text-ink">{row.title}</td>
              {columns.map((c) => (
                <td key={c.key} className="px-3 py-2 text-muted">{display(c, row.values[c.key], locale)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export async function AppScreenView({ screen, query, catalog, messages, locale }: Props) {
  const title = pick(screen.title, locale);

  if (screen.kind === "page") {
    return <p className="text-[13.5px] text-muted">{messages.screens.pageNotYet}</p>;
  }
  if (screen.kind === "form") {
    return <p className="text-[13.5px] text-muted">{fill(messages.screens.formNotYet, { form: screen.formKey })}</p>;
  }

  if (screen.kind === "lens") {
    const columns = screenColumns(catalog, screen.type);
    const groupBy = screen.lens === "board" ? boardGroup(catalog, screen.type, screen.groupBy) : undefined;
    const spec: QuerySpec = {
      version: 1,
      types: [screen.type],
      properties: columns.map((c) => c.key),
      limit: LIST_LIMIT,
      ...(groupBy ? { groupBy } : {}),
    };
    const result = catalog[screen.type] ? await tryQuery(query, spec) : null;
    const kind = messages.lensKinds[screen.lens];
    if (!result) {
      return <p className="text-[13.5px] text-muted">{fill(messages.screens.notYet, { type: screen.type, kind })}</p>;
    }
    if (screen.lens === "board" && result.groups && groupBy) {
      const property = findProperty(catalog, screen.type, groupBy);
      return (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label={title}>
          {result.groups.map((group) => (
            <li key={group.key ?? "none"} className="rounded-(--radius-md) border border-line bg-surface-soft/60 p-3">
              <h3 className="mb-2 text-[13px] font-semibold text-ink">
                {group.key ? label(property, group.key, locale) : "—"}{" "}
                <span className="font-normal text-muted">({group.rowIds.length})</span>
              </h3>
              <ul className="space-y-1.5">
                {group.rowIds.map((id) => {
                  const row = result.rows.find((r) => r.ref.id === id);
                  return row ? (
                    <li key={id} className="rounded-(--radius-sm) border border-line bg-surface px-2.5 py-1.5 text-[13px] text-ink">{row.title}</li>
                  ) : null;
                })}
              </ul>
            </li>
          ))}
        </ul>
      );
    }
    return (
      <div className="space-y-2">
        <RowsTable result={result} columns={columns} messages={messages} locale={locale} caption={title} />
        {result.nextCursor ? <p className="text-[12.5px] text-muted">{fill(messages.screens.more, { count: LIST_LIMIT })}</p> : null}
      </div>
    );
  }

  // Dashboard: each tile runs its own query.
  const tiles = await Promise.all(
    screen.widgets.map(async (widget) => {
      const spec: QuerySpec = {
        version: 1,
        types: [widget.type],
        properties: screenColumns(catalog, widget.type).map((c) => c.key),
        limit: widget.kind === "count" ? COUNT_LIMIT : TILE_LIST_LIMIT,
        ...(widget.filter ? { filter: { property: widget.filter.property, op: "eq" as const, value: widget.filter.value } } : {}),
      };
      return { widget, result: catalog[widget.type] ? await tryQuery(query, spec) : null };
    }),
  );
  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {tiles.map(({ widget, result }) => (
        <li key={widget.key} className="rounded-(--radius-md) border border-line bg-surface p-4">
          <h3 className="text-[13px] font-semibold text-muted">{pick(widget.title, locale)}</h3>
          {!result ? (
            <p className="mt-2 text-[13px] text-muted">{fill(messages.screens.notYet, { type: widget.type, kind: messages.widgetKinds[widget.kind] })}</p>
          ) : widget.kind === "count" ? (
            <p className="mt-1 text-[28px] font-semibold text-ink" data-testid={`tile-${widget.key}`}>
              {result.rows.length}
              {result.nextCursor ? "+" : ""}
            </p>
          ) : result.rows.length === 0 ? (
            <p className="mt-2 text-[13px] text-muted">{messages.screens.empty}</p>
          ) : (
            <ul className="mt-2 space-y-1 text-[13.5px] text-ink">
              {result.rows.map((row) => <li key={row.ref.id}>{row.title}</li>)}
            </ul>
          )}
        </li>
      ))}
    </ul>
  );
}
