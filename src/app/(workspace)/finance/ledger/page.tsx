import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2, Circle } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { LedgerTabs } from "@/features/ledger/components/ledger-tabs";
import { NoLedgerAccess } from "@/features/ledger/components/no-ledger-access";
import { ChartApprovalForm, LedgerReaders } from "@/features/ledger/components/setup-forms";
import { getLedgerAccess, todayIn } from "@/features/ledger/services/ledger.access";

export const metadata: Metadata = { title: "Ledger" };
export const dynamic = "force-dynamic";

function Step({ done, title, children }: { done: boolean; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3 py-3">
      {done ? (
        <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success-fg" aria-hidden />
      ) : (
        <Circle className="mt-0.5 size-5 shrink-0 text-muted" aria-hidden />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-medium">
          {title}
          <span className="sr-only">{done ? " (done)" : " (to do)"}</span>
        </p>
        <div className="mt-1 text-[13.5px] text-muted">{children}</div>
      </div>
    </li>
  );
}

export default async function LedgerOverviewPage() {
  const { session, supabase, canRead, canManage, settings } = await getLedgerAccess();
  const header = (
    <PageHeader
      eyebrow="Finance"
      title="Ledger"
      description="QBBE's books: a double-entry general ledger with a fund on every line. Posted entries never change; a mistake is corrected with a reversing entry."
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

  const org = session.organizationId;
  const [periods, openings, drafts, posted, readers, staff] = await Promise.all([
    supabase.from("ledger_period").select("id", { count: "exact", head: true }).eq("organization_id", org),
    supabase
      .from("journal_entry")
      .select("id, entry_number, entry_date")
      .eq("organization_id", org)
      .eq("kind", "opening")
      .eq("status", "posted")
      .order("entry_date")
      .limit(1),
    supabase
      .from("journal_entry")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", org)
      .eq("status", "draft"),
    supabase
      .from("journal_entry")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", org)
      .eq("status", "posted"),
    canManage
      ? supabase
          .from("ledger_reader")
          .select("user_id, user_profile:user_id(full_name, email)")
          .eq("organization_id", org)
      : Promise.resolve({ data: [] }),
    canManage
      ? supabase
          .from("organization_membership")
          .select("user_id, user_profile:user_id(full_name, email)")
          .eq("organization_id", org)
          .eq("status", "active")
          .eq("role", "staff")
      : Promise.resolve({ data: [] }),
  ]);

  type Person = { user_id: string; user_profile: { full_name: string; email: string } | null };
  const name = (p: Person) => p.user_profile?.full_name || p.user_profile?.email || "Unnamed";
  const readerRows = ((readers.data ?? []) as unknown as Person[]).map((p) => ({ id: p.user_id, name: name(p) }));
  const readerIds = new Set(readerRows.map((r) => r.id));
  const candidates = ((staff.data ?? []) as unknown as Person[])
    .filter((p) => !readerIds.has(p.user_id))
    .map((p) => ({ id: p.user_id, name: name(p) }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const opening = (openings.data ?? [])[0] as { id: string; entry_number: number; entry_date: string } | undefined;
  const approved = Boolean(settings?.chart_approved_on);

  return (
    <div>
      {header}
      <LedgerTabs />

      <section aria-labelledby="setup-heading" className="card mb-6 p-5">
        <h2 id="setup-heading" className="text-[15px] font-semibold">
          Before the first real entry
        </h2>
        <ol className="mt-2 divide-y divide-line">
          <Step done={approved} title="The accountant approves the chart of accounts">
            {approved ? (
              <p>
                Approved by {settings?.chart_approved_by_name} on{" "}
                {settings?.chart_approved_on}. Nothing can be posted without this.
              </p>
            ) : (
              <>
                <p className="mb-3">
                  Review the <Link className="text-brand-fg underline underline-offset-2" href="/finance/ledger/accounts">starter chart of accounts</Link>{" "}
                  with the accountant. Nothing can be posted until their approval is recorded here.
                </p>
                {canManage ? <ChartApprovalForm today={todayIn(session.timeZone)} /> : null}
              </>
            )}
          </Step>
          <Step done={(periods.count ?? 0) > 0} title="Fiscal periods exist">
            <p>
              {(periods.count ?? 0) > 0 ? `${periods.count} monthly periods. ` : "No periods yet. "}
              <Link className="text-brand-fg underline underline-offset-2" href="/finance/ledger/periods">
                Manage periods
              </Link>
            </p>
          </Step>
          <Step done={Boolean(opening)} title="Opening balances are posted">
            {opening ? (
              <p>
                <Link className="text-brand-fg underline underline-offset-2" href={`/finance/ledger/journal/${opening.id}`}>
                  Entry {opening.entry_number}
                </Link>{" "}
                dated {opening.entry_date}.
              </p>
            ) : (
              <p>
                Enter the accountant&apos;s 2026-09-30 balances as one entry dated 2026-10-01.{" "}
                {canManage ? (
                  <Link className="text-brand-fg underline underline-offset-2" href="/finance/ledger/journal/new?kind=opening">
                    Enter opening balances
                  </Link>
                ) : null}
              </p>
            )}
          </Step>
        </ol>
      </section>

      <section aria-labelledby="summary-heading" className="mb-6 grid gap-3 sm:grid-cols-2">
        <h2 id="summary-heading" className="sr-only">
          Summary
        </h2>
        <Link href="/finance/ledger/journal" className="card p-4 hover:bg-surface-soft/60">
          <p className="text-[13px] text-muted">Posted entries</p>
          <p className="text-2xl font-semibold">{posted.count ?? 0}</p>
        </Link>
        <Link href="/finance/ledger/journal?status=draft" className="card p-4 hover:bg-surface-soft/60">
          <p className="text-[13px] text-muted">Drafts waiting to be posted</p>
          <p className="text-2xl font-semibold">{drafts.count ?? 0}</p>
        </Link>
      </section>

      {canManage ? (
        <section aria-labelledby="readers-heading" className="card p-5">
          <h2 id="readers-heading" className="text-[15px] font-semibold">
            Read-only access for finance staff
          </h2>
          <p className="mt-1 mb-3 text-[13.5px] text-muted">
            Owners and administrators with multi-factor authentication keep the books. Staff named here can
            read the journal and reports but change nothing.
          </p>
          <LedgerReaders readers={readerRows} candidates={candidates} />
        </section>
      ) : null}
    </div>
  );
}
