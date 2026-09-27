import { csvField } from "@/features/ledger/money";
import { dateParam, todayIn } from "@/features/ledger/services/ledger.access";
import { authorizeLedgerExport, csvResponse } from "@/features/ledger/services/ledger.export";
import { exportLines } from "@/features/ledger/services/year-end.queries";
import { journalImportCsv } from "@/features/ledger/year-end";
import { getT } from "@/lib/i18n/server";
import type { TranslateFn } from "@/lib/i18n/translate";

/**
 * Every posted line between two dates as a plain CSV the accountant's
 * software can import (#154): date, entry no, account code and name, fund,
 * program, description, debit, credit. Refused, never cut short, when too big.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The column names in the requester's language (#141). The rows below stay
 * machine-friendly: ISO dates, codes and plain decimals.
 */
function withTranslatedHeader(csv: string, t: TranslateFn): string {
  const header = [
    t("finance.ledger.export.columns.date"),
    t("finance.ledger.export.columns.entryNo"),
    t("finance.ledger.export.columns.accountCode"),
    t("finance.ledger.export.columns.accountName"),
    t("finance.ledger.export.columns.fund"),
    t("finance.ledger.export.columns.program"),
    t("finance.ledger.export.columns.description"),
    t("finance.ledger.export.columns.debit"),
    t("finance.ledger.export.columns.credit"),
  ]
    .map(csvField)
    .join(",");
  // journalImportCsv starts with a byte-order mark and one header line.
  const firstLineEnd = csv.indexOf("\r\n");
  return `﻿${header}${csv.slice(firstLineEnd)}`;
}

export async function GET(request: Request) {
  const t = await getT();
  const access = await authorizeLedgerExport();
  if (!access) return new Response(t("finance.ledger.export.noAccess"), { status: 403 });
  const { session, supabase } = access;
  const url = new URL(request.url);
  const to = dateParam(url.searchParams.get("to") ?? undefined, todayIn(session.timeZone));
  const from = dateParam(url.searchParams.get("from") ?? undefined, `${to.slice(0, 4)}-01-01`);
  if (from > to) return new Response(t("finance.ledger.export.startAfterEnd"), { status: 400 });
  const { lines, error, tooMany } = await exportLines(supabase, session.organizationId, from, to);
  if (error) return new Response(t("finance.ledger.export.failed"), { status: 500 });
  if (tooMany) return new Response(t("finance.ledger.export.tooMany"), { status: 413 });
  return csvResponse(
    supabase,
    session,
    "journal_import_exported",
    withTranslatedHeader(journalImportCsv(lines), t),
    `general-ledger-import-${from}-to-${to}.csv`,
    { from, to, rows: lines.length },
  );
}
