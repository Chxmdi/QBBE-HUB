import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { requireSession } from "@/lib/auth";
import { getLocale } from "@/lib/i18n/server";
import { reportError } from "@/lib/observability";
import { OPEN_STATUSES } from "@/features/tasks/filters";
import { requireLensesEnabled } from "@/features/lenses/flag";
import { getLensT } from "@/features/lenses/i18n/server";
import { loadViewLens, type ViewLens } from "@/features/lenses/cards/load";
import { recordHref } from "@/features/lenses/cards/cards";
import { RecordFacts } from "@/features/lenses/cards/record-facts";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getLensT())("gallery.title") };
}
export const dynamic = "force-dynamic";

const CARDS = 60;

/** The gallery lens (V1-3), behind wos_lenses: `?lens=<id>` or `?type=task|project`. */
export default async function GalleryLensPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireLensesEnabled();
  const session = await requireSession();
  const [t, locale] = await Promise.all([getLensT(), getLocale()]);
  const params = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

  let view: ViewLens | null = null;
  try {
    view = await loadViewLens({
      viewerId: session.userId,
      timeZone: session.timeZone,
      lensId: one(params.lens),
      type: one(params.type),
      order: "lens",
      limit: CARDS,
      defaultWhere: { and: [{ property: "status", operator: "is_any_of", value: [...OPEN_STATUSES] }] },
    });
  } catch (error) {
    reportError(error, { lens: "gallery" });
  }
  const typeName = view ? t(`types.${view.type}` as "types.task") : t("gallery.type");

  return (
    <div>
      <PageHeader eyebrow={view?.lens?.name ?? typeName} title={t("gallery.title")} description={t("gallery.description")} />
      {!view ? (
        <p role="alert" className="text-[13.5px] text-danger-fg">{t("common.loadFailed")}</p>
      ) : view.result.rows.length === 0 ? (
        <p className="card px-4 py-6 text-center text-[13px] text-muted">{t("common.empty")}</p>
      ) : (
        <>
          <ul aria-label={t("gallery.cards", { type: typeName })} className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {view.result.rows.map((row) => (
              <li key={row.id} data-card={row.id} className="card flex flex-col gap-3 p-4">
                <Link href={recordHref(view.type, row.id)} className="text-[14.5px] font-semibold leading-snug text-ink hover:text-brand-fg">
                  {row.title}
                </Link>
                <RecordFacts row={row} facts={view.facts} locale={locale} timeZone={session.timeZone} />
              </li>
            ))}
          </ul>
          {view.result.total > view.result.rows.length ? (
            <p className="mt-3 text-[13px] text-muted">
              {t("block.more", { count: view.result.total - view.result.rows.length })}{" "}
              <Link className="font-medium text-brand-fg hover:underline" href={view.lens ? `/lenses/table?lens=${view.lens.id}` : `/lenses/table?type=${view.type}`}>
                {t("block.openFull")}
              </Link>
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
