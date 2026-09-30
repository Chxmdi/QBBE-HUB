import { notificationDedupeKey } from "@/features/jobs/services/notify";
import type { StoredObjectEvent } from "./events";

/**
 * Who an event should notify, and with which dedupe key. The notifications
 * consumer (reading object_event after its cursor) turns these into
 * notification rows; the keys are the ones task.commands.ts uses today, so a
 * notification sent by the old path and one sent from the event collapse into
 * one.
 */
export interface NotificationTarget {
  userId: string;
  sourceType: "task" | "task_review";
  sourceId: string;
  reason: "assigned" | "review requested";
  dedupeKey: string;
}

function personAfter(event: StoredObjectEvent, property: string): string | null {
  for (const change of event.changes) {
    if ("property" in change && change.property === property) {
      return typeof change.after === "string" ? change.after : null;
    }
  }
  return null;
}

export function taskNotificationTargets(event: StoredObjectEvent): NotificationTarget[] {
  if (event.object.type !== "task" || (event.verb !== "created" && event.verb !== "updated")) {
    return [];
  }
  const actorId = event.actor.kind === "person" ? event.actor.id : null;
  const taskId = event.object.id;
  const targets: NotificationTarget[] = [];

  const assignee = personAfter(event, "assignee");
  if (assignee && assignee !== actorId) {
    targets.push({
      userId: assignee,
      sourceType: "task",
      sourceId: taskId,
      reason: "assigned",
      dedupeKey: notificationDedupeKey("task", taskId, assignee),
    });
  }

  const reviewer = personAfter(event, "reviewer");
  if (reviewer && reviewer !== actorId) {
    targets.push({
      userId: reviewer,
      sourceType: "task_review",
      sourceId: taskId,
      reason: "review requested",
      dedupeKey: notificationDedupeKey("task_review", taskId, reviewer),
    });
  }
  return targets;
}
