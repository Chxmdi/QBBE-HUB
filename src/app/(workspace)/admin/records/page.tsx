import type { Metadata } from "next";
import { Lock } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { AdminNav } from "@/features/admin/components/admin-nav";
import {
  ClassifyDocumentForm,
  FiscalYearEndForm,
  PlaceHoldForm,
  ReleaseHoldForm,
  RuleEditor,
} from "@/features/record-retention/components/record-retention-forms";
import {
  confirmerLabel,
  describePeriod,
  describeRetainUntil,
  localizeCategory,
  monthName,
} from "@/features/record-retention/schemas";
import { getRecordRetentionOverview } from "@/features/record-retention/services/record-retention.queries";
import { requireAdminAal2 } from "@/lib/auth";
import { getFormatters, getLocale, getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("records.title") };
}
export const dynamic = "force-dynamic";

/**
 * Admin → Records & holds (#146).
 *
 * How long each kind of business record must be kept, which records are
 * under legal hold, and which have reached the end of their retention period.
 * The database enforces all of it; this page only shows it and changes it.
 * Nothing here deletes a record.
 */
export default async function AdminRecordsPage() {
  const session = await requireAdminAal2();
  const overview = await getRecordRetentionOverview(session.organizationId);
  const { rules, fiscalYearEnd, holds, register, documents, latestReport } = overview;
  const t = await getT();
  const format = await getFormatters();
  const locale = await getLocale();
  // Seeded category text in the reader's language; the forms get it too.
  const categories = overview.categories.map((category) => localizeCategory(category, t));
  // A stored YYYY-MM-DD date. English shows it as stored; French reads "28 sept. 2026".
  const calendarDate = (isoDate: string) =>
    locale === "en" ? isoDate : format.date(`${isoDate.slice(0, 10)}T12:00:00Z`, "UTC");

  const categoryLabel = (key: string | null) =>
    categories.find((category) => category.key === key)?.label ?? t("records.notClassified");
  const documentTitle = (id: string | null) =>
    documents.find((document) => document.id === id)?.title ??
    register.find((row) => row.record_id === id)?.title ??
    t("records.aDocument");
  const pastRetention = register.filter((row) => row.past_retention && !row.held);

  return (
    <div>
      <AdminNav />
      <PageHeader
        eyebrow={t("records.eyebrow")}
        title={t("records.title")}
        description={t("records.description")}
      />

      <section aria-labelledby="records-year-end" className="mb-8">
        <h2 id="records-year-end" className="section-heading mb-2">
          {t("records.yearEndHeading")}
        </h2>
        <p className="meta mb-3 max-w-2xl">
          {fiscalYearEnd
            ? t("records.yearEndSet", {
                month: monthName(fiscalYearEnd.month, t),
                day: fiscalYearEnd.day,
              })
            : t("records.yearEndUnset")}
        </p>
        <div className="card px-4 py-3">
          <FiscalYearEndForm current={fiscalYearEnd} />
        </div>
      </section>

      <section aria-labelledby="records-rules" className="mb-8">
        <h2 id="records-rules" className="section-heading mb-3">
          {t("records.rulesHeading")}
        </h2>
        <ul className="space-y-3">
          {categories.map((category) => {
            const rule = rules.find((row) => row.category_key === category.key) ?? null;
            const years = rule?.retain_years ?? category.default_years;
            return (
              <li key={category.key} className="card px-4 py-3">
                <div className="flex flex-wrap items-start gap-2">
                  <span className="min-w-0 flex-1 text-[13.5px] font-medium">
                    {category.label}
                  </span>
                  <Badge tone="neutral">{describePeriod(category, years, t)}</Badge>
                  {rule?.confirmed_at ? (
                    <Badge tone="success">
                      {t("records.confirmedBy", { who: confirmerLabel(category.confirm_with, t) })}
                    </Badge>
                  ) : (
                    <Badge tone="warning">
                      {t("records.needsConfirmation", {
                        who: confirmerLabel(category.confirm_with, t),
                      })}
                    </Badge>
                  )}
                </div>
                <p className="meta mt-0.5">{category.description}</p>
                <p className="mt-1 text-[13px] text-muted">{category.legal_reference}</p>
                {rule?.confirmation_note ? (
                  <p className="meta mt-1">
                    {t("records.note", { note: rule.confirmation_note })}
                  </p>
                ) : null}
                <div className="mt-2">
                  <RuleEditor category={category} rule={rule} />
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-labelledby="records-holds" className="mb-8">
        <h2 id="records-holds" className="section-heading mb-3">
          {t("records.holdsHeading")}
        </h2>
        {holds.length === 0 ? (
          <p className="card mb-3 px-4 py-4 text-[13px] text-muted">{t("records.noHolds")}</p>
        ) : (
          <ul className="card mb-3 divide-y divide-line">
            {holds.map((hold) => (
              <li key={hold.id} className="px-4 py-3 text-[13px]">
                <div className="flex flex-wrap items-center gap-2">
                  <Lock className="size-4 shrink-0" aria-hidden />
                  <span className="font-medium">
                    {hold.scope === "category"
                      ? t("records.wholeCategory", {
                          category:
                            locale === "en"
                              ? categoryLabel(hold.category_key).toLowerCase()
                              : categoryLabel(hold.category_key),
                        })
                      : documentTitle(hold.record_id)}
                  </span>
                  <span className="meta ml-auto">
                    {t("records.placed", { when: format.dateTime(hold.placed_at) })}
                  </span>
                </div>
                <p className="meta mt-0.5">{hold.reason}</p>
                <div className="mt-2">
                  <ReleaseHoldForm hold={hold} />
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="card px-4 py-3">
          <PlaceHoldForm categories={categories} documents={documents} />
        </div>
      </section>

      <section aria-labelledby="records-classify" className="mb-8">
        <h2 id="records-classify" className="section-heading mb-2">
          {t("records.classifyHeading")}
        </h2>
        <p className="meta mb-3 max-w-2xl">
          {t("records.classifyHelp")}
        </p>
        <div className="card px-4 py-3">
          <ClassifyDocumentForm categories={categories} documents={documents} />
        </div>
      </section>

      <section aria-labelledby="records-register" className="mb-8">
        <h2 id="records-register" className="section-heading mb-2">
          {t("records.registerHeading")}
        </h2>
        <p className="meta mb-3 max-w-2xl">
          {latestReport
            ? t("records.lastCheck", {
                when: format.dateTime(latestReport.generated_at),
                past: format.number(latestReport.past_retention_count),
                held: format.number(latestReport.held_count),
              })
            : t("records.notRunYet")}{" "}
          {pastRetention.length > 0
            ? t(pastRetention.length === 1 ? "records.pastOne" : "records.pastOther", {
                count: format.number(pastRetention.length),
              })
            : t("records.nonePast")}
        </p>
        {register.length === 0 ? (
          <p className="card px-4 py-4 text-[13px] text-muted">
            {t("records.registerEmpty")}
          </p>
        ) : (
          <ul className="card divide-y divide-line">
            {register.map((row) => (
              <li key={`${row.record_type}-${row.record_id}`} className="px-4 py-2.5 text-[13px]">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 flex-1 font-medium">{row.title}</span>
                  {row.held ? <Badge tone="danger">{t("records.onHold")}</Badge> : null}
                  {row.past_retention && !row.held ? (
                    <Badge tone="warning">{t("records.pastRetention")}</Badge>
                  ) : null}
                </div>
                <p className="meta">
                  {t("records.registerMeta", {
                    category: categoryLabel(row.category_key),
                    date: calendarDate(row.record_date),
                    until: describeRetainUntil(row.retain_until, t, calendarDate),
                  })}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
