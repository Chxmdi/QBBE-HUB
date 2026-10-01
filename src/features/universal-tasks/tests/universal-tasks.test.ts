import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/features/jobs/services/notify", () => ({
  createNotifications: vi.fn(async () => 1),
  notificationDedupeKey: (...parts: string[]) => parts.join(":"),
}));

import { createNotifications } from "@/features/jobs/services/notify";
import { createUniversalTask } from "../create-task";
import { TASK_SOURCE_TYPES, sourceHref, sourceNeedsId, sourceTitle } from "../sources";
import { universalTasksCatalogs } from "../i18n";
import { catalogKeys } from "../i18n/module-i18n";
import { taskCreateAction } from "../task-create-action";

const actor = {
  userId: "11111111-1111-4111-8111-111111111111",
  organizationId: "22222222-2222-4222-8222-222222222222",
  displayName: "Ada",
};
const project = "33333333-3333-4333-8333-333333333333";
const meeting = "44444444-4444-4444-8444-444444444444";
const assignee = "55555555-5555-4555-8555-555555555555";

type Row = Record<string, unknown> | null;

/** A client that answers reads from `rows` and records inserts. */
function fakeDb(rows: Record<string, Row> = {}) {
  const inserts: { table: string; values: Record<string, unknown> }[] = [];
  const db = {
    from(table: string) {
      const builder = {
        select: () => builder,
        eq: () => builder,
        maybeSingle: async () => ({ data: rows[table] ?? null, error: null }),
        single: async () => ({ data: { id: "66666666-6666-4666-8666-666666666666" }, error: null }),
        insert(values: Record<string, unknown>) {
          inserts.push({ table, values });
          return builder;
        },
        then(resolve: (value: { error: null }) => void) {
          resolve({ error: null });
        },
      };
      return builder;
    },
  };
  return { db: db as never, inserts };
}

describe("createUniversalTask", () => {
  it("creates a manual task with the shared columns and an activity entry", async () => {
    const { db, inserts } = fakeDb();
    const result = await createUniversalTask(db, actor, { title: "  Book the hall  " });
    expect(result).toEqual({
      ok: true,
      id: "66666666-6666-4666-8666-666666666666",
      projectId: null,
      programId: null,
    });
    const task = inserts.find((insert) => insert.table === "task")!.values;
    expect(task).toMatchObject({
      organization_id: actor.organizationId,
      title: "Book the hall",
      priority: "medium",
      status: "not_started",
      requester_id: actor.userId,
      created_by: actor.userId,
      source_type: "manual",
      source_id: null,
      completed_at: null,
    });
    const activity = inserts.find((insert) => insert.table === "activity_event")!.values;
    expect(activity).toMatchObject({
      verb: "created",
      source_type: "task",
      summary: "created task “Book the hall”",
      metadata: { source: { type: "manual", id: null } },
    });
  });

  it("records a readable source and takes the program from the project", async () => {
    const { db, inserts } = fakeDb({
      meeting: { id: meeting, title: "Board review" },
      project: { program_id: "77777777-7777-4777-8777-777777777777" },
    });
    const result = await createUniversalTask(db, actor, {
      title: "Send minutes",
      projectId: project,
      programId: "88888888-8888-4888-8888-888888888888",
      source: { type: "meeting", id: meeting },
    });
    expect(result.ok && result.programId).toBe("77777777-7777-4777-8777-777777777777");
    expect(inserts.find((insert) => insert.table === "task")!.values).toMatchObject({
      source_type: "meeting",
      source_id: meeting,
      project_id: project,
      program_id: "77777777-7777-4777-8777-777777777777",
    });
  });

  it("refuses a source the creator cannot see", async () => {
    const { db, inserts } = fakeDb({ meeting: null });
    const result = await createUniversalTask(db, actor, {
      title: "Send minutes",
      source: { type: "meeting", id: meeting },
    });
    expect(result).toEqual({ ok: false, reason: "source" });
    expect(inserts).toHaveLength(0);
  });

  it("refuses a source kind without its row, and a manual task with one", async () => {
    const { db } = fakeDb();
    expect(
      await createUniversalTask(db, actor, { title: "x", source: { type: "meeting", id: null } }),
    ).toMatchObject({ ok: false, reason: "invalid" });
    expect(
      await createUniversalTask(db, actor, { title: "x", source: { type: "manual", id: meeting } }),
    ).toMatchObject({ ok: false, reason: "invalid" });
    expect(await createUniversalTask(db, actor, { title: "   " })).toMatchObject({
      ok: false,
      reason: "invalid",
    });
  });

  it("marks completed work with its completion time", async () => {
    const { db, inserts } = fakeDb();
    await createUniversalTask(db, actor, { title: "Done already", status: "completed" });
    expect(inserts[0].values.completed_at).toEqual(expect.any(String));
  });

  it("notifies someone else it is assigned to, never the creator", async () => {
    const notify = vi.mocked(createNotifications);
    notify.mockClear();
    const { db } = fakeDb({ user_profile: { locale: "fr-CA" } });
    await createUniversalTask(db, actor, { title: "Call back", assigneeId: assignee });
    expect(notify).toHaveBeenCalledTimes(1);
    const [draft] = notify.mock.calls[0][1] as { user_id: string; title: string; dedupe_key: string }[];
    expect(draft.user_id).toBe(assignee);
    expect(draft.dedupe_key).toContain(assignee);
    // In the assignee's language, not the creator's.
    expect(draft.title).toContain("Ada");
    expect(draft.title).not.toMatch(/assigned you/);

    notify.mockClear();
    await createUniversalTask(fakeDb().db, actor, { title: "Mine", assigneeId: actor.userId });
    expect(notify).not.toHaveBeenCalled();
  });

  it("keeps caller-owned columns such as source_message_id", async () => {
    const message = "99999999-9999-4999-8999-999999999999";
    const { db, inserts } = fakeDb({ message: { id: message, body: "hi", channel_id: meeting } });
    await createUniversalTask(
      db,
      actor,
      { title: "From chat", source: { type: "message", id: message } },
      { extra: { source_message_id: message }, activitySummary: "converted" },
    );
    expect(inserts[0].values).toMatchObject({ source_type: "message", source_message_id: message });
    expect(inserts[1].values.summary).toBe("converted");
  });
});

describe("task.create registry action", () => {
  it("targets the project for the capability check and reports a create change", async () => {
    const { db } = fakeDb({ project: { program_id: null } });
    const action = taskCreateAction(db, actor);
    expect(action.targets({ title: "x" })).toEqual([]);
    expect(action.targets({ title: "x", projectId: project })).toEqual([project]);
    const changes = await action.run(
      { actor: { kind: "person", id: actor.userId }, can: async () => true },
      { title: "x", projectId: project },
    );
    expect(changes[0]).toMatchObject({ kind: "create", object: { type: "task" } });
  });
});

describe("task sources", () => {
  it("match the database constraint", () => {
    // The constraint was last redefined when `page` joined the list.
    const migration = readFileSync("supabase/migrations/20261107030100_meeting_notes_editor.sql", "utf8");
    const block = migration.slice(migration.indexOf("task_source_type_check check"));
    const listed = [...block.slice(0, block.indexOf("));")).matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(listed).toEqual([...TASK_SOURCE_TYPES]);
  });

  it("need a row except manual and command", () => {
    expect(TASK_SOURCE_TYPES.filter((type) => !sourceNeedsId(type))).toEqual(["manual", "command"]);
  });

  it("link back to where they came from", () => {
    expect(sourceHref("meeting", meeting)).toBe(`/meetings/${meeting}`);
    expect(sourceHref("page", meeting)).toBe(`/pages/${meeting}`);
    expect(sourceHref("message", meeting, { channel_id: project })).toBe(
      `/channels/${project}?message=${meeting}`,
    );
    expect(sourceHref("message", meeting)).toBeNull();
    expect(sourceHref("comment", meeting, { parent_type: "project", parent_id: project })).toBe(
      `/projects/${project}`,
    );
    expect(sourceHref("comment", meeting, { parent_type: "risk", parent_id: project })).toBeNull();
    expect(sourceHref("contact", meeting, { crm_organization_id: project })).toBe(`/crm/${project}`);
    expect(sourceHref("manual", null)).toBeNull();
  });

  it("shorten a source's text to one line", () => {
    expect(sourceTitle("First line\nsecond")).toBe("First line");
    expect(sourceTitle("x".repeat(100))).toHaveLength(80);
    expect(sourceTitle("  ")).toBeNull();
    expect(sourceTitle(3)).toBeNull();
  });
});

describe("universal tasks catalogue", () => {
  it("has every English key in French, with the same placeholders", () => {
    const en = catalogKeys(universalTasksCatalogs.en);
    expect(catalogKeys(universalTasksCatalogs["fr-CA"])).toEqual(en);
    const lookup = (catalog: unknown, key: string) =>
      key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown>)[part], catalog) as string;
    for (const key of en) {
      const holes = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
      expect(holes(lookup(universalTasksCatalogs["fr-CA"], key)), key).toEqual(
        holes(lookup(universalTasksCatalogs.en, key)),
      );
    }
  });
});
