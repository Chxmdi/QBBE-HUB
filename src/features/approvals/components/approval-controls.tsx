"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Label, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import {
  commentOnApproval,
  decideApproval,
  deleteApprovalRule,
  setApprovalRuleActive,
  withdrawApproval,
} from "@/features/approvals/services/approval.commands";

type Action = "approve" | "reject" | "comment" | "withdraw";

const DONE: Record<Action, string> = {
  approve: "Approved.",
  reject: "Rejected.",
  comment: "Comment posted.",
  withdraw: "Request withdrawn.",
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
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState<Action | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const noteId = `approval-note-${itemId}`;

  async function run(action: Action) {
    setBusy(action);
    setError(null);
    const trimmed = note.trim();
    const result =
      action === "approve" || action === "reject"
        ? await decideApproval({ itemId, decision: action, note: trimmed || undefined })
        : action === "comment"
          ? await commentOnApproval({ itemId, note: trimmed })
          : await withdrawApproval({ itemId, note: trimmed || undefined });
    setBusy(null);
    if (!result.ok) {
      setError(result.error ?? "That didn't work. Try again.");
      return;
    }
    setNote("");
    toast.toast(DONE[action], { tone: "success" });
    router.refresh();
  }

  return (
    <div className="mt-4 space-y-2">
      <Label htmlFor={noteId}>
        {canDecide ? "Comment or reason (required to reject)" : "Comment"}
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
            <Button size="sm" disabled={busy !== null} onClick={() => run("approve")}>
              Approve
            </Button>
            <Button
              size="sm"
              variant="danger"
              disabled={busy !== null}
              onClick={() => run("reject")}
            >
              Reject
            </Button>
          </>
        ) : null}
        <Button
          size="sm"
          variant="secondary"
          disabled={busy !== null || note.trim() === ""}
          onClick={() => run("comment")}
        >
          {canDecide ? "Ask a question" : "Post comment"}
        </Button>
        {canWithdraw ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={busy !== null}
            onClick={() => run("withdraw")}
          >
            Withdraw request
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function RuleControls({ ruleId, active }: { ruleId: string; active: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = React.useState(false);

  async function run(action: () => Promise<{ ok: boolean; error?: string }>, done: string) {
    setBusy(true);
    const result = await action();
    setBusy(false);
    if (!result.ok) {
      toast.toast(result.error ?? "That didn't work. Try again.", { tone: "error" });
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
          run(() => setApprovalRuleActive(ruleId, !active), active ? "Rule switched off." : "Rule switched on.")
        }
      >
        {active ? "Switch off" : "Switch on"}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={busy}
        onClick={() => {
          if (!window.confirm("Delete this rule? Items already waiting keep their approvers.")) return;
          void run(() => deleteApprovalRule(ruleId), "Rule deleted.");
        }}
      >
        Delete
      </Button>
    </div>
  );
}
