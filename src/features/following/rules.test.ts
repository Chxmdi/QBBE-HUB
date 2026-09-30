import { describe, expect, it } from "vitest";
import type { QuerySpec } from "@/lib/objects/contracts";
import { candidatesFor } from "./fanout";
import { followingText } from "./messages";
import {
  PRESET_QUERIES,
  choiceOf,
  classifyEvent,
  effectiveRule,
  ruleFromChoice,
  taskMatchesQuery,
  type ActivityEvent,
  type TaskRow,
} from "./rules";

const task: TaskRow = {
  id: "t1",
  status: "blocked",
  priority: "high",
  assignee_id: "u1",
  requester_id: "u2",
  reviewer_id: null,
  project_id: "p1",
  program_id: null,
  start_at: null,
  due_at: "2027-03-04",
  title: "Book the venue",
};

const event = (over: Partial<ActivityEvent> = {}): ActivityEvent => ({
  id: "e1",
  organization_id: "o1",
  actor_id: "actor",
  verb: "updated",
  source_type: "task",
  source_id: "t1",
  project_id: "p1",
  program_id: null,
  summary: "changed Status",
  metadata: { changes: [{ field: "status" }] },
  created_at: "2027-03-01T10:00:00Z",
  ...over,
});

describe("classifyEvent", () => {
  it("names the kind of change from the verb and the fields", () => {
    expect(classifyEvent(event())).toBe("status");
    expect(classifyEvent(event({ verb: "completed", metadata: {} }))).toBe("status");
    expect(classifyEvent(event({ metadata: { changes: [{ field: "assignee_id" }] } }))).toBe("assignment");
    expect(classifyEvent(event({ metadata: { role: "reviewer" } }))).toBe("assignment");
    expect(classifyEvent(event({ metadata: { changes: [{ field: "due_at" }] } }))).toBe("due");
    expect(classifyEvent(event({ verb: "commented", metadata: {} }))).toBe("comment");
    expect(classifyEvent(event({ metadata: { changes: [{ field: "title" }] } }))).toBe("change");
  });
});

describe("rules", () => {
  it("round-trips each choice and falls back to the defaults", () => {
    for (const choice of ["none", "hub", "immediate", "daily", "weekly"] as const) {
      expect(choiceOf(ruleFromChoice(choice))).toBe(choice);
    }
    expect(effectiveRule([], "status")).toEqual({ in_app: true, email: "weekly" });
    expect(effectiveRule([{ event_kind: "status", in_app: false, email: "off" }], "status").in_app).toBe(false);
  });
});

describe("taskMatchesQuery", () => {
  const context = { userId: "u1", today: "2027-03-01" };

  it("matches the ready-made searches for the person following them", () => {
    expect(taskMatchesQuery(PRESET_QUERIES.my_blocked as QuerySpec, task, context)).toBe(true);
    expect(taskMatchesQuery(PRESET_QUERIES.my_blocked as QuerySpec, task, { ...context, userId: "u9" })).toBe(false);
    // 2027-03-01 is a Monday; the 4th is in the same week, the 8th is not.
    expect(taskMatchesQuery(PRESET_QUERIES.due_this_week as QuerySpec, task, context)).toBe(true);
    expect(taskMatchesQuery(PRESET_QUERIES.due_this_week as QuerySpec, { ...task, due_at: "2027-03-08" }, context)).toBe(false);
    expect(taskMatchesQuery(PRESET_QUERIES.i_requested as QuerySpec, task, { ...context, userId: "u2" })).toBe(true);
  });

  it("never matches what it cannot evaluate", () => {
    const viaRelation: QuerySpec = { version: 1, types: ["task"], filter: { property: { via: ["project"], property: "status" }, op: "eq", value: "x" } };
    expect(taskMatchesQuery(viaRelation, task, context)).toBe(false);
    expect(taskMatchesQuery({ version: 1, types: ["project"] }, task, context)).toBe(false);
    expect(taskMatchesQuery({ version: 1, types: ["task"], filter: { property: "unknown", op: "eq", value: 1 } }, task, context)).toBe(false);
  });
});

describe("candidatesFor", () => {
  it("finds direct, project and query followers once each, never the actor", () => {
    const follows = [
      { user_id: "a", object_id: "t1", query_spec: null },
      { user_id: "b", object_id: "p1", query_spec: null },
      { user_id: "u1", object_id: null, query_spec: PRESET_QUERIES.my_blocked as QuerySpec },
      { user_id: "a", object_id: null, query_spec: PRESET_QUERIES.i_requested as QuerySpec },
      { user_id: "actor", object_id: "t1", query_spec: null },
    ];
    const out = candidatesFor([event()], follows, new Map([["t1", task]]), "2027-03-01");
    expect(out.map((c) => c.userId).sort()).toEqual(["a", "b", "u1"]);
  });
});

it("has French for every English string", () => {
  const keys = (o: object, prefix = ""): string[] =>
    Object.entries(o).flatMap(([k, v]) => (typeof v === "object" ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`]));
  expect(keys(followingText("fr-CA"))).toEqual(keys(followingText("en")));
});
