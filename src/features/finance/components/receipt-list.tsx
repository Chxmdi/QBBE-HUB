"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DataTable,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { formatCents } from "@/features/finance/money";
import { useLocale, useT } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/translate";
import {
  openReceiptFile,
  setReceiptReviewed,
} from "@/features/finance/services/receipt.commands";

export interface ReceiptRow {
  id: string;
  kind: "receipt" | "bill";
  document_date: string;
  vendor: string;
  total_cents: number;
  gst_cents: number;
  qst_cents: number;
  note: string | null;
  file_name: string;
  scan_status: "pending" | "clean" | "quarantined" | "rejected";
  status: "submitted" | "reviewed";
  submitted_by: string;
  submitter: { full_name: string } | null;
  program: { name: string } | null;
  project: { name: string } | null;
}

const scanLabel: Record<Exclude<ReceiptRow["scan_status"], "clean">, MessageKey> = {
  pending: "finance.receipts.list.scanPending",
  quarantined: "finance.receipts.list.scanQuarantined",
  rejected: "finance.receipts.list.scanRejected",
};

export function ReceiptList({
  rows,
  canReview,
}: {
  rows: ReceiptRow[];
  canReview: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const t = useT();
  const locale = useLocale();
  const [busy, setBusy] = useState<string | null>(null);

  async function openFile(id: string) {
    setBusy(id);
    const result = await openReceiptFile(id);
    setBusy(null);
    if (!result.ok || !result.url) {
      toast(result.error ?? t("finance.receipts.list.openFailed"), { tone: "error" });
      return;
    }
    window.open(result.url, "_blank", "noopener,noreferrer");
  }

  async function toggleReviewed(row: ReceiptRow) {
    setBusy(row.id);
    const result = await setReceiptReviewed(row.id, row.status !== "reviewed");
    setBusy(null);
    if (!result.ok) {
      toast(result.error ?? t("finance.receipts.list.updateFailed"), { tone: "error" });
      return;
    }
    toast(
      row.status === "reviewed"
        ? t("finance.receipts.list.reopened")
        : t("finance.receipts.list.markedReviewed"),
    );
    router.refresh();
  }

  return (
    <DataTable minWidth="960px">
      <TableHead>
        <TableHeader>{t("finance.receipts.list.date")}</TableHeader>
        <TableHeader>{t("finance.receipts.list.paidTo")}</TableHeader>
        <TableHeader className="text-right">{t("finance.receipts.list.total")}</TableHeader>
        <TableHeader className="text-right">{t("finance.receipts.list.gst")}</TableHeader>
        <TableHeader className="text-right">{t("finance.receipts.list.qst")}</TableHeader>
        <TableHeader>{t("finance.receipts.list.programProject")}</TableHeader>
        <TableHeader>{t("finance.receipts.list.submittedBy")}</TableHeader>
        <TableHeader>{t("finance.receipts.list.status")}</TableHeader>
        <TableHeader>{t("finance.receipts.list.file")}</TableHeader>
      </TableHead>
      <tbody>
        {rows.map((r) => (
          <TableRow key={r.id} id={`receipt-${r.id}`}>
            <TableCell className="whitespace-nowrap tabular-nums">{r.document_date}</TableCell>
            <TableCell>
              <span className="font-medium">{r.vendor}</span>
              {r.kind === "bill" ? (
                <Badge tone="info" className="ml-2">
                  {t("finance.receipts.list.bill")}
                </Badge>
              ) : null}
              {r.note ? <p className="meta line-clamp-1">{r.note}</p> : null}
            </TableCell>
            <TableCell className="text-right tabular-nums">{formatCents(r.total_cents, locale)}</TableCell>
            <TableCell className="text-right tabular-nums">{formatCents(r.gst_cents, locale)}</TableCell>
            <TableCell className="text-right tabular-nums">{formatCents(r.qst_cents, locale)}</TableCell>
            <TableCell>
              {[r.program?.name, r.project?.name].filter(Boolean).join(" / ") || "—"}
            </TableCell>
            <TableCell>{r.submitter?.full_name ?? "—"}</TableCell>
            <TableCell>
              <div className="flex items-center gap-2">
                <Badge tone={r.status === "reviewed" ? "success" : "warning"}>
                  {r.status === "reviewed"
                    ? t("finance.receipts.list.reviewed")
                    : t("finance.receipts.list.toReview")}
                </Badge>
                {canReview ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy === r.id}
                    onClick={() => toggleReviewed(r)}
                    aria-label={
                      r.status === "reviewed"
                        ? t("finance.receipts.list.reopenLabel", { vendor: r.vendor })
                        : t("finance.receipts.list.markReviewedLabel", { vendor: r.vendor })
                    }
                  >
                    {r.status === "reviewed"
                      ? t("finance.receipts.list.reopen")
                      : t("finance.receipts.list.markReviewed")}
                  </Button>
                ) : null}
              </div>
            </TableCell>
            <TableCell>
              {r.scan_status === "clean" ? (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy === r.id}
                  onClick={() => openFile(r.id)}
                  aria-label={t("finance.receipts.list.openLabel", { file: r.file_name })}
                >
                  {t("finance.receipts.list.open")}
                </Button>
              ) : (
                <Badge tone={r.scan_status === "pending" ? "neutral" : "danger"}>
                  {t(scanLabel[r.scan_status])}
                </Badge>
              )}
            </TableCell>
          </TableRow>
        ))}
      </tbody>
    </DataTable>
  );
}
