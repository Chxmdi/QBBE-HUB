import type { SupabaseClient } from "@supabase/supabase-js";
import type { ActionContext, ActionRegistry } from "@/lib/objects/contracts";
import { createCan } from "@/lib/objects/can";
import { getSessionContext } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { taskCreateAction } from "@/features/universal-tasks/task-create-action";
import { createImportAction } from "./import-rows";
import { projectCreateAction } from "./project-create";
import { createActionRegistry } from "./registry";
import { createSetPropertyAction } from "./set-property";
import { createTaskCreateAction } from "./task-create";
import { createSupabaseChangeSetStore } from "./supabase-store";
import { createSupabaseObjectWriter } from "./supabase-writer";

/**
 * The registry for one request, acting as the signed-in person through their
 * own client: every read and write is under their RLS, and `can` is the
 * database's own access check (app.can, M10c).
 *
 * object.import (CSV import, U15) creates rows through the shared task
 * creation and project.create, and records them as one change set under its
 * own key, so undo finds it here.
 */
export async function createRequestActionRegistry(userId: string): Promise<{
  registry: ActionRegistry;
  context: ActionContext;
}> {
  const client = await createSupabaseServerClient();
  const writer = createSupabaseObjectWriter(client);
  const registry = createActionRegistry({ store: createSupabaseChangeSetStore(client), writer });
  registry.register(createSetPropertyAction(writer));
  registry.register(createTaskCreateAction());
  const projectCreate = projectCreateAction();
  registry.register(projectCreate);
  // The same request's session (cached): the task's organization and the
  // name its assignee is told about.
  const session = await getSessionContext();
  const taskCreate =
    session && session.userId === userId
      ? taskCreateAction(client as unknown as SupabaseClient, {
          userId,
          organizationId: session.organizationId,
          displayName: session.profile.full_name,
        })
      : undefined;
  registry.register(createImportAction({ task: taskCreate, project: projectCreate }));
  return { registry, context: { actor: { kind: "person", id: userId }, can: createCan(client) } };
}

/** HTTP status for an action result, shared by the API routes. */
export function statusForActionFailure(reason: "unknown_action" | "forbidden" | "failed", message?: string): number {
  if (reason === "forbidden") return 403;
  if (reason === "unknown_action") return 404;
  if (message?.startsWith("conflict:")) return 409;
  return 422;
}
