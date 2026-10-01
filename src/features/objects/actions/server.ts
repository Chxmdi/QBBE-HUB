import type { SupabaseClient } from "@supabase/supabase-js";
import type { ActionContext, ActionRegistry } from "@/lib/objects/contracts";
import { createCanStub } from "@/lib/objects/stubs";
import { getSessionContext } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { taskCreateAction } from "@/features/universal-tasks/task-create-action";
import { createImportAction } from "./import-rows";
import { projectCreateAction } from "./project-create";
import { createActionRegistry } from "./registry";
import { createSetPropertyAction } from "./set-property";
import { createSupabaseChangeSetStore } from "./supabase-store";
import { createSupabaseObjectWriter } from "./supabase-writer";

/**
 * The registry for one request, acting as the signed-in person through their
 * own client: every read and write is under their RLS. `can` is the W0
 * stand-in until S2's real check replaces it (same signature).
 *
 * Registered: object.set_property (bulk edit), task.create and
 * project.create (the shared create actions), and object.import, which runs
 * the create actions row by row as one change set. Every action is
 * registered on every request so that undo can find the action a change set
 * came from.
 */
export async function createRequestActionRegistry(userId: string): Promise<{
  registry: ActionRegistry;
  context: ActionContext;
}> {
  const client = await createSupabaseServerClient();
  const writer = createSupabaseObjectWriter(client);
  const registry = createActionRegistry({ store: createSupabaseChangeSetStore(client), writer });
  registry.register(createSetPropertyAction(writer));
  // The same request's session (cached), for the task's organization and the
  // name its assignee is told about.
  const session = await getSessionContext();
  if (session && session.userId === userId) {
    registry.register(
      taskCreateAction(client as unknown as SupabaseClient, {
        userId,
        organizationId: session.organizationId,
        displayName: session.profile.full_name,
      }),
    );
    registry.register(projectCreateAction());
  }
  registry.register(createImportAction((key) => registry.get(key)));
  return { registry, context: { actor: { kind: "person", id: userId }, can: createCanStub(client) } };
}

/** HTTP status for an action result, shared by the API routes. */
export function statusForActionFailure(reason: "unknown_action" | "forbidden" | "failed", message?: string): number {
  if (reason === "forbidden") return 403;
  if (reason === "unknown_action") return 404;
  if (message?.startsWith("conflict:")) return 409;
  return 422;
}
