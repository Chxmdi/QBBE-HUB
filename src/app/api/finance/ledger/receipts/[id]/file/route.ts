import { uuidParam } from "@/features/ledger/services/ledger.access";
import { authorizeLedgerExport } from "@/features/ledger/services/ledger.export";
import { getT } from "@/lib/i18n/server";
import { auditUnavailableResponse, recordAudit } from "@/lib/audit-write";

/**
 * Opens a receipt's file for someone who may read the books (#154), through a
 * one-minute signed link. Storage policies release only files scanned clean;
 * every opening is audited.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await authorizeLedgerExport();
  const t = await getT();
  if (!access) return new Response(t("finance.ledgerReports.api.noAccess"), { status: 403 });
  const { session, supabase } = access;
  const id = uuidParam((await params).id);
  if (!id) return new Response(t("finance.ledgerReports.api.receiptNotFound"), { status: 404 });
  const { data: receipt } = await supabase
    .from("finance_receipt")
    .select("id, storage_path, scan_status")
    .eq("id", id)
    .maybeSingle();
  if (!receipt) return new Response(t("finance.ledgerReports.api.receiptNotFound"), { status: 404 });
  if (receipt.scan_status !== "clean") {
    return new Response(t("finance.ledgerReports.api.fileNotClean"), { status: 409 });
  }
  const { data: signed, error } = await supabase.storage
    .from("receipts")
    .createSignedUrl(receipt.storage_path as string, 60);
  if (error || !signed) return new Response(t("finance.ledgerReports.api.fileOpenFailed"), { status: 502 });
  const audited = await recordAudit(supabase, {
    organization_id: session.organizationId,
    actor_id: session.userId,
    event_type: "ledger",
    action: "receipt_file_opened",
    object_type: "finance_receipt",
    object_id: id,
  });
  // No file without a record of who took it.
  if (!audited) return auditUnavailableResponse();
  return new Response(null, { status: 303, headers: { Location: signed.signedUrl, "Cache-Control": "no-store" } });
}
