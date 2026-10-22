import type { DbErrorRule } from "@/lib/db-error";

/**
 * The approval and delegation refusals people can meet, as the database words them, each
 * with its catalogue key. Anything not listed reaches the reader as the
 * action's generic message (and is logged), never as raw database text.
 * Groups capture the values the sentence carries, in the order of `params`;
 * a value the database writes in English (a label) is captured but not shown.
 */
export const APPROVAL_DB_ERRORS: readonly DbErrorRule[] = [
  { key: "finance.approvals.dbErrors.commentLength", pattern: /^(?:A comment needs between 1 and 2000 characters)$/ },
  { key: "finance.approvals.dbErrors.delegationWindow", pattern: /^(?:A delegation starts between today and one year from today and lasts at most a year)$/ },
  { key: "finance.approvals.dbErrors.rejectionReason", pattern: /^(?:A rejection needs a reason)$/ },
  { key: "finance.approvals.dbErrors.delegateSelf", pattern: /^(?:Choose someone other than the approver as the delegate)$/ },
  { key: "finance.approvals.dbErrors.staffSubmit", pattern: /^(?:Only staff can submit items for approval)$/ },
  { key: "finance.approvals.dbErrors.endDelegation", pattern: /^(?:Only the approver, or an owner or administrator with MFA, can end a delegation)$/ },
  { key: "finance.approvals.dbErrors.setDelegation", pattern: /^(?:Only the approver, or an owner or administrator with MFA, can set a delegate)$/ },
  { key: "finance.approvals.dbErrors.requesterWithdraw", pattern: /^(?:Only the requester can withdraw a request)$/ },
  { key: "finance.approvals.dbErrors.programOrg", pattern: /^(?:Program is not in this organization)$/ },
  { key: "finance.approvals.dbErrors.notAvailable", pattern: /^(?:That approval is not available to you)$/ },
  { key: "finance.approvals.dbErrors.alreadySettled", pattern: /^(?:(?:That approval was already settled|This approval request has already been decided\.))$/ },
  { key: "finance.approvals.dbErrors.bothActive", pattern: /^(?:The approver and the delegate must both be active staff members or administrators)$/ },
  { key: "finance.approvals.dbErrors.approverCovering", pattern: /^(?:The approver is covering for someone else for some of those dates; delegations cannot be passed on)$/ },
  { key: "finance.approvals.dbErrors.approverActive", pattern: /^(?:The approver must be an active staff member or administrator)$/ },
  { key: "finance.approvals.dbErrors.delegateAway", pattern: /^(?:The delegate is away themselves for some of those dates; delegations cannot be passed on)$/ },
  { key: "finance.approvals.dbErrors.lastDay", pattern: /^(?:The last day must be on or after the first day)$/ },
  { key: "finance.approvals.dbErrors.noteTooLong", pattern: /^(?:The note is too long)$/ },
  { key: "finance.approvals.dbErrors.alreadyDelegated", pattern: /^(?:This approver already has a delegate for some of those dates)$/ },
  { key: "finance.approvals.dbErrors.notApprover", pattern: /^(?:You are not an approver for this step)$/ },
  { key: "finance.approvals.dbErrors.ownRequest", pattern: /^(?:(?:You cannot approve or reject your own request|Nobody approves their own request\.))$/ },
  { key: "finance.approvals.dbErrors.draftedBill", pattern: /^(?:You drafted this bill, so someone else approves or rejects it)$/ },
];
