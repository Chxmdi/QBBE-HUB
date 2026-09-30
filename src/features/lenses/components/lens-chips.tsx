import Link from "next/link";
import { lensHref, type SavedLens } from "@/features/lenses/services/lens-store.types";

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
