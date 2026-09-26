import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { NoLedgerAccess } from "@/features/ledger/components/no-ledger-access";
import { getLedgerAccess, todayIn } from "@/features/ledger/services/ledger.access";
import { letterBodyHtml, renderAnnualStatement, type AckLanguage } from "@/features/gifts/acknowledgement";
import { AcknowledgeForm } from "@/features/gifts/components/gift-actions";
import { GiftTabs } from "@/features/gifts/components/gift-tabs";
import { NotAReceiptNotice } from "@/features/gifts/components/not-a-receipt-notice";
import {
  organizationName,
  parseDonorKey,
  statementGifts,
  type StatementRow,
} from "@/features/gifts/services/gift.data";

export const metadata: Metadata = { title: "Annual statements" };
export const dynamic = "force-dynamic";

interface DonorOption {
  donor_kind: "contact" | "organization";
  donor_id: string;
  donor_name: string;
  donor_email: string | null;
}

export default async function StatementPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { session, supabase, canRead, canManage } = await getLedgerAccess();
  const params = await searchParams;
  const today = todayIn(session.timeZone);
  const year = /^\d{4}$/.test(params.year ?? "") ? Number(params.year) : Number(today.slice(0, 4));
  const language: AckLanguage = params.lang === "en" ? "en" : "fr";
  const donor = parseDonorKey(params.donor);
  const header = (
    <PageHeader
      eyebrow="Gifts"
      title="Annual statements"
      description="A summary of one donor's gifts in a calendar year, as a thank-you. It is not an official receipt for income tax purposes."
    />
  );
  if (!canRead) {
    return (
      <div>
        {header}
        <NoLedgerAccess isAdmin={session.isAdmin} />
      </div>
    );
  }

  // Donors who gave that year, to choose from. The database audits this read.
  const { data: donorData } = await supabase.rpc("gift_donor_list", {
    p_organization: session.organizationId,
    p_from: `${year}-01-01`,
    p_to: `${year}-12-31`,
    p_purpose: "view",
  });
  const donors = (donorData ?? []) as DonorOption[];
  const chosen = donor ? donors.find((d) => d.donor_kind === donor.kind && d.donor_id === donor.id) : undefined;

  let preview: string | null = null;
  let issued: { id: string; language: string; channel: string; created_at: string }[] = [];
  if (donor && chosen) {
    const [{ data: rows }, org, { data: acks }] = await Promise.all([
      supabase.rpc("gift_donor_statement", {
        p_organization: session.organizationId,
        p_contact: donor.kind === "contact" ? donor.id : null,
        p_crm_organization: donor.kind === "organization" ? donor.id : null,
        p_year: year,
      }),
      organizationName(supabase, session.organizationId),
      supabase
        .from("gift_acknowledgement")
        .select("id, language, channel, created_at")
        .eq("organization_id", session.organizationId)
        .eq("kind", "annual_statement")
        .eq("statement_year", year)
        .eq(donor.kind === "contact" ? "crm_contact_id" : "crm_organization_id", donor.id)
        .order("created_at", { ascending: false }),
    ]);
    preview = renderAnnualStatement({
      language,
      organizationName: org,
      donorName: chosen.donor_name,
      issuedOn: today,
      year,
      gifts: statementGifts((rows ?? []) as StatementRow[]),
    }).text;
    issued = (acks ?? []) as typeof issued;
  }

  return (
    <div>
      {header}
      <GiftTabs />
      <NotAReceiptNotice />
      <form method="get" className="mb-6 flex flex-wrap items-end gap-2" aria-label="Choose the donor and year">
        <div>
          <Label htmlFor="statement-year">Year</Label>
          <Input id="statement-year" name="year" type="number" min={2000} max={2100} defaultValue={year} className="w-28" />
        </div>
        <div className="min-w-64">
          <Label htmlFor="statement-donor">Donor</Label>
          <Select id="statement-donor" name="donor" defaultValue={donor ? `${donor.kind}:${donor.id}` : ""}>
            <option value="">Choose a donor who gave that year</option>
            {donors.map((d) => (
              <option key={`${d.donor_kind}:${d.donor_id}`} value={`${d.donor_kind}:${d.donor_id}`}>
                {d.donor_name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="statement-lang">Preview in</Label>
          <Select id="statement-lang" name="lang" defaultValue={language}>
            <option value="fr">Français</option>
            <option value="en">English</option>
          </Select>
        </div>
        <Button type="submit" variant="secondary">
          Preview
        </Button>
      </form>

      {donor && !chosen ? (
        <p className="text-[13.5px] text-muted">No gifts from this donor are recorded for {year}.</p>
      ) : null}

      {preview && donor && chosen ? (
        <div className="grid gap-8 lg:grid-cols-[1fr_22rem]">
          <section aria-labelledby="statement-preview">
            <h2 id="statement-preview" className="mb-2 text-[15px] font-semibold">
              Preview
            </h2>
            <article
              lang={language === "fr" ? "fr-CA" : "en-CA"}
              className="rounded-(--radius-md) border border-line bg-surface p-6 font-serif text-[14.5px] leading-relaxed"
              // Built from escaped text by letterBodyHtml.
              dangerouslySetInnerHTML={{ __html: letterBodyHtml(preview) }}
            />
          </section>
          <aside className="space-y-4">
            {canManage ? (
              <>
                <h2 className="text-[15px] font-semibold">Issue this statement</h2>
                <AcknowledgeForm
                  target={{ kind: "statement", donor: `${donor.kind}:${donor.id}`, year }}
                  defaultEmail={chosen.donor_email}
                />
              </>
            ) : null}
            <div>
              <h2 className="mb-1 text-[15px] font-semibold">Issued for {year}</h2>
              {issued.length === 0 ? (
                <p className="text-[13px] text-muted">None yet.</p>
              ) : (
                <ul className="space-y-1 text-[13px]">
                  {issued.map((a) => (
                    <li key={a.id}>
                      <a href={`/api/finance/gifts/acknowledgements/${a.id}`} target="_blank" rel="noopener" className="underline">
                        {new Date(a.created_at).toLocaleDateString("en-CA", { timeZone: session.timeZone })}
                      </a>{" "}
                      · {a.language === "fr" ? "Français" : "English"} · {a.channel === "email" ? "Email" : "Print"}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </aside>
        </div>
      ) : null}
    </div>
  );
}
