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

const scanLabel: Record<ReceiptRow["scan_status"], string> = {
  pending: "Security check pending",
  clean: "",
  quarantined: "Quarantined",
  rejected: "Rejected by security check",
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
  const [busy, setBusy] = useState<string | null>(null);

  async function openFile(id: string) {
    setBusy(id);
    const result = await openReceiptFile(id);
    setBusy(null);
    if (!result.ok || !result.url) {
      toast(result.error ?? "Could not open the file.", { tone: "error" });
      return;
    }
    window.open(result.url, "_blank", "noopener,noreferrer");
  }

  async function toggleReviewed(row: ReceiptRow) {
    setBusy(row.id);
    const result = await setReceiptReviewed(row.id, row.status !== "reviewed");
    setBusy(null);
    if (!result.ok) {
      toast(result.error ?? "Could not update the receipt.", { tone: "error" });
      return;
    }
    toast(row.status === "reviewed" ? "Receipt reopened." : "Receipt marked reviewed.");
    router.refresh();
  }

  return (
    <DataTable minWidth="960px">
      <TableHead>
        <TableHeader>Date</TableHeader>
        <TableHeader>Paid to</TableHeader>
        <TableHeader className="text-right">Total</TableHeader>
        <TableHeader className="text-right">GST</TableHeader>
        <TableHeader className="text-right">QST</TableHeader>
        <TableHeader>Program / project</TableHeader>
        <TableHeader>Submitted by</TableHeader>
        <TableHeader>Status</TableHeader>
        <TableHeader>File</TableHeader>
      </TableHead>
      <tbody>
        {rows.map((r) => (
          <TableRow key={r.id} id={`receipt-${r.id}`}>
            <TableCell className="whitespace-nowrap tabular-nums">{r.document_date}</TableCell>
            <TableCell>
              <span className="font-medium">{r.vendor}</span>
              {r.kind === "bill" ? (
                <Badge tone="info" className="ml-2">
                  Bill
                </Badge>
              ) : null}
              {r.note ? <p className="meta line-clamp-1">{r.note}</p> : null}
            </TableCell>
            <TableCell className="text-right tabular-nums">{formatCents(r.total_cents)}</TableCell>
            <TableCell className="text-right tabular-nums">{formatCents(r.gst_cents)}</TableCell>
            <TableCell className="text-right tabular-nums">{formatCents(r.qst_cents)}</TableCell>
            <TableCell>
              {[r.program?.name, r.project?.name].filter(Boolean).join(" / ") || "—"}
            </TableCell>
            <TableCell>{r.submitter?.full_name ?? "—"}</TableCell>
            <TableCell>
              <div className="flex items-center gap-2">
                <Badge tone={r.status === "reviewed" ? "success" : "warning"}>
                  {r.status === "reviewed" ? "Reviewed" : "To review"}
                </Badge>
                {canReview ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy === r.id}
                    onClick={() => toggleReviewed(r)}
                    aria-label={
                      r.status === "reviewed"
                        ? `Reopen receipt from ${r.vendor}`
                        : `Mark receipt from ${r.vendor} reviewed`
                    }
                  >
                    {r.status === "reviewed" ? "Reopen" : "Mark reviewed"}
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
                  aria-label={`Open ${r.file_name}`}
                >
                  Open
                </Button>
              ) : (
                <Badge tone={r.scan_status === "pending" ? "neutral" : "danger"}>
                  {scanLabel[r.scan_status]}
                </Badge>
              )}
            </TableCell>
          </TableRow>
        ))}
      </tbody>
    </DataTable>
  );
}
