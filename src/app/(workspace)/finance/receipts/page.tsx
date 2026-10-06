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
import { getLocale, getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("finance.receipts.title") };
}
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
  const [t, locale] = await Promise.all([getT(), getLocale()]);
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
        eyebrow={t("finance.receipts.page.eyebrow")}
        title={t("finance.receipts.title")}
        description={
          session.isAdmin
            ? t("finance.receipts.page.descriptionAdmin")
            : t("finance.receipts.page.descriptionStaff")
        }
        actions={
          <div className="flex items-center gap-3">
            <Link
              href={`/api/finance/receipts/export${exportQuery ? `?${exportQuery}` : ""}`}
              className="inline-flex items-center gap-1 text-[13px] font-medium text-brand-fg hover:underline"
              prefetch={false}
            >
              <Download className="size-4" aria-hidden />
              {t("finance.receipts.page.exportCsv")}
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
        aria-label={t("finance.receipts.page.filterLabel")}
      >
        <div>
          <Label htmlFor="f-from">{t("finance.receipts.page.from")}</Label>
          <Input id="f-from" name="from" type="date" defaultValue={filters.from ?? ""} />
        </div>
        <div>
          <Label htmlFor="f-to">{t("finance.receipts.page.to")}</Label>
          <Input id="f-to" name="to" type="date" defaultValue={filters.to ?? ""} />
        </div>
        <div>
          <Label htmlFor="f-program">{t("finance.receipts.page.program")}</Label>
          <Select id="f-program" name="program" defaultValue={filters.programId ?? ""}>
            <option value="">{t("finance.receipts.page.allPrograms")}</option>
            {(programs ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="f-status">{t("finance.receipts.page.status")}</Label>
          <Select id="f-status" name="status" defaultValue={filters.status ?? ""}>
            <option value="">{t("finance.receipts.page.anyStatus")}</option>
            <option value="submitted">{t("finance.receipts.page.toReview")}</option>
            <option value="reviewed">{t("finance.receipts.page.reviewed")}</option>
          </Select>
        </div>
        {session.isAdmin ? (
          <div>
            <Label htmlFor="f-mine">{t("finance.receipts.page.submittedBy")}</Label>
            <Select id="f-mine" name="mine" defaultValue={filters.mine ? "1" : ""}>
              <option value="">{t("finance.receipts.page.anyone")}</option>
              <option value="1">{t("finance.receipts.page.me")}</option>
            </Select>
          </div>
        ) : null}
        <div className="flex gap-2">
          <Button type="submit" variant="secondary">
            {t("finance.receipts.page.apply")}
          </Button>
          {filtered ? (
            <Link
              href="/finance/receipts"
              className="inline-flex h-9.5 items-center px-2 text-[13px] font-medium text-brand-fg hover:underline"
            >
              {t("finance.receipts.page.clear")}
            </Link>
          ) : null}
        </div>
      </form>

      {rows.length === 0 ? (
        <EmptyState
          icon={<Receipt />}
          title={
            filtered
              ? t("finance.receipts.page.emptyFilteredTitle")
              : t("finance.receipts.page.emptyTitle")
          }
          description={
            filtered
              ? t("finance.receipts.page.emptyFilteredDescription")
              : t("finance.receipts.page.emptyDescription")
          }
        />
      ) : (
        <>
          <p className="meta mb-2" aria-live="polite">
            {rows.length === PAGE_LIMIT
              ? t("finance.receipts.page.showingLatest", { limit: PAGE_LIMIT })
              : ""}
            {t(
              rows.length === 1
                ? "finance.receipts.page.summaryOne"
                : "finance.receipts.page.summaryOther",
              {
                count: rows.length,
                total: formatCents(totals.total, locale),
                gst: formatCents(totals.gst, locale),
                qst: formatCents(totals.qst, locale),
              },
            )}
          </p>
          <ReceiptList rows={rows} canReview={session.isAdmin} />
        </>
      )}
    </div>
  );
}
