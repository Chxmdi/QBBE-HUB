import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { EntryForm } from "@/features/ledger/components/entry-form";
import { LedgerTabs } from "@/features/ledger/components/ledger-tabs";
import { NoLedgerAccess } from "@/features/ledger/components/no-ledger-access";
import { getLedgerAccess, todayIn } from "@/features/ledger/services/ledger.access";
import { loadEntryChoices } from "@/features/ledger/services/ledger.queries";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("finance.ledger.newEntry.title") };
}
export const dynamic = "force-dynamic";

export default async function NewJournalEntryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { session, supabase, canRead, canManage } = await getLedgerAccess();
  const t = await getT();
  const params = await searchParams;
  const opening = params.kind === "opening";
  const header = (
    <PageHeader
      eyebrow={t("finance.ledger.title")}
      title={opening ? t("finance.ledger.newEntry.openingTitle") : t("finance.ledger.newEntry.title")}
      description={t("finance.ledger.newEntry.description")}
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
          memo: opening ? t("finance.ledger.newEntry.openingMemo") : "",
          kind: opening ? "opening" : "standard",
          lines: [],
        }}
        {...choices}
      />
    </div>
  );
}
