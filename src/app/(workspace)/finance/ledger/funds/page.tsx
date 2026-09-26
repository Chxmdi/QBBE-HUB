import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Input, Label } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { DataTable, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FundDialog, type FundFormValue } from "@/features/ledger/components/fund-dialog";
import { LedgerTabs } from "@/features/ledger/components/ledger-tabs";
import { NoLedgerAccess } from "@/features/ledger/components/no-ledger-access";
import { FUND_RESTRICTION_LABEL, formatCents } from "@/features/ledger/money";
import { dateParam, getLedgerAccess, todayIn } from "@/features/ledger/services/ledger.access";

export const metadata: Metadata = { title: "Funds" };
export const dynamic = "force-dynamic";

interface FundBalance {
  fund_id: string;
  assets_cents: number;
  liabilities_cents: number;
  fund_balance_cents: number;
}

export default async function LedgerFundsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { session, supabase, canRead, canManage } = await getLedgerAccess();
  const params = await searchParams;
  const asOf = dateParam(params.as_of, todayIn(session.timeZone));
  const { data: programs } = canManage
    ? await supabase.from("program").select("id, name").eq("organization_id", session.organizationId).eq("status", "active").order("name")
    : { data: [] };
  const programList = (programs ?? []) as { id: string; name: string }[];

  const header = (
    <PageHeader
      eyebrow="Ledger"
      title="Funds"
      description="Every journal line belongs to a fund. Restricted money is tracked separately from the general fund, and each fund balances on its own."
      actions={canRead && canManage ? <FundDialog programs={programList} /> : undefined}
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

  const [{ data: funds }, { data: links }, { data: balances }, { data: allPrograms }] = await Promise.all([
    supabase
      .from("ledger_fund")
      .select("id, code, name, restriction, funder, starts_on, ends_on, description, is_active")
      .eq("organization_id", session.organizationId)
      .order("code"),
    supabase.from("ledger_fund_program").select("fund_id, program_id").eq("organization_id", session.organizationId),
    supabase
      .rpc("ledger_fund_balances", { p_organization: session.organizationId, p_as_of: asOf })
      .throwOnError(),
    supabase.from("program").select("id, name").eq("organization_id", session.organizationId),
  ]);

  const programName = new Map(((allPrograms ?? []) as { id: string; name: string }[]).map((p) => [p.id, p.name]));
  const byFund = new Map<string, string[]>();
  for (const l of (links ?? []) as { fund_id: string; program_id: string }[]) {
    byFund.set(l.fund_id, [...(byFund.get(l.fund_id) ?? []), l.program_id]);
  }
  const balanceOf = new Map(((balances ?? []) as FundBalance[]).map((b) => [b.fund_id, b]));
  const rows: FundFormValue[] = ((funds ?? []) as Omit<FundFormValue, "programIds" | "used">[]).map((f) => {
    const b = balanceOf.get(f.id);
    return {
      ...f,
      programIds: byFund.get(f.id) ?? [],
      used: Boolean(b && (Number(b.assets_cents) !== 0 || Number(b.liabilities_cents) !== 0 || Number(b.fund_balance_cents) !== 0)),
    };
  });
  const total = rows.reduce((sum, f) => sum + Number(balanceOf.get(f.id)?.fund_balance_cents ?? 0), 0);

  return (
    <div>
      {header}
      <LedgerTabs />
      <form method="get" className="mb-4 flex flex-wrap items-end gap-2" aria-label="Choose the balance date">
        <div>
          <Label htmlFor="funds-as-of">Balances as at</Label>
          <Input id="funds-as-of" name="as_of" type="date" defaultValue={asOf} />
        </div>
        <Button type="submit" variant="secondary">
          Show
        </Button>
      </form>
      <DataTable minWidth="760px">
        <TableHead>
          <TableHeader>Fund</TableHeader>
          <TableHeader>Restriction</TableHeader>
          <TableHeader>Spending limits</TableHeader>
          <TableHeader className="text-right">Fund balance</TableHeader>
          {canManage ? (
            <TableHeader className="w-16">
              <span className="sr-only">Edit</span>
            </TableHeader>
          ) : null}
        </TableHead>
        <tbody>
          {rows.map((f) => (
            <TableRow key={f.id}>
              <TableCell>
                <span className="font-mono">{f.code}</span> · {f.name}
                {f.funder ? <p className="meta">Funder: {f.funder}</p> : null}
                {!f.is_active ? <Badge className="mt-1">Inactive</Badge> : null}
              </TableCell>
              <TableCell>
                <Badge tone={f.restriction === "unrestricted" ? "neutral" : f.restriction === "externally_restricted" ? "warning" : "info"}>
                  {FUND_RESTRICTION_LABEL[f.restriction]}
                </Badge>
              </TableCell>
              <TableCell className="text-[13px]">
                {f.restriction === "unrestricted" ? (
                  <span className="text-muted">None</span>
                ) : (
                  <>
                    <p>
                      {f.starts_on || f.ends_on
                        ? `${f.starts_on ?? "any time"} to ${f.ends_on ?? "no end date"}`
                        : "Any dates"}
                    </p>
                    <p className="meta">
                      {f.programIds.length > 0
                        ? f.programIds.map((id) => programName.get(id) ?? "Unknown program").join(", ")
                        : "Any program"}
                    </p>
                  </>
                )}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatCents(Number(balanceOf.get(f.id)?.fund_balance_cents ?? 0))}
              </TableCell>
              {canManage ? (
                <TableCell>
                  <FundDialog fund={f} programs={programList} />
                </TableCell>
              ) : null}
            </TableRow>
          ))}
          <TableRow className="font-semibold">
            <TableCell>All funds</TableCell>
            <TableCell>{""}</TableCell>
            <TableCell>{""}</TableCell>
            <TableCell className="text-right tabular-nums">{formatCents(total)}</TableCell>
            {canManage ? <TableCell>{""}</TableCell> : null}
          </TableRow>
        </tbody>
      </DataTable>
      <p className="meta mt-2">
        A fund&apos;s balance is its assets less its liabilities, from posted entries up to the date shown.
      </p>
    </div>
  );
}
