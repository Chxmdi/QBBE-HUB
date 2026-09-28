import { describe, expect, it } from "vitest";
import {
  activityCursor,
  activityHref,
  groupTasks,
  isUuid,
  personWorkAccess,
  type PersonWorkActivity,
  type PersonWorkTask,
} from "../person-work";

const ME = "11111111-1111-4111-8111-111111111111";
const THEM = "22222222-2222-4222-8222-222222222222";

describe("personWorkAccess", () => {
  it("lets staff open their own summary", () => {
    expect(personWorkAccess({ userId: ME, isStaff: true, isAdmin: false, targetId: ME })).toBe("self");
  });

  it("does not let staff open anyone else's", () => {
    expect(personWorkAccess({ userId: ME, isStaff: true, isAdmin: false, targetId: THEM })).toBe(
      "denied",
    );
  });

  it("lets an owner or admin open anyone's, pending the MFA check", () => {
    expect(personWorkAccess({ userId: ME, isStaff: true, isAdmin: true, targetId: THEM })).toBe(
      "admin",
    );
  });

  it("gives volunteers and guests no summary, not even their own", () => {
    expect(personWorkAccess({ userId: ME, isStaff: false, isAdmin: false, targetId: ME })).toBe(
      "denied",
    );
    expect(personWorkAccess({ userId: ME, isStaff: false, isAdmin: false, targetId: THEM })).toBe(
      "denied",
    );
  });
});

describe("isUuid and activityCursor", () => {
  it("accepts only a uuid as a person id", () => {
    expect(isUuid(ME)).toBe(true);
    expect(isUuid("me")).toBe(false);
    expect(isUuid(`${ME}' or 1=1`)).toBe(false);
  });

  it("reads a timeline cursor only when it is a time", () => {
    expect(activityCursor(undefined)).toBeNull();
    expect(activityCursor("yesterday-ish")).toBeNull();
    expect(activityCursor("2026-09-20T10:00:00.000Z")).toBe("2026-09-20T10:00:00.000Z");
    expect(activityCursor("2026-09-20T10:00:00+00:00")).toBe("2026-09-20T10:00:00.000Z");
  });
});

describe("groupTasks", () => {
  const task = (id: string, group: PersonWorkTask["group"]): PersonWorkTask => ({
    id,
    title: id,
    status: "not_started",
    due_at: null,
    updated_at: "2026-09-20T00:00:00Z",
    project_id: null,
    project_name: null,
    group,
    no_recent_update: false,
  });

  it("keeps every group, most pressing first, with its own tasks", () => {
    const grouped = groupTasks([task("a", "later"), task("b", "overdue"), task("c", "later")]);
    expect(grouped.map((entry) => entry.group)).toEqual(["overdue", "blocked", "this_week", "later"]);
    expect(grouped[0].tasks.map((entry) => entry.id)).toEqual(["b"]);
    expect(grouped[1].tasks).toEqual([]);
    expect(grouped[3].tasks.map((entry) => entry.id)).toEqual(["a", "c"]);
  });
});

describe("activityHref", () => {
  const event = (overrides: Partial<PersonWorkActivity>): PersonWorkActivity => ({
    id: "e",
    verb: "updated",
    source_type: "task",
    source_id: "t1",
    project_id: null,
    program_id: null,
    summary: "Updated a task",
    created_at: "2026-09-20T00:00:00Z",
    ...overrides,
  });

  it("opens a task in the drawer on the same page", () => {
    expect(activityHref(event({}), ME)).toBe(`/people/${ME}/work?task=t1`);
  });

  it("links a project, a meeting, or the project an entry belongs to", () => {
    expect(activityHref(event({ source_type: "project", source_id: "p1" }), ME)).toBe("/projects/p1");
    expect(activityHref(event({ source_type: "meeting", source_id: "m1" }), ME)).toBe("/meetings/m1");
    expect(activityHref(event({ source_type: "risk", project_id: "p2" }), ME)).toBe("/projects/p2");
    expect(activityHref(event({ source_type: "risk" }), ME)).toBeNull();
  });
});
