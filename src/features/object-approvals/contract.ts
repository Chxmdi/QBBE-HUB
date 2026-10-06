import { z } from "zod";
import type { ActionDefinition, Change, Uuid } from "@/lib/objects/contracts";

/**
 * Approvals on any object (Workspace OS V2-7), as the object layer sees them.
 *
 * Contract additions, for integration and stream S6 to adopt:
 *
 * 1. `object.request_approval`: an ActionDefinition for the action registry.
 *    A workflow's existing `action` step can run it today. It calls
 *    `public.request_object_approval`, which hands the request to the existing
 *    approval engine (routing rules, delegation, notifications, audit).
 *
 * 2. The approval *wait* step: `approvalStepSchema` and `approvalStepState`.
 *    A workflow step of kind "approval" starts a request, is "waiting" while
 *    the item is pending, then continues on `onApproved` or `onRejected`. The
 *    engine (src/features/workflows) has the "waiting" status already; this
 *    module supplies the step's shape and how an item's status maps to it.
 */

export const approvableTypes = ["task", "project", "meeting", "decision"] as const;
export type ApprovableType = (typeof approvableTypes)[number];

export function isApprovableType(value: string): value is ApprovableType {
  return (approvableTypes as readonly string[]).includes(value);
}

export interface RequestApprovalInput {
  object: { type: ApprovableType; id: Uuid };
  /** Defaults to the object's own title. */
  title?: string;
  note?: string;
}

type Rpc = (
  fn: "request_object_approval",
  args: { p_object_type: string; p_object_id: string; p_title: string | null; p_note: string | null },
) => PromiseLike<{ data: unknown; error: { message: string } | null }>;

export const REQUEST_APPROVAL_ACTION_KEY = "object.request_approval";

export function requestApprovalAction(rpc: Rpc): ActionDefinition<RequestApprovalInput> {
  return {
    key: REQUEST_APPROVAL_ACTION_KEY,
    label: { en: "Request approval", fr: "Demander une approbation" },
    capability: "edit_content",
    // Who may request is the SQL function's own rule (app.object_approval_access
    // 'change': edit_content on a task or project, meeting management for a
    // meeting or its decisions), not plain edit_content on every type. So the
    // registry has nothing to pre-check; the function refuses, and the
    // change set then names the item and its link to the record.
    targets: () => [],
    async run(_context, input): Promise<Change[]> {
      if (!isApprovableType(input.object.type)) throw new Error(`Approvals are not available for ${input.object.type}.`);
      const { data, error } = await rpc("request_object_approval", {
        p_object_type: input.object.type,
        p_object_id: input.object.id,
        p_title: input.title?.trim() || null,
        p_note: input.note?.trim() || null,
      });
      if (error || typeof data !== "string") throw new Error(error?.message ?? "No approval was created.");
      return [
        {
          kind: "create",
          object: { type: "approval_item", id: data },
          values: { subject: input.object, title: input.title ?? null },
        },
        {
          kind: "link",
          relation: { relationTypeKey: "approval_of", from: { type: "approval_item", id: data }, to: input.object },
        },
      ];
    },
  };
}

const stepId = z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/);

/** A workflow step that asks for approval of the run's object and waits for the answer. */
export const approvalStepSchema = z
  .object({
    id: stepId,
    kind: z.literal("approval"),
    /** Title template; empty means the object's own title. */
    title: z.string().trim().max(200).optional(),
    note: z.string().trim().max(2000).optional(),
    /** Next step when approved; null ends the run. */
    onApproved: stepId.nullable(),
    /** Next step when rejected or withdrawn; null ends the run. */
    onRejected: stepId.nullable(),
  })
  .strict();
export type ApprovalStep = z.infer<typeof approvalStepSchema>;

export type ApprovalItemStatus = "pending" | "approved" | "rejected" | "withdrawn";

/**
 * What the engine does with an approval step, given its item's status:
 * wait while pending, then continue on the matching branch.
 */
export function approvalStepState(
  step: Pick<ApprovalStep, "onApproved" | "onRejected">,
  status: ApprovalItemStatus,
): { status: "waiting" } | { status: "succeeded"; next: string | null; outcome: "approved" | "rejected" | "withdrawn" } {
  if (status === "pending") return { status: "waiting" };
  if (status === "approved") return { status: "succeeded", next: step.onApproved, outcome: "approved" };
  return { status: "succeeded", next: step.onRejected, outcome: status };
}
