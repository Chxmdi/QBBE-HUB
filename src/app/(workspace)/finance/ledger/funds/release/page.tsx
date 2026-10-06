import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { DataTable, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LedgerTabs } from "@/features/ledger/components/ledger-tabs";
import { NoLedgerAccess } from "@/features/ledger/components/no-ledger-access";
import { ReleaseForm, type ReleaseFundOption } from "@/features/ledger/components/release-form";
import { formatCents, type FundRestriction } from "@/features/ledger/money";
import { getLedgerAccess, todayIn } from "@/features/ledger/services/ledger.access";
import { getLocale, getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("finance.ledger.release.title") };
}
export const dynamic = "force-dynamic";

interface FundRow {
  id: string;
  code: string;
  name: string;
  restriction: FundRestriction;
  is_active: boolean;
}

interface ReleaseRow {
  id: string;
  from_fund_id: string;
  to_fund_id: string;
  amount_cents: number;
  release_date: string;
  condition: string;
  entry_id: string;
  releaser: { full_name: string } | null;
}

export default async function ReleaseRestrictedPage() {
  const [{ session, supabase, canRead, canManage }, t, locale] = await Promise.all([
    getLedgerAccess(),
    getT(),
    getLocale(),
  ]);
  const header = (
    <PageHeader
      eyebrow={t("finance.ledger.title")}
      title={t("finance.ledger.release.title")}
      description={t("finance.ledger.release.description")}
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

  const today = todayIn(session.timeZone);
  const [{ data: funds }, { data: releases }] = await Promise.all([
    supabase
      .from("ledger_fund")
      .select("id, code, name, restriction, is_active")
      .eq("organization_id", session.organizationId)
      .order("code")
      .throwOnError(),
    supabase
      .from("ledger_fund_release")
      .select("id, from_fund_id, to_fund_id, amount_cents, release_date, condition, entry_id, releaser:released_by(full_name)")
      .eq("organization_id", session.organizationId)
      .order("release_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(200)
      .throwOnError(),
  ]);
  const fundRows = (funds ?? []) as FundRow[];
  const releaseRows = (releases ?? []) as unknown as ReleaseRow[];
  const fundById = new Map(fundRows.map((f) => [f.id, f]));

  const entryIds = releaseRows.map((r) => r.entry_id);
  const [{ data: entries }, { data: reversals }] = entryIds.length
    ? await Promise.all([
        supabase.from("journal_entry").select("id, entry_number").in("id", entryIds),
        supabase.from("journal_entry").select("reverses_entry_id").in("reverses_entry_id", entryIds),
      ])
    : [{ data: [] }, { data: [] }];
  const entryNumber = new Map(((entries ?? []) as { id: string; entry_number: number | null }[]).map((e) => [e.id, e.entry_number]));
  const reversed = new Set(((reversals ?? []) as { reverses_entry_id: string }[]).map((e) => e.reverses_entry_id));

  let restricted: ReleaseFundOption[] = [];
  let unrestricted: ReleaseFundOption[] = [];
  if (canManage) {
    // Available on today, the form's default release date; the form asks
    // again when a different date is chosen.
    const active = fundRows.filter((f) => f.is_active);
    restricted = await Promise.all(
      active
        .filter((f) => f.restriction !== "unrestricted")
        .map(async (f) => {
          const { data } = await supabase.rpc("ledger_fund_available_cents", { p_fund: f.id, p_as_of: today });
          return { id: f.id, code: f.code, name: f.name, availableCents: Number(data ?? 0) };
        }),
    );
    unrestricted = active
      .filter((f) => f.restriction === "unrestricted")
      .map((f) => ({ id: f.id, code: f.code, name: f.name }));
  }

  const fundLabel = (id: string) => {
    const f = fundById.get(id);
    return f ? `${f.code} ${f.name}` : t("finance.ledger.release.unknownFund");
  };

  return (
    <div>
      {header}
      <LedgerTabs />
      {canManage ? (
        <section aria-labelledby="release-heading" className="card mb-6 p-4">
          <h2 id="release-heading" className="mb-3 text-base font-semibold">
            {t("finance.ledger.release.newRelease")}
          </h2>
          {restricted.length === 0 || unrestricted.length === 0 ? (
            <p className="meta">
              {t("finance.ledger.release.needsFunds")}{" "}
              {/* Underlined: inside a sentence, colour alone does not mark a link (WCAG 1.4.1). */}
              <Link href="/finance/ledger/funds" className="text-brand-fg underline">
                {t("finance.ledger.release.manageFunds")}
              </Link>
            </p>
          ) : (
            <ReleaseForm restricted={restricted} unrestricted={unrestricted} defaultDate={today} />
          )}
        </section>
      ) : null}

      <section aria-labelledby="history-heading">
        <h2 id="history-heading" className="mb-2 text-base font-semibold">
          {t("finance.ledger.release.history")}
        </h2>
        {releaseRows.length === 0 ? (
          <p className="meta">{t("finance.ledger.release.empty")}</p>
        ) : (
          <DataTable minWidth="820px">
            <TableHead>
              <TableHeader>{t("finance.ledger.release.date")}</TableHeader>
              <TableHeader>{t("finance.ledger.release.from")}</TableHeader>
              <TableHeader>{t("finance.ledger.release.to")}</TableHeader>
              <TableHeader>{t("finance.ledger.release.condition")}</TableHeader>
              <TableHeader className="text-right">{t("finance.ledger.release.amount")}</TableHeader>
              <TableHeader>{t("finance.ledger.release.entry")}</TableHeader>
            </TableHead>
            <tbody>
              {releaseRows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="whitespace-nowrap tabular-nums">{r.release_date}</TableCell>
                  <TableCell>{fundLabel(r.from_fund_id)}</TableCell>
                  <TableCell>{fundLabel(r.to_fund_id)}</TableCell>
                  <TableCell className="text-[13px]">
                    {r.condition}
                    {r.releaser ? <p className="meta">{t("finance.ledger.release.by", { name: r.releaser.full_name })}</p> : null}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatCents(Number(r.amount_cents), locale)}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    <Link href={`/finance/ledger/journal/${r.entry_id}`} className="text-brand-fg hover:underline">
                      {t("finance.ledger.release.entryNumber", { number: entryNumber.get(r.entry_id) ?? "" })}
                    </Link>
                    {reversed.has(r.entry_id) ? <Badge className="ml-2">{t("finance.ledger.release.reversed")}</Badge> : null}
                  </TableCell>
                </TableRow>
              ))}
            </tbody>
          </DataTable>
        )}
        <p className="meta mt-2">
          {t("finance.ledger.release.note")}
        </p>
      </section>
    </div>
  );
}
