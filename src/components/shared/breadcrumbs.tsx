import Link from "next/link";

export interface Crumb {
  label: string;
  href?: string;
}

/**
 * Where this record sits (P0-UX-01). Used only on nested pages where the
 * trail adds orientation (spec §5.2). The last crumb is the current page and
 * is not a link.
 */
export function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-2">
      <ol className="flex flex-wrap items-center gap-1 text-[12.5px] text-muted">
        {items.map((item, index) => {
          const last = index === items.length - 1;
          return (
            <li key={`${item.label}-${index}`} className="flex min-w-0 items-center gap-1">
              {item.href && !last ? (
                <Link href={item.href} className="truncate hover:text-brand-fg hover:underline">
                  {item.label}
                </Link>
              ) : (
                <span aria-current={last ? "page" : undefined} className="truncate text-ink">
                  {item.label}
                </span>
              )}
              {!last ? (
                <span aria-hidden className="text-muted/70">
                  ›
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
