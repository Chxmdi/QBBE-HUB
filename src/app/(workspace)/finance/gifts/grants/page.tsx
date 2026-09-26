import type { Metadata } from "next";
import Link from "next/link";
import { Landmark } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { DataTable, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { NoLedgerAccess } from "@/features/ledger/components/no-ledger-access";
import { formatCents } from "@/features/ledger/money";
import { getLedgerAccess, todayIn } from "@/features/ledger/services/ledger.access";
import { GiftTabs } from "@/features/gifts/components/gift-tabs";
import { GrantDialog } from "@/features/gifts/components/grant-forms";
import { grantOptions } from "@/features/gifts/services/gift.options";

export const metadata: Metadata = { title: "Grants" };
export const dynamic = "force-dynamic";

interface GrantRow {
  id: string;
  title: string;
  amount_awarded_cents: number;
  starts_on: string | null;
  ends_on: string | null;
  status: "active" | "closed";
  funder: { name: string } | null;
  fund: { code: string; name: string } | null;
}

export default async function GrantsPage() {
  const { session, supabase, canRead, canManage } = await getLedgerAccess();
  const options = canManage ? await grantOptions(supabase, session.organizationId) : null;
  const header = (
    <PageHeader
      eyebrow="Gifts"
      title="Grants"
      description="Grants awarded to QBBE: the funder, the amount, its conditions, the money received so far and the reports owed."
      actions={options ? <GrantDialog options={options} /> : undefined}
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
  const [{ data: grants }, { data: payments }, { data: reports }] = await Promise.all([
    supabase
      .from("grant_award")
      .select("id, title, amount_awarded_cents, starts_on, ends_on, status, funder:funder_crm_organization_id(name), fund:fund_id(code, name)")
      .eq("organization_id", session.organizationId)
      .order("status")
      .order("title"),
    supabase
      .from("gift")
      .select("grant_id, amount_cents")
      .eq("organization_id", session.organizationId)
      .eq("status", "recorded")
      .not("grant_id", "is", null),
    supabase
      .from("grant_report")
      .select("grant_id, due_on")
      .eq("organization_id", session.organizationId)
      .is("submitted_on", null)
      .order("due_on"),
  ]);
  const received = new Map<string, number>();
  for (const p of (payments ?? []) as { grant_id: string; amount_cents: number }[]) {
    received.set(p.grant_id, (received.get(p.grant_id) ?? 0) + Number(p.amount_cents));
  }
  const nextReport = new Map<string, string>();
  for (const r of (reports ?? []) as { grant_id: string; due_on: string }[]) {
    if (!nextReport.has(r.grant_id)) nextReport.set(r.grant_id, r.due_on);
  }
  const rows = (grants ?? []) as unknown as GrantRow[];

  return (
    <div>
      {header}
      <GiftTabs />
      {rows.length === 0 ? (
        <EmptyState icon={<Landmark />} title="No grants yet" description="Add a grant to track its money, conditions and reports." />
      ) : (
        <DataTable minWidth="760px">
          <TableHead>
            <TableHeader>Grant</TableHeader>
            <TableHeader className="text-right">Awarded</TableHeader>
            <TableHeader className="text-right">Received</TableHeader>
            <TableHeader>Next report due</TableHeader>
          </TableHead>
          <tbody>
            {rows.map((g) => {
              const due = nextReport.get(g.id);
              return (
                <TableRow key={g.id}>
                  <TableCell>
                    <Link href={`/finance/gifts/grants/${g.id}`} className="font-medium hover:underline">
                      {g.title}
                    </Link>
                    <p className="meta">
                      {g.funder?.name ?? ""}
                      {g.fund ? ` · ${g.fund.code}` : ""}
                    </p>
                    {g.status === "closed" ? <Badge className="mt-1">Closed</Badge> : null}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatCents(Number(g.amount_awarded_cents))}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCents(received.get(g.id) ?? 0)}</TableCell>
                  <TableCell>
                    {due ? (
                      <>
                        {due} {due < today ? <Badge tone="danger">Overdue</Badge> : null}
                      </>
                    ) : (
                      <span className="text-muted">None</span>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </tbody>
        </DataTable>
      )}
    </div>
  );
}
