import { beforeEach, describe, expect, it, vi } from "vitest";
import { createLensT } from "@/features/lenses/i18n";

const ME = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1";
const TASK = "11111111-1111-4111-8111-111111111111";
const flags = { wos_lenses: true, wos_objects: true };
const run = vi.fn();
const undo = vi.fn();
const updateTask = vi.fn();
const rateLimit = vi.fn();
const updateTaskStatus = vi.fn();
/** Answers to public.can, and the newest change set ids the action reads before and after a command. */
const db = { can: true, latest: [] as (string | null)[] };
const fakeClient = {
  rpc: async (fn: string) => (fn === "can" ? { data: db.can, error: null } : { data: null, error: { message: fn } }),
  from: () => {
    const chain = {
      select: () => chain,
      eq: () => chain,
      is: () => chain,
      order: () => chain,
      limit: async () => {
        const id = db.latest.shift() ?? null;
        return { data: id ? [{ id }] : [], error: null };
      },
    };
    return chain;
  },
};

vi.mock("@/lib/auth", () => ({ requireSession: async () => ({ userId: ME }) }));
vi.mock("@/lib/feature-flags", () => ({ isEnabled: async (key: keyof typeof flags) => flags[key] }));
vi.mock("@/lib/rate-limit", () => ({ enforceRateLimit: (...args: unknown[]) => rateLimit(...args) }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => fakeClient }));
vi.mock("@/features/lenses/i18n/server", () => ({ getLensT: async () => createLensT("en") }));
vi.mock("@/features/tasks/services/task.commands", () => ({
  updateTask: (...args: unknown[]) => updateTask(...args),
  updateTaskStatus: (...args: unknown[]) => updateTaskStatus(...args),
}));
vi.mock("@/features/objects/actions/server", () => ({
  createRequestActionRegistry: async () => ({ registry: { run, undo }, context: { actor: { kind: "person", id: ME } } }),
}));
vi.mock("@/lib/query/run", () => ({
  loadCatalog: async () => ({
    task: {
      key: "task",
      name: { en: "Tasks", fr: "Tâches" },
      properties: [
        { key: "title", kind: "text" },
        { key: "estimate", kind: "number" },
        { key: "due", kind: "date" },
        { key: "priority", kind: "select", choices: [{ key: "high", label: { en: "High", fr: "Haute" } }] },
        { key: "status", kind: "select", choices: [{ key: "in_review", label: { en: "In review", fr: "En révision" } }] },
        { key: "created_time", kind: "date", timestamp: true },
      ],
    },
  }),
}));

const { pasteLensCells, undoLensCells, updateLensCell } = await import("./lens.actions");

beforeEach(() => {
  flags.wos_lenses = true;
  flags.wos_objects = true;
  run.mockReset();
  undo.mockReset();
  updateTask.mockReset().mockResolvedValue({ ok: true });
  updateTaskStatus.mockReset().mockResolvedValue({ ok: true });
  db.can = true;
  db.latest = [];
  rateLimit.mockReset().mockResolvedValue(null);
  run.mockResolvedValue({ ok: true, changeSet: { id: "cs-1", changes: [{}] } });
});

describe("updateLensCell with the object switch on (D1)", () => {
  it("D1-4: saves a task field through its command, keeping notifications and history, and returns its change set", async () => {
    db.latest = ["cs-old", "cs-new"];
    const result = await updateLensCell({ type: "task", id: TASK, property: "title", value: "  Renamed  " });
    expect(result).toEqual({ ok: true, changeSetId: "cs-new" });
    expect(updateTask).toHaveBeenCalledWith({ taskId: TASK, title: "Renamed" });
    expect(run).not.toHaveBeenCalled();
    db.latest = ["cs-old", "cs-status"];
    expect(await updateLensCell({ type: "task", id: TASK, property: "status", value: "in_review" })).toEqual({ ok: true, changeSetId: "cs-status" });
    expect(updateTaskStatus).toHaveBeenCalledWith(TASK, "in_review");
    // Saving the value it already had records nothing to undo.
    db.latest = ["cs-same", "cs-same"];
    expect(await updateLensCell({ type: "task", id: TASK, property: "priority", value: "high" })).toEqual({ ok: true });
  });

  it("D1-6: refuses a task command for a record the person cannot edit, before running it", async () => {
    db.can = false;
    expect(await updateLensCell({ type: "task", id: TASK, property: "title", value: "Mine now" })).toEqual({
      ok: false,
      error: "You can view this record but not change it.",
    });
    expect(updateTask).not.toHaveBeenCalled();
  });

  it("D1-4: saves other fields through object.set_property and returns the change set to undo", async () => {
    // The browser sends numbers in canonical form; the server takes no other.
    expect(await updateLensCell({ type: "task", id: TASK, property: "estimate", value: "2,5" })).toMatchObject({ ok: false });
    const result = await updateLensCell({ type: "task", id: TASK, property: "estimate", value: "2.5" });
    expect(result).toEqual({ ok: true, changeSetId: "cs-1" });
    expect(run).toHaveBeenCalledWith(
      "object.set_property",
      { objectIds: [TASK], objectType: "task", property: "estimate", value: 2.5 },
      expect.anything(),
    );
    expect(rateLimit).toHaveBeenCalledWith("property:write", ME);
  });

  it("D1-5: refuses text in a number, a bad date and an unknown option, and saves nothing", async () => {
    expect(await updateLensCell({ type: "task", id: TASK, property: "estimate", value: "lots" })).toEqual({
      ok: false,
      error: "Enter a number, like 2.5.",
    });
    expect(await updateLensCell({ type: "task", id: TASK, property: "due", value: "2026-02-30" })).toMatchObject({ ok: false });
    expect(await updateLensCell({ type: "task", id: TASK, property: "priority", value: "urgent" })).toMatchObject({ ok: false });
    expect(run).not.toHaveBeenCalled();
  });

  it("D1-6: refuses a forged edit of a computed column or an unknown type before writing", async () => {
    expect(await updateLensCell({ type: "task", id: TASK, property: "created_time", value: "2026-01-01" })).toMatchObject({ ok: false });
    expect(await updateLensCell({ type: "risk", id: TASK, property: "title", value: "x" })).toMatchObject({ ok: false });
    expect(await updateLensCell({ type: "task", id: "not-a-uuid", property: "title", value: "x" })).toMatchObject({ ok: false });
    expect(run).not.toHaveBeenCalled();
  });

  it("D1-6: says so when the record is not the person's to change, whether can() or the row's RLS refuses", async () => {
    run.mockResolvedValueOnce({ ok: false, reason: "forbidden" }).mockResolvedValueOnce({ ok: false, reason: "failed", message: "forbidden" });
    for (let i = 0; i < 2; i++) {
      expect(await updateLensCell({ type: "task", id: TASK, property: "estimate", value: "5" })).toEqual({
        ok: false,
        error: "You can view this record but not change it.",
      });
    }
  });

  it("stops at the rate limit", async () => {
    rateLimit.mockResolvedValue({ ok: false, error: "Slow down." });
    expect(await updateLensCell({ type: "task", id: TASK, property: "title", value: "x" })).toEqual({ ok: false, error: "Slow down." });
    expect(run).not.toHaveBeenCalled();
    expect(updateTask).not.toHaveBeenCalled();
  });

  it("[switch off] keeps the earlier commands and refuses the new columns", async () => {
    flags.wos_objects = false;
    expect(await updateLensCell({ type: "task", id: TASK, property: "title", value: "Old path" })).toEqual({ ok: true });
    expect(updateTask).toHaveBeenCalledWith({ taskId: TASK, title: "Old path" });
    expect(await updateLensCell({ type: "task", id: TASK, property: "estimate", value: "2" })).toMatchObject({ ok: false });
    expect(run).not.toHaveBeenCalled();
    expect(await pasteLensCells({ type: "task", cells: [{ id: TASK, property: "title", value: "x" }] })).toMatchObject({ ok: false, saved: 0 });
    expect(await undoLensCells({ changeSetIds: [TASK] })).toMatchObject({ ok: false, undone: 0 });
    expect(undo).not.toHaveBeenCalled();
  });
});

describe("pasteLensCells (D1-3)", () => {
  it("saves each allowed cell as its own change set and counts the refused ones", async () => {
    run
      .mockResolvedValueOnce({ ok: true, changeSet: { id: "cs-a" } })
      .mockResolvedValueOnce({ ok: false, reason: "forbidden" })
      .mockResolvedValueOnce({ ok: false, reason: "failed", message: "Nothing changed." });
    const result = await pasteLensCells({
      type: "task",
      cells: [
        { id: TASK, property: "estimate", value: "1" },
        { id: TASK, property: "estimate", value: "2" },
        { id: TASK, property: "estimate", value: "3" },
        { id: TASK, property: "estimate", value: "many" },
        { id: TASK, property: "created_time", value: "2026-01-01" },
      ],
    });
    expect(result).toEqual({ ok: true, saved: 2, refused: 3, failed: 0, changeSetIds: ["cs-a"] });
    expect(run).toHaveBeenCalledTimes(3);
    // One record's cells are saved in the order they were pasted.
    expect(run.mock.calls.map((c) => (c[1] as { value: number }).value)).toEqual([1, 2, 3]);
    expect(rateLimit).toHaveBeenCalledTimes(1);
  });

  it("refuses a paste over the limit as a whole", async () => {
    const cells = Array.from({ length: 501 }, () => ({ id: TASK, property: "title", value: "x" }));
    expect(await pasteLensCells({ type: "task", cells })).toMatchObject({ ok: false, saved: 0 });
    expect(run).not.toHaveBeenCalled();
  });
});

describe("undoLensCells (D1-4)", () => {
  const A = "22222222-2222-4222-8222-222222222222";
  const B = "33333333-3333-4333-8333-333333333333";

  it("undoes newest first", async () => {
    undo.mockResolvedValue({ ok: true, changeSet: { id: "u" } });
    expect(await undoLensCells({ changeSetIds: [A, B] })).toEqual({ ok: true, undone: 2 });
    expect(undo.mock.calls.map((c) => c[0])).toEqual([B, A]);
  });

  it("stops and says why when the value was changed since", async () => {
    undo.mockResolvedValue({ ok: false, reason: "failed", message: `conflict:${TASK}:title` });
    expect(await undoLensCells({ changeSetIds: [A] })).toEqual({
      ok: false,
      error: "Not undone: the value was changed again since.",
      undone: 0,
      conflict: true,
    });
  });

  it("reports a partial undo so the rest can be tried again", async () => {
    undo.mockResolvedValueOnce({ ok: true, changeSet: { id: "u" } }).mockResolvedValueOnce({ ok: false, reason: "failed", message: "boom" });
    expect(await undoLensCells({ changeSetIds: [A, B] })).toEqual({ ok: false, error: "The change could not be undone.", undone: 1 });
  });
});
