import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPublicPagesT } from "@/features/public-pages/i18n";
import { fieldLabel, fieldValue, isValidSlug } from "@/features/public-pages/services/publication";
import { getPublishedPage } from "@/features/public-pages/services/publication.queries";
import { getFormatters, getLocale } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

async function load(params: Promise<{ slug: string }>) {
  const { slug } = await params;
  if (!isValidSlug(slug)) return null;
  return getPublishedPage(slug);
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const page = await load(params);
  if (!page) return { title: "QBBE" };
  return { title: (await getLocale()) === "fr-CA" ? page.title_fr : page.title_en };
}

/**
 * A public page (V1-18). Reads only the published copy (public.published_page)
 * as a signed-out visitor; nothing live is ever read here. Not found when the
 * address is unknown, unpublished, or public pages are switched off.
 */
export default async function PublicPage({ params }: { params: Promise<{ slug: string }> }) {
  const page = await load(params);
  if (!page) notFound();
  const [t, locale, format] = await Promise.all([getPublicPagesT(), getLocale(), getFormatters()]);

  return (
    <main className="mx-auto min-h-dvh max-w-2xl bg-canvas px-4 py-12">
      <p className="eyebrow mb-2">QBBE</p>
      <h1 className="page-title">{locale === "fr-CA" ? page.title_fr : page.title_en}</h1>
      <div className="qbbe-brand-rule mt-2 w-20" aria-hidden />
      <p className="mt-2 text-[13px] text-muted">{t("page.published", { date: format.date(page.published_at) })}</p>
      <dl className="mt-8 grid gap-5">
        {page.fields.map((field) => {
          const value = fieldValue(field, locale);
          return value ? (
            <div key={field.key}>
              <dt className="text-[13px] font-semibold uppercase tracking-wide text-muted">{fieldLabel(field, locale)}</dt>
              <dd className="mt-1 whitespace-pre-line text-[15px] leading-relaxed text-ink">{value}</dd>
            </div>
          ) : null;
        })}
      </dl>
      <p className="mt-12 border-t border-line pt-4 text-[12.5px] text-muted">{t("page.footer")}</p>
    </main>
  );
}
