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
  MONTHS,
  describePeriod,
  describeRetainUntil,
} from "@/features/record-retention/schemas";
import { getRecordRetentionOverview } from "@/features/record-retention/services/record-retention.queries";
import { requireAdminAal2 } from "@/lib/auth";
import { formatDateTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Records & holds" };
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
  const { categories, rules, fiscalYearEnd, holds, register, documents, latestReport } =
    overview;

  const categoryLabel = (key: string | null) =>
    categories.find((category) => category.key === key)?.label ?? "Not classified";
  const documentTitle = (id: string | null) =>
    documents.find((document) => document.id === id)?.title ??
    register.find((row) => row.record_id === id)?.title ??
    "A document";
  const pastRetention = register.filter((row) => row.past_retention && !row.held);

  return (
    <div>
      <AdminNav />
      <PageHeader
        eyebrow="Administration"
        title="Records & holds"
        description="How long each kind of business record is kept, and legal holds that stop deletion. Classified records cannot be deleted before their retention date or while held — by anyone."
      />

      <section aria-labelledby="records-year-end" className="mb-8">
        <h2 id="records-year-end" className="section-heading mb-2">
          Fiscal year end
        </h2>
        <p className="meta mb-3 max-w-2xl">
          {fiscalYearEnd
            ? `Financial records are counted from ${MONTHS[fiscalYearEnd.month - 1]} ${fiscalYearEnd.day}.`
            : "Not set. Until it is, the Hub counts from one year after each record's date, which can only keep records longer."}
        </p>
        <div className="card px-4 py-3">
          <FiscalYearEndForm current={fiscalYearEnd} />
        </div>
      </section>

      <section aria-labelledby="records-rules" className="mb-8">
        <h2 id="records-rules" className="section-heading mb-3">
          Retention rules
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
                  <Badge tone="neutral">{describePeriod(category, years)}</Badge>
                  {rule?.confirmed_at ? (
                    <Badge tone="success">Confirmed by the {category.confirm_with}</Badge>
                  ) : (
                    <Badge tone="warning">Needs {category.confirm_with} confirmation</Badge>
                  )}
                </div>
                <p className="meta mt-0.5">{category.description}</p>
                <p className="mt-1 text-[13px] text-muted">{category.legal_reference}</p>
                {rule?.confirmation_note ? (
                  <p className="meta mt-1">Note: {rule.confirmation_note}</p>
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
          Legal holds
        </h2>
        {holds.length === 0 ? (
          <p className="card mb-3 px-4 py-4 text-[13px] text-muted">No active holds.</p>
        ) : (
          <ul className="card mb-3 divide-y divide-line">
            {holds.map((hold) => (
              <li key={hold.id} className="px-4 py-3 text-[13px]">
                <div className="flex flex-wrap items-center gap-2">
                  <Lock className="size-4 shrink-0" aria-hidden />
                  <span className="font-medium">
                    {hold.scope === "category"
                      ? `All ${categoryLabel(hold.category_key).toLowerCase()}`
                      : documentTitle(hold.record_id)}
                  </span>
                  <span className="meta ml-auto">Placed {formatDateTime(hold.placed_at)}</span>
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
          Classify a document
        </h2>
        <p className="meta mb-3 max-w-2xl">
          The record date is the date the record relates to — the purchase, the
          statement, or the day a contract ended. Left blank, the date the
          document was added is used. A classification cannot be changed in a
          way that shortens how long a record must be kept.
        </p>
        <div className="card px-4 py-3">
          <ClassifyDocumentForm categories={categories} documents={documents} />
        </div>
      </section>

      <section aria-labelledby="records-register" className="mb-8">
        <h2 id="records-register" className="section-heading mb-2">
          Records register
        </h2>
        <p className="meta mb-3 max-w-2xl">
          {latestReport
            ? `Last nightly check ${formatDateTime(latestReport.generated_at)}: ${latestReport.past_retention_count} past retention, ${latestReport.held_count} held.`
            : "The nightly check has not run yet."}{" "}
          {pastRetention.length > 0
            ? `${pastRetention.length} record${pastRetention.length === 1 ? " has" : "s have"} reached the end of retention and may now be disposed of. Nothing is deleted automatically.`
            : "No record has reached the end of its retention period."}
        </p>
        {register.length === 0 ? (
          <p className="card px-4 py-4 text-[13px] text-muted">
            No document is classified or held yet.
          </p>
        ) : (
          <ul className="card divide-y divide-line">
            {register.map((row) => (
              <li key={`${row.record_type}-${row.record_id}`} className="px-4 py-2.5 text-[13px]">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 flex-1 font-medium">{row.title}</span>
                  {row.held ? <Badge tone="danger">On hold</Badge> : null}
                  {row.past_retention && !row.held ? (
                    <Badge tone="warning">Past retention</Badge>
                  ) : null}
                </div>
                <p className="meta">
                  {categoryLabel(row.category_key)} · dated {row.record_date} · keep until{" "}
                  {describeRetainUntil(row.retain_until)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
