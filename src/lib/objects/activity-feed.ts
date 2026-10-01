import type { createSupabaseServerClient } from "@/lib/supabase/server";
import type { WriteObjectEvent } from "./contracts";

/**
 * Writes an `ObjectEvent` to today's activity feed (`activity_event`).
 *
 * This is not how `object_event` is written: that table is filled by
 * triggers only (M9a, 20261101010600), labelled with the session's actor.
 * The feed row exists because three readers still take their events from
 * `activity_event`: the project and program activity pages, the follow
 * fan-out (notifications, src/features/following/fanout.ts) and the workflow
 * trigger stream (src/features/workflows/trigger.ts). Each caller says which
 * of those it is writing for; when they all read `object_event`, this goes.
 */
export function createActivityFeedWriter(
  client: Pick<Awaited<ReturnType<typeof createSupabaseServerClient>>, "from">,
): WriteObjectEvent {
  return async (event) => {
    const { error } = await client.from("activity_event").insert({
      organization_id: event.organizationId,
      // activity_event.actor_id references a person; other identities go in metadata.
      actor_id: event.actor.kind === "person" ? event.actor.id : null,
      verb: event.verb,
      source_type: event.object.type,
      source_id: event.object.id,
      project_id: event.projectId ?? null,
      program_id: event.programId ?? null,
      summary: event.summary,
      metadata: {
        actor: event.actor,
        changes: event.changes,
        change_set_id: event.changeSetId ?? null,
      },
    });
    if (error) throw new Error(error.message);
  };
}
