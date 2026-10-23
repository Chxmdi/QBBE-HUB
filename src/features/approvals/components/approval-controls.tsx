"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Label, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { useT } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/translator";
import { runServerAction } from "@/lib/use-server-action";
import {
  commentOnApproval,
  decideApproval,
  deleteApprovalRule,
  endApprovalDelegation,
  setApprovalRuleActive,
  withdrawApproval,
} from "@/features/approvals/services/approval.commands";

type Action = "approve" | "reject" | "comment" | "withdraw";

const DONE: Record<Action, MessageKey> = {
  approve: "finance.approvals.actions.doneApprove",
  reject: "finance.approvals.actions.doneReject",
  comment: "finance.approvals.actions.doneComment",
  withdraw: "finance.approvals.actions.doneWithdraw",
};

/**
 * One note box and the buttons the reader is allowed to use. The database
 * checks every one of them again; hiding a button is only a courtesy.
 */
export function ApprovalActions({
  itemId,
  canDecide,
  canWithdraw,
}: {
  itemId: string;
  canDecide: boolean;
  canWithdraw: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const t = useT();
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState<Action | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const noteId = `approval-note-${itemId}`;

  async function run(action: Action) {
    const trimmed = note.trim();
    const result = await runServerAction(
      () =>
        action === "approve" || action === "reject"
          ? decideApproval({ itemId, decision: action, note: trimmed || undefined })
          : action === "comment"
            ? commentOnApproval({ itemId, note: trimmed })
            : withdrawApproval({ itemId, note: trimmed || undefined }),
      { setBusy: (on) => setBusy(on ? action : null), setError, t, reload: () => window.location.reload() },
    );
    if (!result) return;
    if (!result.ok) {
      setError(result.error ?? t("finance.approvals.errors.generic"));
      return;
    }
    setNote("");
    toast.toast(t(DONE[action]), { tone: "success" });
    router.refresh();
  }

  return (
    <div className="mt-4 space-y-2">
      <Label htmlFor={noteId}>
        {canDecide ? t("finance.approvals.actions.noteLabelDecide") : t("finance.approvals.actions.noteLabel")}
      </Label>
      <Textarea
        id={noteId}
        rows={3}
        maxLength={2000}
        value={note}
        onChange={(event) => setNote(event.currentTarget.value)}
      />
      {error ? (
        <p role="alert" className="text-[12.5px] text-danger-fg">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {canDecide ? (
          <>
            <Button size="sm" disabled={busy !== null} onClick={() => void run("approve")}>
              {t("finance.approvals.actions.approve")}
            </Button>
            <Button
              size="sm"
              variant="danger"
              disabled={busy !== null}
              onClick={() => void run("reject")}
            >
              {t("finance.approvals.actions.reject")}
            </Button>
          </>
        ) : null}
        <Button
          size="sm"
          variant="secondary"
          disabled={busy !== null || note.trim() === ""}
          onClick={() => void run("comment")}
        >
          {canDecide ? t("finance.approvals.actions.askQuestion") : t("finance.approvals.actions.postComment")}
        </Button>
        {canWithdraw ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={busy !== null}
            onClick={() => void run("withdraw")}
          >
            {t("finance.approvals.actions.withdraw")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function RuleControls({ ruleId, active }: { ruleId: string; active: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const t = useT();
  const [busy, setBusy] = React.useState(false);
  const showError = (text: string | null) => {
    if (text) toast.toast(text, { tone: "error" });
  };

  async function run(action: () => Promise<{ ok: boolean; error?: string }>, done: string) {
    const result = await runServerAction(action, { setBusy, setError: showError, t, reload: () => window.location.reload() });
    if (!result) return;
    if (!result.ok) {
      toast.toast(result.error ?? t("finance.approvals.errors.generic"), { tone: "error" });
      return;
    }
    toast.toast(done, { tone: "success" });
    router.refresh();
  }

  return (
    <div className="flex flex-wrap justify-end gap-2">
      <Button
        size="sm"
        variant="secondary"
        disabled={busy}
        onClick={() =>
          void run(
            () => setApprovalRuleActive(ruleId, !active),
            active ? t("finance.approvals.rules.switchedOff") : t("finance.approvals.rules.switchedOn"),
          )
        }
      >
        {active ? t("finance.approvals.rules.switchOff") : t("finance.approvals.rules.switchOn")}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={busy}
        onClick={() => {
          if (!window.confirm(t("finance.approvals.rules.confirmDelete"))) return;
          void run(() => deleteApprovalRule(ruleId), t("finance.approvals.rules.deleted"));
        }}
      >
        {t("finance.approvals.rules.delete")}
      </Button>
    </div>
  );
}

/** Ends a delegation now, or cancels one that has not started. */
export function EndDelegationButton({ delegationId, label }: { delegationId: string; label: string }) {
  const router = useRouter();
  const toast = useToast();
  const t = useT();
  const [busy, setBusy] = React.useState(false);
  const showError = (text: string | null) => {
    if (text) toast.toast(text, { tone: "error" });
  };

  async function end() {
    const result = await runServerAction(() => endApprovalDelegation(delegationId), {
      setBusy,
      setError: showError,
      t,
      reload: () => window.location.reload(),
    });
    if (!result) return;
    if (!result.ok) {
      toast.toast(result.error ?? t("finance.approvals.errors.generic"), { tone: "error" });
      return;
    }
    toast.toast(t("finance.approvals.away.ended"), { tone: "success" });
    router.refresh();
  }

  return (
    <Button size="sm" variant="secondary" disabled={busy} onClick={() => void end()}>
      {label}
    </Button>
  );
}
