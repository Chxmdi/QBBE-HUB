import { DataTable, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FUND_RESTRICTIONS, FUND_RESTRICTION_LABEL, formatCents } from "@/features/ledger/money";
import type { ByClass, StatementLine, Statements } from "@/features/ledger/year-end";
import type { FundChanges } from "@/features/ledger/fund-changes";
import { cn } from "@/lib/utils";

const amount = (cents: number) => (cents < 0 ? `(${formatCents(-cents)})` : formatCents(cents));

function AmountCell({ cents, strong }: { cents: number; strong?: boolean }) {
  return <TableCell className={cn("text-right tabular-nums", strong && "font-semibold")}>{amount(cents)}</TableCell>;
}

function priorOf(lines: StatementLine[] | undefined, code: string) {
  return lines?.find((l) => l.code === code)?.amounts.total ?? 0;
}

/** Codes in either year, so an account used only last year still shows. */
function codesOf(current: StatementLine[], prior: StatementLine[] | undefined) {
  const byCode = new Map<string, string>();
  for (const l of [...current, ...(prior ?? [])]) if (!byCode.has(l.code)) byCode.set(l.code, l.name);
  return [...byCode.entries()].sort(([a], [b]) => a.localeCompare(b));
}

export function PositionTable({ current, prior }: { current: Statements; prior: Statements | null }) {
  const section = (title: string, lines: StatementLine[], priorLines: StatementLine[] | undefined) => (
    <>
      <TableRow>
        <th scope="rowgroup" className="px-4 py-3 text-left font-semibold" colSpan={prior ? 3 : 2}>
          {title}
        </th>
      </TableRow>
      {codesOf(lines, priorLines).map(([code, name]) => (
        <TableRow key={`${title}-${code}`}>
          <TableCell className="pl-6">
            <span className="font-mono tabular-nums">{code}</span> {name}
          </TableCell>
          <AmountCell cents={priorOf(lines, code)} />
          {prior ? <AmountCell cents={priorOf(priorLines, code)} /> : null}
        </TableRow>
      ))}
    </>
  );
  return (
    <DataTable minWidth="520px">
      <TableHead>
        <TableHeader>Statement of financial position</TableHeader>
        <TableHeader className="w-40 text-right">{current.to}</TableHeader>
        {prior ? <TableHeader className="w-40 text-right">{prior.to}</TableHeader> : null}
      </TableHead>
      <tbody>
        {section("Assets", current.position.assets, prior?.position.assets)}
        <TableRow>
          <TableCell className="font-semibold">Total assets</TableCell>
          <AmountCell cents={current.position.totalAssets} strong />
          {prior ? <AmountCell cents={prior.position.totalAssets} strong /> : null}
        </TableRow>
        {section("Liabilities", current.position.liabilities, prior?.position.liabilities)}
        <TableRow>
          <TableCell className="font-semibold">Total liabilities</TableCell>
          <AmountCell cents={current.position.totalLiabilities} strong />
          {prior ? <AmountCell cents={prior.position.totalLiabilities} strong /> : null}
        </TableRow>
        <TableRow>
          <th scope="rowgroup" className="px-4 py-3 text-left font-semibold" colSpan={prior ? 3 : 2}>
            Net assets
          </th>
        </TableRow>
        {FUND_RESTRICTIONS.map((r) => (
          <TableRow key={r}>
            <TableCell className="pl-6">{FUND_RESTRICTION_LABEL[r]}</TableCell>
            <AmountCell cents={current.position.netAssets[r]} />
            {prior ? <AmountCell cents={prior.position.netAssets[r]} /> : null}
          </TableRow>
        ))}
        <TableRow>
          <TableCell className="font-semibold">Total net assets</TableCell>
          <AmountCell cents={current.position.netAssets.total} strong />
          {prior ? <AmountCell cents={prior.position.netAssets.total} strong /> : null}
        </TableRow>
        <TableRow>
          <TableCell className="font-semibold">Total liabilities and net assets</TableCell>
          <AmountCell cents={current.position.totalLiabilities + current.position.netAssets.total} strong />
          {prior ? <AmountCell cents={prior.position.totalLiabilities + prior.position.netAssets.total} strong /> : null}
        </TableRow>
      </tbody>
    </DataTable>
  );
}

function ClassCells({ values, strong }: { values: ByClass; strong?: boolean }) {
  return (
    <>
      {FUND_RESTRICTIONS.map((r) => (
        <AmountCell key={r} cents={values[r]} strong={strong} />
      ))}
      <AmountCell cents={values.total} strong />
    </>
  );
}

export function OperationsTable({ current, prior }: { current: Statements; prior: Statements | null }) {
  const cols = 5 + (prior ? 1 : 0);
  const section = (title: string, lines: StatementLine[], priorLines: StatementLine[] | undefined) => (
    <>
      <TableRow>
        <th scope="rowgroup" className="px-4 py-3 text-left font-semibold" colSpan={cols}>
          {title}
        </th>
      </TableRow>
      {codesOf(lines, priorLines).map(([code, name]) => {
        const line = lines.find((l) => l.code === code);
        return (
          <TableRow key={`${title}-${code}`}>
            <TableCell className="pl-6">
              <span className="font-mono tabular-nums">{code}</span> {name}
            </TableCell>
            {line ? (
              <ClassCells values={line.amounts} />
            ) : (
              <ClassCells values={{ unrestricted: 0, internally_restricted: 0, externally_restricted: 0, total: 0 }} />
            )}
            {prior ? <AmountCell cents={priorOf(priorLines, code)} /> : null}
          </TableRow>
        );
      })}
    </>
  );
  const totalRow = (label: string, values: ByClass, priorValue: number | undefined) => (
    <TableRow>
      <TableCell className="font-semibold">{label}</TableCell>
      <ClassCells values={values} strong />
      {prior ? <AmountCell cents={priorValue ?? 0} strong /> : null}
    </TableRow>
  );
  const o = current.operations;
  const c = current.changes;
  return (
    <DataTable minWidth="820px">
      <TableHead>
        <TableHeader>
          Statement of operations and changes in net assets, {current.from} to {current.to}
        </TableHeader>
        {FUND_RESTRICTIONS.map((r) => (
          <TableHeader key={r} className="w-36 text-right">
            {FUND_RESTRICTION_LABEL[r]}
          </TableHeader>
        ))}
        <TableHeader className="w-36 text-right">Total</TableHeader>
        {prior ? <TableHeader className="w-36 text-right">Prior year total</TableHeader> : null}
      </TableHead>
      <tbody>
        {section("Revenue", o.revenue, prior?.operations.revenue)}
        {totalRow("Total revenue", o.totalRevenue, prior?.operations.totalRevenue.total)}
        {section("Expenses", o.expenses, prior?.operations.expenses)}
        {totalRow("Total expenses", o.totalExpenses, prior?.operations.totalExpenses.total)}
        {totalRow("Excess (deficiency) of revenue over expenses", o.excess, prior?.operations.excess.total)}
        {totalRow("Net assets, beginning of year", c.beginning, prior?.changes.beginning.total)}
        {totalRow("Transfers and direct entries to net assets", c.direct, prior?.changes.direct.total)}
        {totalRow("Net assets, end of year", c.ending, prior?.changes.ending.total)}
      </tbody>
    </DataTable>
  );
}

/** Statement of changes in fund balances (#149): one row per fund, then all funds. */
export function FundChangesTable({ changes }: { changes: FundChanges }) {
  const t = changes.totals;
  return (
    <DataTable minWidth="860px">
      <TableHead>
        <TableHeader>Fund</TableHeader>
        <TableHeader className="w-32 text-right">Balance {changes.from}</TableHeader>
        <TableHeader className="w-32 text-right">Revenue</TableHeader>
        <TableHeader className="w-32 text-right">Expenses</TableHeader>
        <TableHeader className="w-32 text-right">Transfers and releases</TableHeader>
        <TableHeader className="w-32 text-right">Balance {changes.to}</TableHeader>
      </TableHead>
      <tbody>
        {changes.funds.map((f) => (
          <TableRow key={f.fund_id}>
            <TableCell>
              <span className="font-mono">{f.code}</span> {f.name}
              <p className="meta">{FUND_RESTRICTION_LABEL[f.restriction]}</p>
            </TableCell>
            <AmountCell cents={f.opening_cents} />
            <AmountCell cents={f.revenue_cents} />
            <AmountCell cents={f.expenses_cents} />
            <AmountCell cents={f.transfers_cents} />
            <AmountCell cents={f.closing_cents} strong />
          </TableRow>
        ))}
        <TableRow>
          <TableCell className="font-semibold">All funds</TableCell>
          <AmountCell cents={t.opening_cents} strong />
          <AmountCell cents={t.revenue_cents} strong />
          <AmountCell cents={t.expenses_cents} strong />
          <AmountCell cents={t.transfers_cents} strong />
          <AmountCell cents={t.closing_cents} strong />
        </TableRow>
      </tbody>
    </DataTable>
  );
}
