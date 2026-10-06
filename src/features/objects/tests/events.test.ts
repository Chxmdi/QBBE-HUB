import { describe, expect, it } from "vitest";
import { toStoredObjectEvent, type ObjectEventRow } from "@/features/objects/services/events";

const row: ObjectEventRow = {
  id: "e",
  seq: "17",
  organization_id: "o",
  object_id: "t",
  object_type: "task",
  actor_kind: "person",
  actor_id: "p",
  verb: "updated",
  changes: [{ property: "due", before: null, after: "2026-10-15" }],
  change_set_id: null,
  occurred_at: "2026-09-30T16:00:00Z",
};

describe("object events", () => {
  it("maps a row, with bigint seq as a number", () => {
    expect(toStoredObjectEvent(row)).toMatchObject({
      seq: 17,
      object: { id: "t", type: "task" },
      actor: { kind: "person", id: "p" },
      changes: [{ property: "due", before: null, after: "2026-10-15" }],
    });
  });

  it("reads link changes and the system actor", () => {
    const event = toStoredObjectEvent({
      ...row,
      actor_kind: "system",
      actor_id: null,
      verb: "linked",
      changes: [{ relation: "related_to", direction: "incoming", other: "x", other_type: "task" }],
    });
    expect(event.actor).toEqual({ kind: "system", id: null });
    expect(event.changes).toEqual([
      { relation: "related_to", direction: "incoming", other: "x", otherType: "task" },
    ]);
  });

  it("drops malformed changes instead of failing", () => {
    expect(toStoredObjectEvent({ ...row, changes: [null, 3, { nope: 1 }] }).changes).toEqual([]);
    expect(toStoredObjectEvent({ ...row, changes: "bad" }).changes).toEqual([]);
  });
});
