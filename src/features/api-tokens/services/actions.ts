import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Identity } from "@/lib/objects/contracts";
import { createActivityFeedWriter } from "@/lib/objects/activity-feed";
import { createWorkflowActionRegistry, workflowActionKeys, workflowActionLabels } from "@/features/workflows/actions";
import { ApiError, canAs, type ApiIdentity } from "./api-handler";

/**
 * Actions through /api/v1 (V2-8): the same persisted registry the workflows
 * use (M13), checked as the token's person on every target. The change set
 * and the object_event each change writes are labelled as the integration
 * (record_change_set_as, apply_task_update_as). The activity_event row is
 * kept for the readers still on the old feed: the project and program
 * activity pages, the follow fan-out (notifications) and the workflow trigger
 * stream, so an API change can start a workflow as it does today.
 */

export function listActions() {
  return { data: workflowActionKeys.map((key) => ({ key, label: workflowActionLabels[key] })) };
}

const bodySchema = z.object({ input: z.record(z.unknown()) }).strict();

export async function runAction(db: SupabaseClient, identity: ApiIdentity, key: string, request: Request) {
  if (!(workflowActionKeys as readonly string[]).includes(key)) throw new ApiError(404, "unknown_action", "No such action.");
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new ApiError(400, "invalid_body", "Send a JSON body: { \"input\": { ... } }.");
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "invalid_body", "Send a JSON body: { \"input\": { ... } }.");

  const actor: Identity = { kind: "integration", id: `api:${identity.tokenId}` };
  const registry = createWorkflowActionRegistry({
    db,
    organizationId: identity.organizationId,
    workflowId: `api:${identity.tokenId}`,
    runId: crypto.randomUUID(),
    runAs: { userId: identity.userId, assurance: "aal1" },
  });
  const result = await registry.run(key, parsed.data.input, {
    actor,
    can: (objectId, capability) => canAs(db, identity, objectId, capability),
  });
  if (!result.ok) {
    if (result.reason === "forbidden") throw new ApiError(403, "forbidden", "The token's owner may not do this.");
    if (result.reason === "unknown_action") throw new ApiError(404, "unknown_action", "No such action.");
    throw new ApiError(422, "action_failed", result.message ?? "The action failed.");
  }
  const writeFeed = createActivityFeedWriter(db);
  for (const change of result.changeSet.changes) {
    if (change.kind !== "update") continue;
    await writeFeed({
      object: change.object,
      organizationId: identity.organizationId,
      actor,
      verb: "updated",
      changes: [{ property: change.property, before: change.before, after: change.after }],
      changeSetId: result.changeSet.id,
      summary: `Changed ${change.property} through the API.`,
    }).catch(() => undefined);
  }
  return { data: { changeSetId: result.changeSet.id, changes: result.changeSet.changes } };
}
