import type { Metadata } from "next";
import Link from "next/link";
import { Download, Receipt } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { ReceiptList, type ReceiptRow } from "@/features/finance/components/receipt-list";
import { ReceiptSubmitDialog } from "@/features/finance/components/receipt-submit-dialog";
import { formatCents } from "@/features/finance/money";
import {
  parseReceiptFilters,
  receiptQuery,
} from "@/features/finance/services/receipt.queries";
import { requireStaff } from "@/lib/auth";
import { createSupabasePageClient } from "@/lib/supabase/page";

export const metadata: Metadata = { title: "Receipts" };
export const dynamic = "force-dynamic";

const PAGE_LIMIT = 500;

export default async function ReceiptsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireStaff();
  const params = await searchParams;
  const filters = parseReceiptFilters(params);
  const supabase = await createSupabasePageClient();

  const [{ data: receipts }, { data: programs }, { data: projects }] = await Promise.all([
    receiptQuery(supabase, filters, session.userId, PAGE_LIMIT),
    supabase.from("program").select("id, name").eq("status", "active").order("name"),
    supabase
      .from("project")
      .select("id, name, program_id")
      .is("archived_at", null)
      .order("name"),
  ]);

  const rows = (receipts ?? []) as unknown as ReceiptRow[];
  const totals = rows.reduce(
    (sum, r) => ({
      total: sum.total + Number(r.total_cents),
      gst: sum.gst + Number(r.gst_cents),
      qst: sum.qst + Number(r.qst_cents),
    }),
    { total: 0, gst: 0, qst: 0 },
  );
  const exportQuery = new URLSearchParams(
    Object.entries(params).filter((e): e is [string, string] => typeof e[1] === "string" && e[1] !== ""),
  ).toString();
  const filtered = Boolean(
    filters.from || filters.to || filters.programId || filters.status || filters.mine,
  );

  return (
    <div>
      <PageHeader
        eyebrow="Finance"
        title="Receipts"
        description={
          session.isAdmin
            ? "Every receipt and bill submitted in your organization. Mark each one reviewed once it is checked, and export the list for the accountant."
            : "Receipts and bills you have submitted. Photograph each one when you pay, so nothing needs to be kept on paper."
        }
        actions={
          <div className="flex items-center gap-3">
            <Link
              href={`/api/finance/receipts/export${exportQuery ? `?${exportQuery}` : ""}`}
              className="inline-flex items-center gap-1 text-[13px] font-medium text-brand-fg hover:underline"
              prefetch={false}
            >
              <Download className="size-4" aria-hidden />
              Export CSV
            </Link>
            <ReceiptSubmitDialog
              organizationId={session.organizationId}
              userId={session.userId}
              programs={(programs ?? []).map((p) => ({ id: p.id, label: p.name }))}
              projects={(projects ?? []).map((p) => ({
                id: p.id,
                label: p.name,
                programId: p.program_id,
              }))}
            />
          </div>
        }
      />

      <form
        method="get"
        className="card mb-4 grid grid-cols-2 items-end gap-3 p-4 sm:grid-cols-3 lg:grid-cols-6"
        aria-label="Filter receipts"
      >
        <div>
          <Label htmlFor="f-from">From</Label>
          <Input id="f-from" name="from" type="date" defaultValue={filters.from ?? ""} />
        </div>
        <div>
          <Label htmlFor="f-to">To</Label>
          <Input id="f-to" name="to" type="date" defaultValue={filters.to ?? ""} />
        </div>
        <div>
          <Label htmlFor="f-program">Program</Label>
          <Select id="f-program" name="program" defaultValue={filters.programId ?? ""}>
            <option value="">All programs</option>
            {(programs ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="f-status">Status</Label>
          <Select id="f-status" name="status" defaultValue={filters.status ?? ""}>
            <option value="">Any status</option>
            <option value="submitted">To review</option>
            <option value="reviewed">Reviewed</option>
          </Select>
        </div>
        {session.isAdmin ? (
          <div>
            <Label htmlFor="f-mine">Submitted by</Label>
            <Select id="f-mine" name="mine" defaultValue={filters.mine ? "1" : ""}>
              <option value="">Anyone</option>
              <option value="1">Me</option>
            </Select>
          </div>
        ) : null}
        <div className="flex gap-2">
          <Button type="submit" variant="secondary">
            Apply
          </Button>
          {filtered ? (
            <Link
              href="/finance/receipts"
              className="inline-flex h-9.5 items-center px-2 text-[13px] font-medium text-brand-fg hover:underline"
            >
              Clear
            </Link>
          ) : null}
        </div>
      </form>

      {rows.length === 0 ? (
        <EmptyState
          icon={<Receipt />}
          title={filtered ? "No receipts match these filters" : "No receipts yet"}
          description={
            filtered
              ? "Try a wider date range or clear the filters."
              : "Use Submit receipt to photograph a receipt or upload a bill."
          }
        />
      ) : (
        <>
          <p className="meta mb-2" aria-live="polite">
            {rows.length === PAGE_LIMIT ? `Showing the latest ${PAGE_LIMIT}. ` : ""}
            {rows.length} {rows.length === 1 ? "receipt" : "receipts"}: total{" "}
            {formatCents(totals.total)}, GST {formatCents(totals.gst)}, QST{" "}
            {formatCents(totals.qst)}.
          </p>
          <ReceiptList rows={rows} canReview={session.isAdmin} />
        </>
      )}
    </div>
  );
}
