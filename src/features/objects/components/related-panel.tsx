import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import type { ObjectsT } from "@/features/objects/i18n/translate";
import type { RelatedPanelData } from "@/features/objects/services/related";

/**
 * "Related" panel (M3b): every link to and from an object, grouped by
 * relation and direction. Plain links and lists, so it works with a
 * keyboard and a screen reader without any script.
 */
export function RelatedPanel({
  data,
  typeLabel,
  typeName,
  t,
}: {
  data: RelatedPanelData;
  typeLabel: (typeKey: string) => string;
  typeName: string;
  t: ObjectsT;
}) {
  return (
    <section
      aria-labelledby="related-heading"
      className="rounded-(--radius-md) border border-line bg-surface p-4"
    >
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="related-heading" className="text-title font-semibold text-ink">
          {t("related.title")}
        </h2>
        <p className="text-body-sm text-muted">{t("related.count", { count: data.total })}</p>
      </div>
      <p className="mb-4 text-body-sm text-muted">{t("related.description", { type: typeName })}</p>

      {data.groups.length === 0 ? (
        <EmptyState title={t("related.empty")} description={t("related.emptyDescription")} />
      ) : (
        <div className="flex flex-col gap-5">
          {data.groups.map((group) => (
            <section key={group.key} aria-labelledby={`related-${group.key}`} data-testid={`related-${group.key}`}>
              <h3 id={`related-${group.key}`} className="mb-2 text-body-sm font-semibold text-ink">
                {group.label} <span className="font-normal text-muted">({group.items.length})</span>
              </h3>
              <ul className="flex flex-col divide-y divide-line rounded-(--radius-sm) border border-line">
                {group.items.map((item) => (
                  <li key={item.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                    <Badge>{typeLabel(item.type)}</Badge>
                    <Link
                      href={`/objects/${item.id}`}
                      aria-label={t("related.open", { title: item.title })}
                      className="min-w-0 flex-1 truncate text-body-sm font-medium text-ink underline-offset-2 hover:underline focus-visible:underline"
                    >
                      {item.title}
                    </Link>
                    {item.archived ? <Badge tone="warning">{t("page.archived")}</Badge> : null}
                    <span className="sr-only">
                      {item.stored ? t("related.source.stored") : t("related.source.native")}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {data.hidden > 0 ? <p className="mt-4 text-body-sm text-muted">{t("related.hidden")}</p> : null}
    </section>
  );
}
