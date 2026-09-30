import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import type { LensT } from "@/features/lenses/i18n";
import type { FindResult } from "./find";

/** Search results as a list of links, each with its type. Shared by /search and the Find page. */
export function FindResults({ results, t }: { results: FindResult[]; t: LensT }) {
  return (
    <ol className="card divide-y divide-line" aria-label={t("find.results")}>
      {results.map((r) => (
        <li key={`${r.type}:${r.id}`} data-find-result={r.type} className="flex flex-wrap items-start gap-x-3 gap-y-1 px-4 py-3">
          <div className="min-w-0 flex-1 basis-64">
            <Link href={r.href} className="text-[14px] font-semibold text-ink hover:text-brand-fg">
              {r.title}
            </Link>
            {r.snippet ? <p className="meta mt-0.5 line-clamp-2">{r.snippet}</p> : null}
          </div>
          <Badge tone="neutral">{t(`find.types.${r.type}`)}</Badge>
        </li>
      ))}
    </ol>
  );
}
