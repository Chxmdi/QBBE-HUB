import type { Metadata } from "next";
import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { getLocale, getT } from "@/lib/i18n/server";
import { createSupabasePageClient } from "@/lib/supabase/page";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { searchTypeLabel } from "@/features/search/result-types";
import { mobileT } from "@/features/mobile/i18n";
import type { SearchResult } from "@/types/entities";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return { title: mobileT(await getLocale())("search.title") };
}

export default async function PhoneSearch({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requireSession();
  const [locale, shellT] = await Promise.all([getLocale(), getT()]);
  const t = mobileT(locale);
  const query = ((await searchParams).q ?? "").trim().slice(0, 200);
  let results: SearchResult[] = [];
  if (query.length >= 2) {
    // A failed search reaches the error page instead of reading as "no results".
    const supabase = await createSupabasePageClient();
    const { data } = await supabase.rpc("global_search", { p_query: query, p_limit: 30 }).throwOnError();
    results = (data as SearchResult[] | null) ?? [];
  }
  return (
    <div className="space-y-4">
      <h1 className="page-title">{t("search.title")}</h1>
      <form role="search" action="/m/search" className="flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <Label htmlFor="m-search">{t("search.label")}</Label>
          <Input id="m-search" name="q" type="search" defaultValue={query} className="h-12 text-base" />
        </div>
        <Button type="submit" className="h-12">{t("search.submit")}</Button>
      </form>
      {query.length > 0 && query.length < 2 ? <p className="text-sm text-muted">{t("search.hint")}</p> : null}
      {query.length >= 2 && results.length === 0 ? <p className="text-sm text-muted">{t("search.empty", { query })}</p> : null}
      <ul className="space-y-2">
        {results.map((r) => (
          <li key={`${r.result_type}:${r.id}`}>
            <Link href={r.href} className="card block min-h-12 p-3 text-sm">
              <span className="block break-words text-ink">{r.title}</span>
              <span className="text-[12.5px] text-muted">{searchTypeLabel(r.result_type, "singular", shellT)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
