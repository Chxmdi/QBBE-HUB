import { DataTable, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FUND_RESTRICTIONS, FUND_RESTRICTION_KEY, formatCents } from "@/features/ledger/money";
import type { ByClass, StatementLine, Statements } from "@/features/ledger/year-end";
import type { Locale } from "@/lib/i18n/config";
import { getLocale, getT } from "@/lib/i18n/server";
import { cn } from "@/lib/utils";

const amount = (cents: number, locale: Locale) =>
  cents < 0 ? `(${formatCents(-cents, locale)})` : formatCents(cents, locale);

function AmountCell({ cents, strong, locale }: { cents: number; strong?: boolean; locale: Locale }) {
  return (
    <TableCell className={cn("text-right tabular-nums", strong && "font-semibold")}>{amount(cents, locale)}</TableCell>
  );
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

export async function PositionTable({ current, prior }: { current: Statements; prior: Statements | null }) {
  const [t, locale] = await Promise.all([getT(), getLocale()]);
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
          <AmountCell cents={priorOf(lines, code)} locale={locale} />
          {prior ? <AmountCell cents={priorOf(priorLines, code)} locale={locale} /> : null}
        </TableRow>
      ))}
    </>
  );
  return (
    <DataTable minWidth="520px">
      <TableHead>
        <TableHeader>{t("finance.ledgerReports.statementTables.positionTitle")}</TableHeader>
        <TableHeader className="w-40 text-right">{current.to}</TableHeader>
        {prior ? <TableHeader className="w-40 text-right">{prior.to}</TableHeader> : null}
      </TableHead>
      <tbody>
        {section(t("finance.ledgerReports.statementTables.assets"), current.position.assets, prior?.position.assets)}
        <TableRow>
          <TableCell className="font-semibold">{t("finance.ledgerReports.statementTables.totalAssets")}</TableCell>
          <AmountCell cents={current.position.totalAssets} strong locale={locale} />
          {prior ? <AmountCell cents={prior.position.totalAssets} strong locale={locale} /> : null}
        </TableRow>
        {section(
          t("finance.ledgerReports.statementTables.liabilities"),
          current.position.liabilities,
          prior?.position.liabilities,
        )}
        <TableRow>
          <TableCell className="font-semibold">{t("finance.ledgerReports.statementTables.totalLiabilities")}</TableCell>
          <AmountCell cents={current.position.totalLiabilities} strong locale={locale} />
          {prior ? <AmountCell cents={prior.position.totalLiabilities} strong locale={locale} /> : null}
        </TableRow>
        <TableRow>
          <th scope="rowgroup" className="px-4 py-3 text-left font-semibold" colSpan={prior ? 3 : 2}>
            {t("finance.ledgerReports.statementTables.netAssets")}
          </th>
        </TableRow>
        {FUND_RESTRICTIONS.map((r) => (
          <TableRow key={r}>
            <TableCell className="pl-6">{t(FUND_RESTRICTION_KEY[r])}</TableCell>
            <AmountCell cents={current.position.netAssets[r]} locale={locale} />
            {prior ? <AmountCell cents={prior.position.netAssets[r]} locale={locale} /> : null}
          </TableRow>
        ))}
        <TableRow>
          <TableCell className="font-semibold">{t("finance.ledgerReports.statementTables.totalNetAssets")}</TableCell>
          <AmountCell cents={current.position.netAssets.total} strong locale={locale} />
          {prior ? <AmountCell cents={prior.position.netAssets.total} strong locale={locale} /> : null}
        </TableRow>
        <TableRow>
          <TableCell className="font-semibold">
            {t("finance.ledgerReports.statementTables.totalLiabilitiesAndNetAssets")}
          </TableCell>
          <AmountCell
            cents={current.position.totalLiabilities + current.position.netAssets.total}
            strong
            locale={locale}
          />
          {prior ? (
            <AmountCell cents={prior.position.totalLiabilities + prior.position.netAssets.total} strong locale={locale} />
          ) : null}
        </TableRow>
      </tbody>
    </DataTable>
  );
}

function ClassCells({ values, strong, locale }: { values: ByClass; strong?: boolean; locale: Locale }) {
  return (
    <>
      {FUND_RESTRICTIONS.map((r) => (
        <AmountCell key={r} cents={values[r]} strong={strong} locale={locale} />
      ))}
      <AmountCell cents={values.total} strong locale={locale} />
    </>
  );
}

export async function OperationsTable({ current, prior }: { current: Statements; prior: Statements | null }) {
  const [t, locale] = await Promise.all([getT(), getLocale()]);
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
              <ClassCells values={line.amounts} locale={locale} />
            ) : (
              <ClassCells
                values={{ unrestricted: 0, internally_restricted: 0, externally_restricted: 0, total: 0 }}
                locale={locale}
              />
            )}
            {prior ? <AmountCell cents={priorOf(priorLines, code)} locale={locale} /> : null}
          </TableRow>
        );
      })}
    </>
  );
  const totalRow = (label: string, values: ByClass, priorValue: number | undefined) => (
    <TableRow>
      <TableCell className="font-semibold">{label}</TableCell>
      <ClassCells values={values} strong locale={locale} />
      {prior ? <AmountCell cents={priorValue ?? 0} strong locale={locale} /> : null}
    </TableRow>
  );
  const o = current.operations;
  const c = current.changes;
  return (
    <DataTable minWidth="820px">
      <TableHead>
        <TableHeader>
          {t("finance.ledgerReports.statementTables.operationsTitle", { from: current.from, to: current.to })}
        </TableHeader>
        {FUND_RESTRICTIONS.map((r) => (
          <TableHeader key={r} className="w-36 text-right">
            {t(FUND_RESTRICTION_KEY[r])}
          </TableHeader>
        ))}
        <TableHeader className="w-36 text-right">{t("finance.common.total")}</TableHeader>
        {prior ? (
          <TableHeader className="w-36 text-right">{t("finance.ledgerReports.statementTables.priorYearTotal")}</TableHeader>
        ) : null}
      </TableHead>
      <tbody>
        {section(t("finance.ledgerReports.statementTables.revenue"), o.revenue, prior?.operations.revenue)}
        {totalRow(
          t("finance.ledgerReports.statementTables.totalRevenue"),
          o.totalRevenue,
          prior?.operations.totalRevenue.total,
        )}
        {section(t("finance.ledgerReports.statementTables.expenses"), o.expenses, prior?.operations.expenses)}
        {totalRow(
          t("finance.ledgerReports.statementTables.totalExpenses"),
          o.totalExpenses,
          prior?.operations.totalExpenses.total,
        )}
        {totalRow(t("finance.ledgerReports.statementTables.excess"), o.excess, prior?.operations.excess.total)}
        {totalRow(
          t("finance.ledgerReports.statementTables.netAssetsBeginning"),
          c.beginning,
          prior?.changes.beginning.total,
        )}
        {totalRow(t("finance.ledgerReports.statementTables.transfersDirect"), c.direct, prior?.changes.direct.total)}
        {totalRow(t("finance.ledgerReports.statementTables.netAssetsEnd"), c.ending, prior?.changes.ending.total)}
      </tbody>
    </DataTable>
  );
}
