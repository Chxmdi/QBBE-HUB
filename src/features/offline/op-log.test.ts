import { describe, expect, it } from "vitest";
import { offlineText } from "./messages";
import { MemoryOpStore, compact, decideField, isValidValue, type OfflineOperation } from "./op-log";

const edit = (over: Partial<Extract<OfflineOperation, { kind: "set_field" }>> = {}): Extract<OfflineOperation, { kind: "set_field" }> => ({
  id: crypto.randomUUID(),
  kind: "set_field",
  createdAt: "2027-03-01T10:00:00Z",
  taskId: "t1",
  taskTitle: "Venue",
  field: "status",
  value: "in_progress",
  base: "not_started",
  ...over,
});

describe("decideField: latest wins per field", () => {
  it("applies when nobody else changed the field", () => {
    expect(decideField(edit(), { value: "not_started", changedAt: "2027-03-01T12:00:00Z" })).toEqual({ action: "apply", overwritten: null, changedByOthers: false });
  });

  it("does nothing when the server already holds the value", () => {
    expect(decideField(edit(), { value: "in_progress", changedAt: "2027-03-01T12:00:00Z" })).toEqual({ action: "already" });
  });

  it("keeps someone else's later change and shows yours as overwritten", () => {
    expect(decideField(edit(), { value: "completed", changedAt: "2027-03-01T11:00:00Z" })).toEqual({ action: "keep_server", overwritten: "in_progress" });
  });

  it("applies yours when it is later, showing theirs as overwritten", () => {
    expect(decideField(edit(), { value: "waiting", changedAt: "2027-03-01T09:00:00Z" })).toEqual({ action: "apply", overwritten: "waiting", changedByOthers: true });
  });
});

describe("compact", () => {
  it("folds edits to one field into the last value from the first base", () => {
    const first = edit({ value: "ready", createdAt: "2027-03-01T10:00:00Z" });
    const second = edit({ value: "in_progress", base: "ready", createdAt: "2027-03-01T10:05:00Z" });
    const other = edit({ field: "priority", value: "high", base: "medium" });
    const out = compact([first, other, second]);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ id: second.id, value: "in_progress", base: "not_started", createdAt: "2027-03-01T10:05:00Z" });
  });

  it("drops edits that ended where they started, and keeps new tasks", () => {
    const create: OfflineOperation = { id: "c", kind: "create_task", createdAt: "2027-03-01T10:00:00Z", taskId: "n1", title: "Call", projectId: null };
    expect(compact([edit({ value: "ready" }), edit({ value: "not_started", base: "ready" }), create])).toEqual([create]);
  });
});

it("only accepts values a task can hold", () => {
  expect(isValidValue("status", "completed")).toBe(true);
  expect(isValidValue("status", "done")).toBe(false);
  expect(isValidValue("priority", null)).toBe(false);
  expect(isValidValue("due_at", "2027-03-01")).toBe(true);
  expect(isValidValue("due_at", null)).toBe(true);
  expect(isValidValue("title", "  ")).toBe(false);
});

it("the memory store keeps operations and reviews separately", async () => {
  const store = new MemoryOpStore();
  const op = edit();
  await store.add(op);
  await store.addReviews([{ opId: op.id, taskId: "t1", taskTitle: "Venue", field: "status", kept: "completed", overwritten: "in_progress", winner: "server" }]);
  await store.remove([op.id]);
  expect(await store.all()).toEqual([]);
  expect(await store.reviews()).toHaveLength(1);
  await store.dismissReview(op.id);
  expect(await store.reviews()).toEqual([]);
});

it("has French for every English string", () => {
  const keys = (o: object, prefix = ""): string[] =>
    Object.entries(o).flatMap(([k, v]) => (typeof v === "object" ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`]));
  expect(keys(offlineText("fr-CA"))).toEqual(keys(offlineText("en")));
});
