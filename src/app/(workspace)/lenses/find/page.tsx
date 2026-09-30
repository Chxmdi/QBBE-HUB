import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { requireSession } from "@/lib/auth";
import { reportError } from "@/lib/observability";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireLensesEnabled } from "@/features/lenses/flag";
import { getLensT } from "@/features/lenses/i18n/server";
import { FIND_PAGE_SIZE, FIND_TYPES, findRecords, parseFindParams, type FindPage } from "@/features/lenses/find/find";
import { FindResults } from "@/features/lenses/find/find-results";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getLensT())("find.title") };
}
export const dynamic = "force-dynamic";

/**
 * Find (M12) behind wos_lenses: the new search page. A plain GET form, so it
 * works without JavaScript and every search is a shareable link.
 */
export default async function FindPageRoute({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireLensesEnabled();
  await requireSession();
  const t = await getLensT();
  const { query, type, space, page } = parseFindParams(await searchParams);
  const supabase = await createSupabaseServerClient();

  const { data: programs, error: programsError } = await supabase
    .from("program")
    .select("id, name")
    .is("archived_at", null)
    .order("name");
  if (programsError) reportError(programsError, { screen: "find", step: "programs" });

  let result: FindPage | null = null;
  let failed = false;
  if (query.length >= 2) {
    try {
      result = await findRecords(supabase, {
        query,
        types: type ? [type] : undefined,
        space: space ?? undefined,
        limit: FIND_PAGE_SIZE,
        offset: (page - 1) * FIND_PAGE_SIZE,
      });
    } catch (error) {
      reportError(error, { screen: "find" });
      failed = true;
    }
  }

  const pageHref = (n: number) => {
    const params = new URLSearchParams({ q: query, ...(type ? { type } : {}), ...(space ? { space } : {}), page: String(n) });
    return `/lenses/find?${params.toString()}`;
  };
  const pages = result ? Math.ceil(result.total / FIND_PAGE_SIZE) : 0;

  return (
    <div>
      <PageHeader title={t("find.title")} description={t("find.description")} />
      <form method="get" action="/lenses/find" role="search" className="mb-6 flex flex-wrap items-end gap-3">
        <div className="min-w-60 flex-1">
          <Label htmlFor="find-q">{t("find.query")}</Label>
          <Input id="find-q" name="q" type="search" defaultValue={query} maxLength={200} />
        </div>
        <div>
          <Label htmlFor="find-type">{t("find.type")}</Label>
          <Select id="find-type" name="type" defaultValue={type ?? ""}>
            <option value="">{t("find.anyType")}</option>
            {FIND_TYPES.map((k) => (
              <option key={k} value={k}>
                {t(`find.types.${k}`)}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="find-space">{t("find.space")}</Label>
          <Select id="find-space" name="space" defaultValue={space ?? ""}>
            <option value="">{t("find.anySpace")}</option>
            {(programs ?? []).map((p) => (
              <option key={p.id as string} value={p.id as string}>
                {p.name as string}
              </option>
            ))}
          </Select>
        </div>
        <Button type="submit">{t("find.submit")}</Button>
      </form>

      <div aria-live="polite">
        {query && query.length < 2 ? <p className="text-[13.5px] text-muted">{t("find.tooShort")}</p> : null}
        {failed ? (
          <p role="alert" className="text-[13.5px] text-danger-fg">
            {t("find.failed")}
          </p>
        ) : null}
        {result ? (
          <>
            <p className="mb-2 text-[13px] text-muted">
              {result.total === 1 ? t("find.countOne") : t("find.count", { count: result.total })}
            </p>
            {result.results.length ? (
              <FindResults results={result.results} t={t} />
            ) : (
              <p className="card px-4 py-6 text-center text-[13.5px] text-muted">{t("find.none", { query })}</p>
            )}
            {pages > 1 ? (
              <nav aria-label={t("find.results")} className="mt-4 flex gap-3 text-[13px] font-medium">
                {page > 1 ? <Link className="text-brand-fg hover:underline" href={pageHref(page - 1)}>{t("find.previous")}</Link> : null}
                {page < pages ? <Link className="text-brand-fg hover:underline" href={pageHref(page + 1)}>{t("find.next")}</Link> : null}
              </nav>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
