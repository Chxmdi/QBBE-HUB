"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Label, Textarea } from "@/components/ui/input";
import { decideApproval } from "@/features/approvals/services/approval.commands";
import { usePhoneStatus } from "./phone-status";
import { useMobileT } from "./use-mobile-t";

/** One waiting approval, decided with the ordinary approval action. */
export function ApprovalCard({ id, title, requester, amount }: { id: string; title: string; requester: string | null; amount: string | null }) {
  const t = useMobileT();
  const router = useRouter();
  const fieldId = useId();
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [localStatus, setLocalStatus] = useState<{ ok: boolean; text: string } | null>(null);
  // On the phone screens the layout shows it: the refresh below drops a
  // decided item from the list, and with it any message shown on its card.
  const phoneStatus = usePhoneStatus();
  const setStatus = phoneStatus ?? setLocalStatus;
  const status = phoneStatus ? null : localStatus;

  async function decide(decision: "approve" | "reject") {
    setBusy(true);
    const result = await decideApproval({ itemId: id, decision, note: decision === "reject" ? note : undefined });
    setBusy(false);
    setStatus({
      ok: result.ok,
      text: result.ok ? (decision === "approve" ? t("approvals.approved") : t("approvals.rejected")) : (result.error ?? t("approvals.error")),
    });
    if (result.ok) router.refresh();
  }

  return (
    <li className="card space-y-3 p-4">
      <div>
        <p className="break-words text-sm font-medium text-ink">{title}</p>
        <p className="text-[12.5px] text-muted">
          {requester ? t("approvals.from", { name: requester }) : null}
          {amount ? ` · ${amount}` : ""}
        </p>
      </div>
      {rejecting ? (
        <div className="space-y-2">
          <Label htmlFor={fieldId}>{t("approvals.reasonLabel", { title })}</Label>
          <Textarea id={fieldId} value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={2000} />
          <Button variant="danger" className="h-11 w-full" disabled={!note.trim()} loading={busy} onClick={() => decide("reject")}>
            {t("approvals.confirmReject")}
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <Button className="h-11" loading={busy} onClick={() => decide("approve")} aria-label={t("approvals.approve", { title })}>
            {t("approvals.approveShort")}
          </Button>
          <Button variant="secondary" className="h-11" onClick={() => setRejecting(true)}>{t("approvals.reject")}</Button>
        </div>
      )}
      {status ? (
        <p role={status.ok ? "status" : "alert"} className={status.ok ? "text-[12.5px] text-success-fg" : "text-[12.5px] text-danger-fg"}>
          {status.text}
        </p>
      ) : null}
    </li>
  );
}
