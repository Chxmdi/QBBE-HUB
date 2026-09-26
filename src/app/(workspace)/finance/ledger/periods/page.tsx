import type { Metadata } from "next";
import { CalendarRange } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { DataTable, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LedgerTabs } from "@/features/ledger/components/ledger-tabs";
import { NoLedgerAccess } from "@/features/ledger/components/no-ledger-access";
import { FiscalYearForm, PeriodStatusButton } from "@/features/ledger/components/setup-forms";
import { getLedgerAccess } from "@/features/ledger/services/ledger.access";

export const metadata: Metadata = { title: "Fiscal periods" };
export const dynamic = "force-dynamic";

interface Period {
  id: string;
  name: string;
  starts_on: string;
  ends_on: string;
  status: "open" | "closed";
  closed_at: string | null;
}

/** The month after the last period, or the 2026-10 switchover when there is none. */
function nextStartMonth(periods: Period[]): string {
  const last = periods.at(-1);
  if (!last) return "2026-10";
  const [y, m] = last.ends_on.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

export default async function LedgerPeriodsPage() {
  const { session, supabase, canRead, canManage } = await getLedgerAccess();
  const header = (
    <PageHeader
      eyebrow="Ledger"
      title="Fiscal periods"
      description="Entries can only be dated in an open period. Close each month once it is reconciled; a closed month cannot be changed."
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

  const { data } = await supabase
    .from("ledger_period")
    .select("id, name, starts_on, ends_on, status, closed_at")
    .eq("organization_id", session.organizationId)
    .order("starts_on");
  const periods = (data ?? []) as Period[];

  return (
    <div>
      {header}
      <LedgerTabs />
      {canManage ? (
        <div className="card mb-6 p-4">
          <FiscalYearForm defaultMonth={nextStartMonth(periods)} />
        </div>
      ) : null}
      {periods.length === 0 ? (
        <EmptyState
          icon={<CalendarRange />}
          title="No fiscal periods yet"
          description="Add a fiscal year to create its twelve monthly periods."
        />
      ) : (
        <DataTable minWidth="560px">
          <TableHead>
            <TableHeader>Period</TableHeader>
            <TableHeader>Dates</TableHeader>
            <TableHeader>Status</TableHeader>
            {canManage ? (
              <TableHeader className="text-right">
                <span className="sr-only">Actions</span>
              </TableHeader>
            ) : null}
          </TableHead>
          <tbody>
            {periods.map((p) => (
              <TableRow key={p.id}>
                <TableCell className="font-medium">{p.name}</TableCell>
                <TableCell className="tabular-nums">
                  {p.starts_on} to {p.ends_on}
                </TableCell>
                <TableCell>
                  {p.status === "open" ? <Badge tone="success">Open</Badge> : <Badge>Closed</Badge>}
                </TableCell>
                {canManage ? (
                  <TableCell className="text-right">
                    <PeriodStatusButton periodId={p.id} name={p.name} status={p.status} />
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </tbody>
        </DataTable>
      )}
      <p className="meta mt-3">
        Closing a whole fiscal year, with its closing entry, is on the Year-end tab.
      </p>
    </div>
  );
}
