import type { Metadata } from "next";
import Link from "next/link";
import { BookOpen, Plus } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input, Label, Select } from "@/components/ui/input";
import { DataTable, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LedgerTabs } from "@/features/ledger/components/ledger-tabs";
import { NoLedgerAccess } from "@/features/ledger/components/no-ledger-access";
import { ENTRY_KIND_KEY, formatCents } from "@/features/ledger/money";
import { dateParam, getLedgerAccess } from "@/features/ledger/services/ledger.access";
import { getLocale, getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("finance.ledger.journal.title") };
}
export const dynamic = "force-dynamic";

const PAGE_LIMIT = 500;

interface EntryRow {
  id: string;
  entry_number: number | null;
  entry_date: string;
  memo: string;
  kind: string;
  status: "draft" | "posted";
  journal_line: { debit_cents: number }[];
}

export default async function LedgerJournalPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { session, supabase, canRead, canManage } = await getLedgerAccess();
  const t = await getT();
  const locale = await getLocale();
  const params = await searchParams;
  const header = (
    <PageHeader
      eyebrow={t("finance.ledger.title")}
      title={t("finance.ledger.journal.title")}
      description={t("finance.ledger.journal.description")}
      actions={
        canRead && canManage ? (
          <Link
            href="/finance/ledger/journal/new"
            className="inline-flex h-9.5 items-center gap-2 rounded-(--radius-sm) bg-brand px-4 text-sm font-medium text-white hover:bg-brand-strong"
          >
            <Plus className="size-4" aria-hidden />
            {t("finance.ledger.journal.newEntry")}
          </Link>
        ) : undefined
      }
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

  const status = params.status === "draft" || params.status === "posted" ? params.status : "";
  const from = params.from ? dateParam(params.from, "") : "";
  const to = params.to ? dateParam(params.to, "") : "";

  let query = supabase
    .from("journal_entry")
    .select("id, entry_number, entry_date, memo, kind, status, journal_line(debit_cents)")
    .eq("organization_id", session.organizationId);
  if (status) query = query.eq("status", status);
  if (from) query = query.gte("entry_date", from);
  if (to) query = query.lte("entry_date", to);
  const { data } = await query
    .order("entry_date", { ascending: false })
    .order("entry_number", { ascending: false, nullsFirst: true })
    .limit(PAGE_LIMIT);
  const rows = (data ?? []) as unknown as EntryRow[];
  const filtered = Boolean(status || from || to);

  return (
    <div>
      {header}
      <LedgerTabs />
      <form method="get" className="card mb-4 grid grid-cols-2 items-end gap-3 p-4 sm:grid-cols-4" aria-label={t("finance.ledger.journal.filterLabel")}>
        <div>
          <Label htmlFor="j-from">{t("finance.ledger.journal.from")}</Label>
          <Input id="j-from" name="from" type="date" defaultValue={from} />
        </div>
        <div>
          <Label htmlFor="j-to">{t("finance.ledger.journal.to")}</Label>
          <Input id="j-to" name="to" type="date" defaultValue={to} />
        </div>
        <div>
          <Label htmlFor="j-status">{t("finance.common.status")}</Label>
          <Select id="j-status" name="status" defaultValue={status}>
            <option value="">{t("finance.ledger.journal.anyStatus")}</option>
            <option value="posted">{t("finance.ledger.status.posted")}</option>
            <option value="draft">{t("finance.ledger.status.draft")}</option>
          </Select>
        </div>
        <div className="flex gap-2">
          <Button type="submit" variant="secondary">
            {t("finance.ledger.journal.apply")}
          </Button>
          {filtered ? (
            <Link
              href="/finance/ledger/journal"
              className="inline-flex h-9.5 items-center px-2 text-[13px] font-medium text-brand-fg hover:underline"
            >
              {t("finance.ledger.journal.clear")}
            </Link>
          ) : null}
        </div>
      </form>

      {rows.length === 0 ? (
        <EmptyState
          icon={<BookOpen />}
          title={filtered ? t("finance.ledger.journal.noMatchTitle") : t("finance.ledger.journal.emptyTitle")}
          description={
            filtered ? t("finance.ledger.journal.noMatchDescription") : t("finance.ledger.journal.emptyDescription")
          }
        />
      ) : (
        <>
          {rows.length === PAGE_LIMIT ? <p className="meta mb-2">{t("finance.ledger.journal.showingLatest", { count: PAGE_LIMIT })}</p> : null}
          <DataTable minWidth="680px">
            <TableHead>
              <TableHeader className="w-20">{t("finance.ledger.journal.number")}</TableHeader>
              <TableHeader className="w-28">{t("finance.common.date")}</TableHeader>
              <TableHeader>{t("finance.common.memo")}</TableHeader>
              <TableHeader className="w-32">{t("finance.common.status")}</TableHeader>
              <TableHeader className="w-36 text-right">{t("finance.common.amount")}</TableHeader>
            </TableHead>
            <tbody>
              {rows.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="tabular-nums">{e.entry_number ?? "—"}</TableCell>
                  <TableCell className="tabular-nums">{e.entry_date}</TableCell>
                  <TableCell>
                    <Link href={`/finance/ledger/journal/${e.id}`} className="font-medium text-brand-fg hover:underline">
                      {e.memo}
                    </Link>
                    {e.kind !== "standard" ? <p className="meta">{ENTRY_KIND_KEY[e.kind] ? t(ENTRY_KIND_KEY[e.kind]) : null}</p> : null}
                  </TableCell>
                  <TableCell>
                    {e.status === "posted" ? <Badge tone="success">{t("finance.ledger.status.posted")}</Badge> : <Badge tone="warning">{t("finance.ledger.status.draft")}</Badge>}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCents(e.journal_line.reduce((s, l) => s + Number(l.debit_cents), 0), locale)}
                  </TableCell>
                </TableRow>
              ))}
            </tbody>
          </DataTable>
        </>
      )}
    </div>
  );
}
