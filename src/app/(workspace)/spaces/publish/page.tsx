import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { AskToPublishForm, ReviewForm, UnpublishButton } from "@/features/public-pages/components/publish-forms";
import { getPublicPagesT } from "@/features/public-pages/i18n";
import { fieldLabel, fieldValue } from "@/features/public-pages/services/publication";
import {
  listPublications,
  listPublishSources,
  publicationCandidates,
} from "@/features/public-pages/services/publication.queries";
import { NO_ACCESS_REDIRECT, requireSession } from "@/lib/auth";
import { isEnabled } from "@/lib/feature-flags";
import { getFormatters, getLocale } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getPublicPagesT())("metaTitle") };
}

/** Public pages (V1-18): ask, review, publish and unpublish. Owners and admins; behind `wos_public_pages`. */
export default async function PublishPage({ searchParams }: { searchParams: Promise<{ source?: string }> }) {
  const session = await requireSession();
  if (!(await isEnabled("wos_public_pages"))) notFound();
  if (!session.isAdmin) redirect(NO_ACCESS_REDIRECT);

  const { source } = await searchParams;
  const sourceId = z.string().uuid().safeParse(source).success ? source! : null;
  const [t, locale, format, sources, publications] = await Promise.all([
    getPublicPagesT(),
    getLocale(),
    getFormatters(),
    listPublishSources(await getLocale()),
    listPublications(),
  ]);
  const candidates = sourceId ? await publicationCandidates(sourceId) : null;
  const sourceLabel = sources.find((s) => s.id === sourceId)?.label ?? "";
  const waiting = publications.filter((p) => p.status === "in_review");
  const live = publications.filter((p) => p.status === "published");
  const earlier = publications.filter((p) => p.status === "rejected" || p.status === "unpublished");

  return (
    <div className="max-w-3xl">
      <PageHeader title={t("title")} description={t("description")} />

      <section aria-labelledby="publish-ask" className="card mb-8 grid gap-4 p-4">
        <h2 id="publish-ask" className="text-[15px] font-semibold text-ink">
          {t("ask.heading")}
        </h2>
        <form method="get" className="flex flex-wrap items-end gap-2">
          <div className="grid gap-1">
            <label htmlFor="publish-source" className="text-[13px] font-medium text-ink">
              {t("ask.source")}
            </label>
            <Select id="publish-source" name="source" defaultValue={sourceId ?? ""} required className="min-w-64">
              <option value="">{t("ask.none")}</option>
              {sources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </Select>
          </div>
          <Button type="submit" variant="secondary">
            {t("ask.choose")}
          </Button>
        </form>
        {sourceId && candidates ? (
          <AskToPublishForm key={sourceId} sourceId={sourceId} sourceLabel={sourceLabel} candidates={candidates} />
        ) : sourceId ? (
          <p role="alert" className="text-[13px] text-danger-fg">
            {t("errors.forbidden")}
          </p>
        ) : null}
      </section>

      <section aria-labelledby="publish-review" className="mb-8">
        <h2 id="publish-review" className="mb-3 text-[15px] font-semibold text-ink">
          {t("review.heading")}
        </h2>
        {waiting.length === 0 ? (
          <p className="text-sm text-muted">{t("review.empty")}</p>
        ) : (
          <ul className="grid gap-3">
            {waiting.map((p) => (
              <li key={p.id} className="card grid gap-3 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-[14.5px] font-semibold text-ink">/p/{p.slug}</h3>
                  <span className="text-[13px] text-muted">{t("review.askedBy", { name: p.requesterName ?? "—" })}</span>
                </div>
                {p.preview ? (
                  <div className="rounded-(--radius-sm) border border-line p-3">
                    <p className="eyebrow mb-1">{t("review.preview")}</p>
                    <p className="text-[14px] font-semibold text-ink">
                      {locale === "fr-CA" ? p.preview.title_fr : p.preview.title_en}
                    </p>
                    <dl className="mt-1 grid gap-1 text-[13px]">
                      {p.preview.fields.map((field) => (
                        <div key={field.key}>
                          <dt className="inline font-medium text-ink">{fieldLabel(field, locale)}{locale === "fr-CA" ? " : " : ": "}</dt>
                          <dd className="inline text-muted">{fieldValue(field, locale) ?? t("ask.empty")}</dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                ) : null}
                <ReviewForm publicationId={p.id} mine={p.requested_by === session.userId} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="publish-live" className="mb-8">
        <h2 id="publish-live" className="mb-3 text-[15px] font-semibold text-ink">
          {t("live.heading")}
        </h2>
        {live.length === 0 ? (
          <p className="text-sm text-muted">{t("live.empty")}</p>
        ) : (
          <ul className="grid gap-2">
            {live.map((p) => (
              <li key={p.id} className="card flex flex-wrap items-center gap-3 p-3">
                <Badge tone="success">{t("publicBadge")}</Badge>
                <Link href={`/p/${p.slug}`} className="text-[14px] font-medium text-brand-fg underline underline-offset-2">
                  /p/{p.slug}
                </Link>
                <UnpublishButton publicationId={p.id} label={`${t("live.unpublish")} — /p/${p.slug}`} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {earlier.length > 0 ? (
        <section aria-labelledby="publish-earlier">
          <h2 id="publish-earlier" className="mb-3 text-[15px] font-semibold text-ink">
            {t("history.heading")}
          </h2>
          <ul className="grid gap-1 text-[13px] text-muted">
            {earlier.map((p) => (
              <li key={p.id}>
                /p/{p.slug} — {p.status === "rejected" ? t("history.rejected") : t("history.unpublished")} ·{" "}
                {format.date(p.unpublished_at ?? p.reviewed_at ?? p.requested_at)}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
