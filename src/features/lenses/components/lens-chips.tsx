"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import type { CatalogType } from "@/lib/query/catalog";
import type { LensGroup } from "@/lib/query/spec";
import { lensHref, type SavedLens } from "@/features/lenses/services/lens-store.types";
import { useLensT } from "@/features/lenses/i18n/client";
import { summaryLabels } from "@/features/lenses/filters/filter-builder";
import { summarise } from "@/features/lenses/filters/filter-model";

/** Saved lenses for one screen, as links (converted saved views included). */
export function LensChips({ lenses, label }: { lenses: SavedLens[]; label: string }) {
  if (!lenses.length) return null;
  return (
    <nav aria-label={label} className="mb-4 flex flex-wrap gap-2">
      {lenses.map((lens) => (
        <Link
          key={lens.id}
          href={lensHref(lens)}
          className="rounded-full border border-line bg-surface px-3 py-1 text-[12.5px] font-medium text-ink hover:border-brand/40 hover:text-brand-fg"
        >
          {lens.name}
        </Link>
      ))}
    </nav>
  );
}

/**
 * The active filters of a lens in words, one chip per top-level item. A
 * nested group reads as one chip in brackets, so an OR inside an AND is
 * visible without opening the builder.
 */
export function WhereChips({
  where,
  type,
  locale,
  people = [],
  className,
}: {
  where: LensGroup | null | undefined;
  type: CatalogType;
  locale: string;
  people?: { id: string; label: string }[];
  className?: string;
}) {
  const t = useLensT();
  if (!where) return null;
  const lines = summarise(where, type, locale, summaryLabels(t), people);
  if (lines.length === 0) return null;
  const join = "and" in where ? t("filters.and") : t("filters.or");
  return (
    <ul aria-label={t("filters.summary")} className={cn("flex flex-wrap items-center gap-1.5 text-[12.5px]", className)}>
      {lines.map((line, index) => (
        <li key={`${index}:${line}`} className="flex items-center gap-1.5">
          {index > 0 ? <span className="text-muted">{join}</span> : null}
          <span className="rounded-full border border-brand/30 bg-brand/5 px-2.5 py-0.5 font-medium text-ink">{line}</span>
        </li>
      ))}
    </ul>
  );
}
