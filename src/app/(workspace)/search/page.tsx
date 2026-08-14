import type { Metadata } from "next";
import Link from "next/link";
import { SearchX } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { requireSession } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import type { SearchResult } from "@/types/entities";

export const metadata: Metadata = { title: "Search" };
export const dynamic = "force-dynamic";

const TYPE_LABELS: Record<string, string> = {
  task: "Tasks",
  project: "Projects",
  program: "Programs",
  channel: "Channels",
  message: "Messages",
  person: "People",
  meeting: "Meetings",
  event: "Events",
  crm: "Relationships",
};

/**
 * Dedicated search results view with type filters (§10.16, P1-SRC-03).
 * Results come from the permission-safe RPC, so nothing a user cannot
 * access can appear here.
 */
export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; type?: string }>;
}) {
  await requireSession();
  const params = await searchParams;
  const query = (params.q ?? "").trim();
  const typeFilter = params.type ?? "";

  let results: SearchResult[] = [];
  if (query.length >= 2) {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase.rpc("global_search", {
      p_query: query,
      p_limit: 60,
    });
    results = (data as SearchResult[] | null) ?? [];
  }

  const filtered = typeFilter
    ? results.filter((r) => r.result_type === typeFilter)
    : results;

  const availableTypes = Array.from(
    new Set(results.map((r) => r.result_type)),
  ).sort();

  const grouped = new Map<string, SearchResult[]>();
  for (const result of filtered) {
    const list = grouped.get(result.result_type) ?? [];
    list.push(result);
    grouped.set(result.result_type, list);
  }

  return (
    <div>
      <PageHeader
        eyebrow="Search"
        title={query ? `Results for “${query}”` : "Search"}
        description={
          query
            ? `${filtered.length} ${filtered.length === 1 ? "result" : "results"} you have access to.`
            : "Search across tasks, projects, channels, messages, people, meetings, events, and relationships."
        }
      />

      <form action="/search" className="mb-5 flex flex-wrap gap-2">
        <input
          type="search"
          name="q"
          defaultValue={query}
          placeholder="Search everything…"
          aria-label="Search query"
          className="h-9.5 w-full max-w-md rounded-(--radius-sm) border border-line bg-surface px-3 text-sm placeholder:text-muted/70 focus:border-brand focus:outline-none"
        />
        <button
          type="submit"
          className="h-9.5 rounded-(--radius-sm) bg-brand px-4 text-sm font-medium text-white hover:bg-brand-strong"
        >
          Search
        </button>
      </form>

      {/* Type filters */}
      {availableTypes.length > 1 ? (
        <nav aria-label="Filter by type" className="mb-5 flex flex-wrap gap-1.5">
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
            All ({results.length})
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
                {TYPE_LABELS[type] ?? type} ({count})
              </Link>
            );
          })}
        </nav>
      ) : null}

      {query.length < 2 ? (
        <EmptyState
          title="Type at least two characters"
          description="Search covers only records you're authorized to see — private channels and restricted records never appear for unauthorized viewers."
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<SearchX />}
          title={`No results for “${query}”`}
          description={
            typeFilter
              ? "Try removing the type filter, or check the spelling."
              : "Check the spelling, try a shorter phrase, or search for a person's name."
          }
          action={
            typeFilter ? (
              <Link
                href={`/search?q=${encodeURIComponent(query)}`}
                className="text-[13.5px] font-medium text-brand hover:underline"
              >
                Clear type filter
              </Link>
            ) : undefined
          }
        />
      ) : (
        <div className="max-w-3xl space-y-7">
          {Array.from(grouped.entries()).map(([type, items]) => (
            <section key={type} aria-labelledby={`results-${type}`}>
              <h2 id={`results-${type}`} className="section-heading mb-2">
                {TYPE_LABELS[type] ?? type}
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
                            {result.snippet}
                          </span>
                        ) : null}
                      </span>
                      {/* Result type is always communicated (§10.16) */}
                      <Badge tone="neutral">{TYPE_LABELS[type] ?? type}</Badge>
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
