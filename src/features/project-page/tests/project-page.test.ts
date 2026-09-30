import { describe, expect, it } from "vitest";
import { formattersFor } from "@/lib/i18n/format";
import { QueryNotSupportedError } from "@/lib/objects/stubs";
import { catalogKeys } from "@/features/universal-tasks/i18n/module-i18n";
import { BLOCK_KEYS, projectBlocks } from "../blocks";
import { calculateHealth, calculateProgress, type HealthInput } from "../health";
import { projectPageCatalogs, projectPageT } from "../i18n";
import { reasonText } from "../components/living-project";
import { NATIVE_TYPES, runNativeSpec } from "../run-blocks";

const TODAY = "2026-10-07";
const PROJECT = "11111111-1111-4111-8111-111111111111";

function input(overrides: Partial<HealthInput> = {}): HealthInput {
  return { today: TODAY, project: { target_date: null, completed_at: null }, tasks: [], milestones: [], risks: [], ...overrides };
}
const open = (due: string | null = null, status = "in_progress") => ({ status, due_at: due });

describe("progress", () => {
  it("counts done tasks over tasks that are not cancelled", () => {
    const progress = calculateProgress({
      tasks: [open(), open(null, "completed"), open(null, "completed"), open(null, "cancelled")],
      milestones: [{ due_date: null, completed_at: null, status: "planned" }],
    });
    expect(progress).toEqual({ tasks: { done: 2, total: 3 }, milestones: { done: 0, total: 1 }, percent: 67 });
  });

  it("falls back to milestones, then to unknown", () => {
    expect(
      calculateProgress({
        tasks: [],
        milestones: [
          { due_date: null, completed_at: "2026-10-01T00:00:00Z", status: "planned" },
          { due_date: null, completed_at: null, status: "completed" },
          { due_date: null, completed_at: null, status: "planned" },
          { due_date: null, completed_at: null, status: "planned" },
        ],
      }).percent,
    ).toBe(50);
    expect(calculateProgress({ tasks: [], milestones: [] }).percent).toBeNull();
  });
});

describe("health", () => {
  it("is on track with no warning signs", () => {
    expect(calculateHealth(input({ tasks: [open("2026-10-20")] }))).toMatchObject({ health: "on_track", reasons: [] });
  });

  it("is completed once the project is", () => {
    expect(calculateHealth(input({ project: { target_date: "2026-01-01", completed_at: "2026-01-02" } })).health).toBe("completed");
  });

  it("is off track past the target, with two overdue milestones, or a quarter of open work overdue", () => {
    expect(calculateHealth(input({ project: { target_date: "2026-10-06", completed_at: null } })).reasons).toEqual([
      { rule: "target_passed", level: "off_track", date: "2026-10-06" },
    ]);
    const late = { due_date: "2026-10-01", completed_at: null, status: "planned" };
    expect(calculateHealth(input({ milestones: [late, late] })).health).toBe("off_track");
    expect(calculateHealth(input({ tasks: [open("2026-10-01"), open("2026-10-02"), open(), open(), open(), open()] })).reasons).toEqual([
      { rule: "tasks_overdue", level: "off_track", count: 2, open: 6 },
    ]);
  });

  it("is at risk for one overdue milestone or task, a blocked task, a severe risk or deadline pressure", () => {
    const late = { due_date: "2026-10-01", completed_at: null, status: "planned" };
    expect(calculateHealth(input({ milestones: [late] })).health).toBe("at_risk");
    // One overdue task of nine is under a quarter.
    expect(calculateHealth(input({ tasks: [open("2026-10-01"), ...Array.from({ length: 8 }, () => open())] })).reasons).toEqual([
      { rule: "tasks_overdue", level: "at_risk", count: 1, open: 9 },
    ]);
    expect(calculateHealth(input({ tasks: [open(null, "blocked")] })).reasons[0]).toEqual({ rule: "tasks_blocked", level: "at_risk", count: 1 });
    expect(
      calculateHealth(input({ risks: [{ likelihood: "high", impact: "high", status: "mitigating" }, { likelihood: "high", impact: "high", status: "closed" }, { likelihood: "high", impact: "low", status: "open" }] })).reasons,
    ).toEqual([{ rule: "severe_risks", level: "at_risk", count: 1 }]);
    expect(
      calculateHealth(input({ project: { target_date: "2026-10-17", completed_at: null }, tasks: [open(), open(null, "completed")] })).reasons,
    ).toEqual([{ rule: "deadline_pressure", level: "at_risk", days: 10, percent: 50 }]);
    // Far from the target, or far enough along, is not pressure.
    expect(calculateHealth(input({ project: { target_date: "2026-11-30", completed_at: null }, tasks: [open()] })).health).toBe("on_track");
  });

  it("lists off-track reasons before at-risk ones", () => {
    const result = calculateHealth(
      input({ project: { target_date: "2026-10-01", completed_at: null }, tasks: [open(null, "blocked")] }),
    );
    expect(result.health).toBe("off_track");
    expect(result.reasons.map((reason) => reason.level)).toEqual(["off_track", "at_risk"]);
  });

  it("explains each reason in both languages", () => {
    const reasons = calculateHealth(
      input({
        project: { target_date: "2026-10-01", completed_at: null },
        tasks: [open("2026-10-01"), open("2026-10-02", "blocked")],
        milestones: [{ due_date: "2026-10-01", completed_at: null, status: "planned" }],
        risks: [{ likelihood: "high", impact: "high", status: "open" }],
      }),
    ).reasons;
    const en = reasons.map((reason) => reasonText(reason, projectPageT("en"), formattersFor("en"), "America/Toronto"));
    expect(en).toContain("2 of 2 open tasks are overdue");
    expect(en).toContain("1 task is blocked");
    expect(en).toContain("1 milestone is overdue");
    expect(en).toContain("1 open risk is high likelihood and high impact");
    const fr = reasons.map((reason) => reasonText(reason, projectPageT("fr-CA"), formattersFor("fr-CA"), "America/Toronto"));
    expect(fr).toContain("2 des 2 tâches ouvertes sont en retard");
  });
});

describe("query blocks", () => {
  it("are one query spec per section, all limited to the project", () => {
    const blocks = projectBlocks(PROJECT);
    expect(blocks.map((block) => block.key)).toEqual([...BLOCK_KEYS]);
    for (const block of blocks) {
      expect(block.spec.version).toBe(1);
      expect(JSON.stringify(block.spec.filter)).toContain(PROJECT);
      expect(block.spec.limit).toBeGreaterThan(0);
      const type = block.spec.types[0];
      if (type !== "task") {
        // Every property the spec names exists on its reader.
        const names = [
          ...(block.spec.properties ?? []),
          ...(block.spec.sorts ?? []).map((sort) => sort.property as string),
        ];
        for (const name of names) expect(NATIVE_TYPES[type].properties[name], `${type}.${name}`).toBeDefined();
      }
    }
  });
});

describe("the native block runner", () => {
  function fakeDb(rows: Record<string, unknown>[]) {
    const calls: [string, ...unknown[]][] = [];
    const builder: Record<string, unknown> = {};
    for (const method of ["select", "eq", "neq", "in", "lt", "lte", "gt", "gte", "is", "not", "order"]) {
      builder[method] = (...args: unknown[]) => {
        calls.push([method, ...args]);
        return builder;
      };
    }
    builder.limit = (count: number) => {
      calls.push(["limit", count]);
      return Promise.resolve({ data: rows, error: null });
    };
    return {
      calls,
      db: { from: (table: string) => (calls.push(["from", table]), builder) } as never,
    };
  }

  it("turns the spec into filters, sorts and a limit on the viewer's client", async () => {
    const { db, calls } = fakeDb([
      { id: "r1", title: "Venue falls through", project_id: PROJECT, status: "open", likelihood: "high", impact: "medium", score: 6 },
    ]);
    const risks = projectBlocks(PROJECT).find((block) => block.key === "risks")!;
    const rows = await runNativeSpec(db, risks.spec);
    expect(calls).toContainEqual(["from", "risk"]);
    expect(calls).toContainEqual(["eq", "project_id", PROJECT]);
    expect(calls).toContainEqual(["in", "status", ["open", "mitigating"]]);
    expect(calls).toContainEqual(["order", "score", { ascending: false, nullsFirst: false }]);
    expect(calls).toContainEqual(["limit", 8]);
    expect(rows[0]).toMatchObject({
      ref: { id: "r1", type: "risk" },
      title: "Venue falls through",
      href: `/projects/${PROJECT}`,
      values: { score: { kind: "number", value: 6 }, likelihood: { kind: "select", value: "high" } },
    });
  });

  it("refuses what it cannot answer instead of guessing", async () => {
    const { db } = fakeDb([]);
    await expect(runNativeSpec(db, { version: 1, types: ["risk"], filter: { or: [] } })).rejects.toThrow(QueryNotSupportedError);
    await expect(runNativeSpec(db, { version: 1, types: ["risk"], filter: { property: "secret", op: "eq", value: 1 } })).rejects.toThrow(
      QueryNotSupportedError,
    );
    await expect(runNativeSpec(db, { version: 1, types: ["goal"] })).rejects.toThrow(QueryNotSupportedError);
  });
});

describe("project page catalogue", () => {
  it("has every English key in French", () => {
    expect(catalogKeys(projectPageCatalogs["fr-CA"])).toEqual(catalogKeys(projectPageCatalogs.en));
  });
});
