import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { SearchX } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { requireSession } from "@/lib/auth";
import { createSupabasePageClient } from "@/lib/supabase/page";
import { cn } from "@/lib/utils";
import {
  searchTypeLabel,
  searchTypeOrder,
} from "@/features/search/result-types";
import type { SearchResult } from "@/types/entities";
import { resolveCommentPath } from "@/features/comments/comment-links";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("shell.search.title") };
}
export const dynamic = "force-dynamic";

/**
 * Dedicated search results view with type filters (§10.16, P1-SRC-03).
 * Results come from the permission-safe RPC, so nothing a user cannot
 * access can appear here.
 */
export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; type?: string; comment?: string }>;
}) {
  await requireSession();
  const t = await getT();
  const params = await searchParams;

  // Mention emails link to `?comment=<id>`: open the record the comment is on.
  // A comment the reader cannot see falls through to the ordinary page.
  if (params.comment && /^[0-9a-f-]{36}$/i.test(params.comment)) {
    const path = await resolveCommentPath(await createSupabasePageClient(), params.comment);
    if (path) redirect(path);
  }
  const query = (params.q ?? "").trim();
  const typeFilter = params.type ?? "";

  let results: SearchResult[] = [];
  if (query.length >= 2) {
    const supabase = await createSupabasePageClient();
    const { data } = await supabase.rpc("global_search", {
      p_query: query,
      p_limit: 60,
    });
    results = (data as SearchResult[] | null) ?? [];
  }

  const filtered = typeFilter
    ? results.filter((r) => r.result_type === typeFilter)
    : results;

  // Sorted by the shared priority rather than alphabetically, so the chips
  // and the headings below tell the same story in the same order.
  const availableTypes = Array.from(
    new Set(results.map((r) => r.result_type)),
  ).sort((a, b) => searchTypeOrder(a) - searchTypeOrder(b));

  const grouped = new Map<string, SearchResult[]>();
  for (const result of filtered) {
    const list = grouped.get(result.result_type) ?? [];
    list.push(result);
    grouped.set(result.result_type, list);
  }

  return (
    <div>
      <PageHeader
        eyebrow={t("shell.search.title")}
        title={query ? t("shell.search.resultsFor", { query }) : t("shell.search.title")}
        description={
          query
            ? t(filtered.length === 1 ? "shell.search.resultOne" : "shell.search.resultOther", {
                count: filtered.length,
              })
            : t("shell.search.intro")
        }
      />

      <form action="/search" className="mb-5 flex flex-wrap gap-2">
        <input
          type="search"
          name="q"
          defaultValue={query}
          placeholder={t("shell.search.placeholder")}
          aria-label={t("shell.search.queryLabel")}
          className="h-9.5 w-full max-w-md rounded-(--radius-sm) border border-line bg-surface px-3 text-sm placeholder:text-muted/70 focus:border-brand"
        />
        <button
          type="submit"
          className="h-9.5 rounded-(--radius-sm) bg-brand px-4 text-sm font-medium text-white hover:bg-brand-strong"
        >
          {t("shell.search.submit")}
        </button>
      </form>

      {/* Type filters */}
      {availableTypes.length > 1 ? (
        <nav aria-label={t("shell.search.filterByType")} className="mb-5 flex flex-wrap gap-1.5">
          <Link
            href={`/search?q=${encodeURIComponent(query)}`}
            aria-current={!typeFilter ? "page" : undefined}
            className={cn(
              "rounded-full border px-3 py-1 text-[13px] font-medium transition-colors",
              !typeFilter
                ? "border-brand bg-brand text-white"
                : "border-line bg-surface text-muted hover:text-ink",
            )}
          >
            {t("shell.search.all", { count: results.length })}
          </Link>
          {availableTypes.map((type) => {
            const count = results.filter((r) => r.result_type === type).length;
            return (
              <Link
                key={type}
                href={`/search?q=${encodeURIComponent(query)}&type=${type}`}
                aria-current={typeFilter === type ? "page" : undefined}
                className={cn(
                  "rounded-full border px-3 py-1 text-[13px] font-medium transition-colors",
                  typeFilter === type
                    ? "border-brand bg-brand text-white"
                    : "border-line bg-surface text-muted hover:text-ink",
                )}
              >
                {searchTypeLabel(type, "plural", t)} ({count})
              </Link>
            );
          })}
        </nav>
      ) : null}

      {query.length < 2 ? (
        <EmptyState
          title={t("shell.search.tooShortTitle")}
          description={t("shell.search.tooShortBody")}
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<SearchX />}
          title={t("shell.search.noResultsTitle", { query })}
          description={
            typeFilter
              ? t("shell.search.noResultsFiltered")
              : t("shell.search.noResultsBody")
          }
          action={
            typeFilter ? (
              <Link
                href={`/search?q=${encodeURIComponent(query)}`}
                className="text-[13.5px] font-medium text-brand-fg hover:underline"
              >
                {t("shell.search.clearFilter")}
              </Link>
            ) : undefined
          }
        />
      ) : (
        <div className="max-w-3xl space-y-7">
          {Array.from(grouped.entries()).map(([type, items]) => (
            <section key={type} aria-labelledby={`results-${type}`}>
              <h2 id={`results-${type}`} className="section-heading mb-2">
                {searchTypeLabel(type, "plural", t)}
                <span className="meta ml-2 font-normal">{items.length}</span>
              </h2>
              <ul className="card divide-y divide-line">
                {items.map((result) => (
                  <li key={`${result.result_type}-${result.id}`}>
                    <Link
                      href={result.href}
                      className="interactive-row flex items-center gap-3 px-4 py-2.5"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13.5px] font-medium">
                          {result.title}
                        </span>
                        {result.snippet ? (
                          <span className="meta block truncate">
                            {/* The search function labels message hits with a fixed English
                                phrase; every other snippet is the record's own text. */}
                            {result.snippet === "in conversation"
                              ? t("shell.search.inConversation")
                              : result.snippet}
                          </span>
                        ) : null}
                      </span>
                      {/* Result type is always communicated (§10.16) */}
                      <Badge tone="neutral">{searchTypeLabel(type, "singular", t)}</Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
