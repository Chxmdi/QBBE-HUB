import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { EntryForm } from "@/features/ledger/components/entry-form";
import { LedgerTabs } from "@/features/ledger/components/ledger-tabs";
import { NoLedgerAccess } from "@/features/ledger/components/no-ledger-access";
import { getLedgerAccess, todayIn } from "@/features/ledger/services/ledger.access";
import { loadEntryChoices } from "@/features/ledger/services/ledger.queries";

export const metadata: Metadata = { title: "New journal entry" };
export const dynamic = "force-dynamic";

export default async function NewJournalEntryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { session, supabase, canRead, canManage } = await getLedgerAccess();
  const params = await searchParams;
  const opening = params.kind === "opening";
  const header = (
    <PageHeader
      eyebrow="Ledger"
      title={opening ? "Opening balances" : "New journal entry"}
      description="Debits must equal credits, overall and within each fund. Save a draft to finish later, or post it when it is right."
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
  if (!canManage) redirect("/finance/ledger/journal");

  const choices = await loadEntryChoices(supabase, session.organizationId);
  return (
    <div>
      {header}
      <LedgerTabs />
      <EntryForm
        initial={{
          entryDate: opening ? "2026-10-01" : todayIn(session.timeZone),
          memo: opening ? "Opening balances from the accountant's 2026-09-30 figures" : "",
          kind: opening ? "opening" : "standard",
          lines: [],
        }}
        {...choices}
      />
    </div>
  );
}
