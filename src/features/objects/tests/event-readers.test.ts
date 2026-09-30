import { describe, expect, it } from "vitest";
import { notificationDedupeKey } from "@/features/jobs/services/notify";
import {
  diffTaskFields,
  summarizeChanges,
  type TaskFieldValues,
} from "@/features/tasks/services/task.history";
import { renderTaskActivitySummary, TASK_PROPERTY_TO_TRACKED_FIELD } from "@/features/objects/services/activity";
import { taskNotificationTargets } from "@/features/objects/services/event-consumers";
import type { StoredChange, StoredObjectEvent } from "@/features/objects/services/events";

const TASK = "11111111-1111-1111-1111-111111111111";
const ALEX = "22222222-2222-2222-2222-222222222222";
const SAM = "33333333-3333-3333-3333-333333333333";
const labels = { [ALEX]: "Alex", [SAM]: "Sam" };

const FIELD_TO_PROPERTY = Object.fromEntries(
  Object.entries(TASK_PROPERTY_TO_TRACKED_FIELD).map(([property, field]) => [field, property]),
);

/**
 * What the database trigger records for an update: one change per system
 * property whose column differs, keyed by property, JSON values.
 */
function eventChangesFor(before: TaskFieldValues, after: TaskFieldValues): StoredChange[] {
  return Object.keys(after)
    .filter((field) => (before as Record<string, unknown>)[field] !== (after as Record<string, unknown>)[field])
    .map((field) => ({
      property: FIELD_TO_PROPERTY[field],
      before: (before as Record<string, unknown>)[field] ?? null,
      after: (after as Record<string, unknown>)[field] ?? null,
    }));
}

function event(verb: StoredObjectEvent["verb"], changes: StoredChange[], actor = ALEX): StoredObjectEvent {
  return {
    id: "e",
    seq: 1,
    object: { id: TASK, type: "task" },
    organizationId: "o",
    actor: { kind: "person", id: actor },
    verb,
    changes,
    changeSetId: null,
    occurredAt: "2026-09-30T16:00:00Z",
  };
}

// Before/after pairs as the task commands pass them to recordTaskChanges.
const scenarios: { name: string; before: TaskFieldValues; after: TaskFieldValues }[] = [
  { name: "status and due date", before: { status: "ready", due_at: null }, after: { status: "in_progress", due_at: "2026-10-20" } },
  { name: "reassignment", before: { assignee_id: ALEX }, after: { assignee_id: SAM } },
  { name: "clearing the due date", before: { due_at: "2026-10-20" }, after: { due_at: null } },
  { name: "priority", before: { priority: "low" }, after: { priority: "critical" } },
  {
    name: "a long blocked reason",
    before: { status: "in_progress", blocked_reason: null },
    after: { status: "blocked", blocked_reason: "Waiting on the city to confirm the permit for the hall and the parking" },
  },
  { name: "nothing tracked", before: {}, after: {} },
];

describe("activity feed from object_event matches the old writer", () => {
  it.each(scenarios)("renders the same summary for $name", ({ before, after }) => {
    const legacy = summarizeChanges("Book the hall", diffTaskFields(before, after, labels));
    const fromEvent = renderTaskActivitySummary(event("updated", eventChangesFor(before, after)), "Book the hall", labels);
    expect(fromEvent).toBe(legacy);
  });

  it("renders creation and archiving with the old writers' words", () => {
    expect(renderTaskActivitySummary(event("created", []), "Book the hall")).toBe("created task “Book the hall”");
    expect(renderTaskActivitySummary(event("archived", []), "Book the hall")).toBe("archived “Book the hall”");
  });

  it("ignores changes task history never tracked (title, estimate)", () => {
    const summary = renderTaskActivitySummary(
      event("updated", [
        { property: "title", before: "Old", after: "Book the hall" },
        { property: "estimate", before: 1, after: 2 },
      ]),
      "Book the hall",
    );
    expect(summary).toBe("updated “Book the hall”");
  });

  it("maps every tracked field", () => {
    expect(Object.values(TASK_PROPERTY_TO_TRACKED_FIELD).sort()).toEqual(
      ["approver_id", "assignee_id", "blocked_reason", "completion_criteria", "due_at", "milestone_id",
        "priority", "project_id", "reviewer_id", "status"],
    );
  });
});

describe("notifications from object_event match the old writer", () => {
  it("notifies a new assignee with the same dedupe key as createTask/updateTask", () => {
    const targets = taskNotificationTargets(event("updated", [{ property: "assignee", before: ALEX, after: SAM }]));
    expect(targets).toEqual([
      {
        userId: SAM,
        sourceType: "task",
        sourceId: TASK,
        reason: "assigned",
        dedupeKey: notificationDedupeKey("task", TASK, SAM),
      },
    ]);
  });

  it("notifies an assignee set at creation", () => {
    const targets = taskNotificationTargets(event("created", [{ property: "assignee", before: null, after: SAM }]));
    expect(targets.map((target) => target.dedupeKey)).toEqual([notificationDedupeKey("task", TASK, SAM)]);
  });

  it("notifies a new reviewer with the task_review key", () => {
    const targets = taskNotificationTargets(event("updated", [{ property: "reviewer", before: null, after: SAM }]));
    expect(targets.map((target) => target.dedupeKey)).toEqual([notificationDedupeKey("task_review", TASK, SAM)]);
  });

  it("does not notify people of their own changes, or of unrelated events", () => {
    expect(taskNotificationTargets(event("updated", [{ property: "assignee", before: null, after: ALEX }]))).toEqual([]);
    expect(taskNotificationTargets(event("updated", [{ property: "assignee", before: SAM, after: null }]))).toEqual([]);
    expect(
      taskNotificationTargets({ ...event("updated", [{ property: "assignee", before: null, after: SAM }]), object: { id: TASK, type: "project" } }),
    ).toEqual([]);
  });
});
