/**
 * The approval chain behind a journal entry (#154 follow-up, #143), as
 * returned by `ledger_entry_approvals`: one row per recorded approval event,
 * plus one "waiting" row per step still to decide. Grouped here by approval
 * item so the page can show each chain in order.
 */

import { createTranslator, type MessageKey, type TranslateFn } from "@/lib/i18n/translate";

export interface ApprovalChainRow {
  item_id: string;
  item_title: string;
  item_status: "pending" | "approved" | "rejected" | "withdrawn";
  item_amount_cents: number | null;
  item_created_at: string;
  occurred_at: string | null;
  kind: "submitted" | "approved" | "rejected" | "commented" | "withdrawn" | "completed" | "waiting";
  step: number | null;
  step_label: string | null;
  actor_name: string;
  note: string | null;
}

export interface ApprovalChainStep {
  kind: ApprovalChainRow["kind"];
  /** "Approved by QA Admin", "Waiting for QA Owner". */
  text: string;
  /** "Step 1, Treasurer" when the event belongs to a step. */
  stepText: string | null;
  note: string | null;
  occurredAt: string | null;
}

export interface ApprovalChain {
  itemId: string;
  title: string;
  status: ApprovalChainRow["item_status"];
  amountCents: number | null;
  steps: ApprovalChainStep[];
}

const VERB: Record<Exclude<ApprovalChainRow["kind"], "completed">, MessageKey> = {
  submitted: "finance.ledger.approval.verb.submitted",
  approved: "finance.ledger.approval.verb.approved",
  rejected: "finance.ledger.approval.verb.rejected",
  commented: "finance.ledger.approval.verb.commented",
  withdrawn: "finance.ledger.approval.verb.withdrawn",
  waiting: "finance.ledger.approval.verb.waiting",
};

/** The catalogue key for each approval status, for `t()` (#141). */
export const APPROVAL_STATUS_KEY: Record<ApprovalChainRow["item_status"], MessageKey> = {
  pending: "finance.ledger.approval.status.pending",
  approved: "finance.ledger.approval.status.approved",
  rejected: "finance.ledger.approval.status.rejected",
  withdrawn: "finance.ledger.approval.status.withdrawn",
};

const ENGLISH = createTranslator("en");

/**
 * Groups rows by approval item, keeping the order the database returned.
 * Pass the reader's `t()` for their language; English is the default.
 */
export function groupApprovalChain(rows: ApprovalChainRow[], t: TranslateFn = ENGLISH): ApprovalChain[] {
  const chains: ApprovalChain[] = [];
  const byItem = new Map<string, ApprovalChain>();
  for (const r of rows) {
    let chain = byItem.get(r.item_id);
    if (!chain) {
      chain = {
        itemId: r.item_id,
        title: r.item_title,
        status: r.item_status,
        amountCents: r.item_amount_cents === null ? null : Number(r.item_amount_cents),
        steps: [],
      };
      byItem.set(r.item_id, chain);
      chains.push(chain);
    }
    chain.steps.push({
      kind: r.kind,
      // "Approval complete" is the engine's own closing event; it has no person.
      text:
        r.kind === "completed"
          ? t("finance.ledger.approval.completed")
          : t(VERB[r.kind], { name: r.actor_name }),
      stepText:
        r.step === null
          ? null
          : r.step_label
            ? t("finance.ledger.approval.stepWithLabel", { step: r.step, label: r.step_label })
            : t("finance.ledger.approval.step", { step: r.step }),
      note: r.note,
      occurredAt: r.occurred_at,
    });
  }
  return chains;
}

/** Journal entry sources that can carry an approval (bills and payments). */
export function sourceHasApprovals(sourceType: string | null): boolean {
  return sourceType === "finance_bill" || sourceType === "finance_payment";
}
