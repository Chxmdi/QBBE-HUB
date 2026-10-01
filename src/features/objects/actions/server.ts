import type { ActionContext, ActionRegistry } from "@/lib/objects/contracts";
import { createCan } from "@/lib/objects/can";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createActionRegistry } from "./registry";
import { createSetPropertyAction } from "./set-property";
import { createSupabaseChangeSetStore } from "./supabase-store";
import { createSupabaseObjectWriter } from "./supabase-writer";

/**
 * The registry for one request, acting as the signed-in person through their
 * own client: every read and write is under their RLS, and `can` is the
 * database's own access check (app.can, M10c).
 */
export async function createRequestActionRegistry(userId: string): Promise<{
  registry: ActionRegistry;
  context: ActionContext;
}> {
  const client = await createSupabaseServerClient();
  const writer = createSupabaseObjectWriter(client);
  const registry = createActionRegistry({ store: createSupabaseChangeSetStore(client), writer });
  registry.register(createSetPropertyAction(writer));
  return { registry, context: { actor: { kind: "person", id: userId }, can: createCan(client) } };
}

/** HTTP status for an action result, shared by the API routes. */
export function statusForActionFailure(reason: "unknown_action" | "forbidden" | "failed", message?: string): number {
  if (reason === "forbidden") return 403;
  if (reason === "unknown_action") return 404;
  if (message?.startsWith("conflict:")) return 409;
  return 422;
}
