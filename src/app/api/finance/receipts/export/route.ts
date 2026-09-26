import { requireStaff } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { centsToDecimal, csvField } from "@/features/finance/money";
import {
  parseReceiptFilters,
  receiptQuery,
} from "@/features/finance/services/receipt.queries";

/**
 * Receipts as CSV for the accountant (#142). Read through the caller's own
 * client, so row-level security decides which rows are included: staff get
 * their own, owners/admins with MFA get the organization's. Text fields are
 * neutralised against spreadsheet formula injection.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EXPORT_LIMIT = 10000;

interface ExportRow {
  id: string;
  kind: string;
  document_date: string;
  vendor: string;
  total_cents: number;
  gst_cents: number;
  qst_cents: number;
  note: string | null;
  file_name: string;
  scan_status: string;
  status: string;
  reviewed_at: string | null;
  created_at: string;
  submitter: { full_name: string } | null;
  program: { name: string } | null;
  project: { name: string } | null;
}

const HEADER = [
  "Date",
  "Type",
  "Paid to",
  "Total",
  "GST",
  "QST",
  "Program",
  "Project",
  "Note",
  "Submitted by",
  "Submitted at",
  "Status",
  "Reviewed at",
  "File",
  "File check",
  "Receipt ID",
];

export async function GET(request: Request) {
  const session = await requireStaff();
  const url = new URL(request.url);
  const filters = parseReceiptFilters(Object.fromEntries(url.searchParams));
  const supabase = await createSupabaseServerClient();
  const { data, error } = await receiptQuery(supabase, filters, session.userId, EXPORT_LIMIT);
  if (error) {
    return new Response("Could not export receipts. Try again.", { status: 500 });
  }

  const lines = [HEADER.map(csvField).join(",")];
  for (const r of (data ?? []) as unknown as ExportRow[]) {
    lines.push(
      [
        r.document_date,
        r.kind === "bill" ? "Bill" : "Receipt",
        r.vendor,
        centsToDecimal(Number(r.total_cents)),
        centsToDecimal(Number(r.gst_cents)),
        centsToDecimal(Number(r.qst_cents)),
        r.program?.name ?? "",
        r.project?.name ?? "",
        r.note ?? "",
        r.submitter?.full_name ?? "",
        r.created_at,
        r.status === "reviewed" ? "Reviewed" : "To review",
        r.reviewed_at ?? "",
        r.file_name,
        r.scan_status,
        r.id,
      ]
        .map(csvField)
        .join(","),
    );
  }

  await supabase.from("audit_event").insert({
    organization_id: session.organizationId,
    actor_id: session.userId,
    event_type: "finance",
    action: "receipts_exported",
    object_type: "finance_receipt",
    metadata: { rows: lines.length - 1, filters },
  });

  const stamp = new Date().toISOString().slice(0, 10);
  // The byte-order mark makes Excel read accents (Montréal, Café) correctly.
  return new Response(`﻿${lines.join("\r\n")}\r\n`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="receipts-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
