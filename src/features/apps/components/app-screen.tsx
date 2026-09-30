import type { Locale } from "@/lib/i18n/config";
import type { TranslateFn, MessageKey } from "@/lib/i18n/translate";
import type { PropertyValue, QueryResult, QuerySpec, RunQuery } from "@/lib/objects/contracts";
import { fill, pick, type AppsMessages } from "../i18n";
import type { AppScreen } from "../schema";

/**
 * One app screen. Views and dashboard tiles run a QuerySpec through `query`
 * (the task stand-in today, the S4 engine later), so the viewer only ever sees
 * records their own access allows. Types the stand-in cannot answer yet say
 * so plainly instead of showing an empty list that looks like "no records".
 */

const LIST_LIMIT = 25;
const TILE_LIST_LIMIT = 5;
/** Counts stop here and show "100+"; exact totals arrive with the query engine's count (S4). */
const COUNT_LIMIT = 100;

type Props = {
  screen: AppScreen;
  query: RunQuery;
  messages: AppsMessages;
  locale: Locale;
  t: TranslateFn;
};

async function tryQuery(query: RunQuery, spec: QuerySpec): Promise<QueryResult | null> {
  try {
    return await query(spec);
  } catch (error) {
    // Only "this type is not queryable yet" becomes a notice; real failures reach the error boundary.
    if (error instanceof Error && error.name === "QueryNotSupportedError") return null;
    throw error;
  }
}

function display(value: PropertyValue | null | undefined, t: TranslateFn, locale: Locale): string {
  if (!value || value.value === null || value.value === undefined) return "—";
  if (value.kind === "status" && typeof value.value === "string") {
    return t(`shell.status.task.${value.value}` as MessageKey);
  }
  if (value.kind === "date" && typeof value.value === "string") {
    const date = new Date(value.value.length === 10 ? `${value.value}T12:00:00Z` : value.value);
    return Number.isNaN(date.getTime()) ? value.value : new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(date);
  }
  if (Array.isArray(value.value)) return value.value.length ? String(value.value.length) : "—";
  if (typeof value.value === "object") return "—";
  return String(value.value);
}

const COLUMNS = ["status", "due"] as const;

function RowsTable({ result, messages, locale, t, caption }: { result: QueryResult; messages: AppsMessages; locale: Locale; t: TranslateFn; caption: string }) {
  if (result.rows.length === 0) return <p className="text-[13.5px] text-muted">{messages.screens.empty}</p>;
  return (
    <div className="overflow-x-auto rounded-(--radius-md) border border-line bg-surface">
      <table className="w-full text-left text-[13.5px]">
        <caption className="sr-only">{caption}</caption>
        <thead className="border-b border-line bg-surface-soft text-[12.5px] text-muted">
          <tr>
            <th scope="col" className="px-3 py-2 font-medium">{messages.screens.title}</th>
            {COLUMNS.map((c) => (
              <th key={c} scope="col" className="px-3 py-2 font-medium">
                {c === "status" ? messages.screens.status : messages.screens.due}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {result.rows.map((row) => (
            <tr key={row.ref.id}>
              <td className="px-3 py-2 text-ink">{row.title}</td>
              {COLUMNS.map((c) => (
                <td key={c} className="px-3 py-2 text-muted">{display(row.values[c], t, locale)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export async function AppScreenView({ screen, query, messages, locale, t }: Props) {
  const title = pick(screen.title, locale);

  if (screen.kind === "page") {
    return <p className="text-[13.5px] text-muted">{messages.screens.pageNotYet}</p>;
  }
  if (screen.kind === "form") {
    return <p className="text-[13.5px] text-muted">{fill(messages.screens.formNotYet, { form: screen.formKey })}</p>;
  }

  if (screen.kind === "lens") {
    const spec: QuerySpec = {
      version: 1,
      types: [screen.type],
      properties: [...COLUMNS],
      limit: LIST_LIMIT,
      ...(screen.lens === "board" ? { groupBy: screen.groupBy ?? "status" } : {}),
    };
    const result = await tryQuery(query, spec);
    const kind = messages.lensKinds[screen.lens];
    if (!result) {
      return <p className="text-[13.5px] text-muted">{fill(messages.screens.notYet, { type: screen.type, kind })}</p>;
    }
    if (screen.lens === "board" && result.groups) {
      return (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label={title}>
          {result.groups.map((group) => (
            <li key={group.key ?? "none"} className="rounded-(--radius-md) border border-line bg-surface-soft/60 p-3">
              <h3 className="mb-2 text-[13px] font-semibold text-ink">
                {group.key ? display({ kind: "status", value: group.key }, t, locale) : "—"}{" "}
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
        <RowsTable result={result} messages={messages} locale={locale} t={t} caption={title} />
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
        properties: [...COLUMNS],
        limit: widget.kind === "count" ? COUNT_LIMIT : TILE_LIST_LIMIT,
        ...(widget.filter ? { filter: { property: widget.filter.property, op: "eq" as const, value: widget.filter.value } } : {}),
      };
      return { widget, result: await tryQuery(query, spec) };
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
