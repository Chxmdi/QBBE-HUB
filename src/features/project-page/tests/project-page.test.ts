import { describe, expect, it } from "vitest";
import { formattersFor } from "@/lib/i18n/format";
import { QueryError } from "@/lib/query/errors";
import { fromContractSpec } from "@/lib/query/contract-adapter";
import type { LensResult } from "@/lib/query/run";
import { migrationCatalog } from "@/lib/query/testing/migration-catalog";
import { catalogKeys } from "@/features/universal-tasks/i18n/module-i18n";
import { BLOCK_KEYS, projectBlocks } from "../blocks";
import { calculateHealth, calculateProgress, type HealthInput } from "../health";
import { projectPageCatalogs, projectPageT } from "../i18n";
import { reasonText } from "../components/living-project";
import { objectHref } from "@/lib/query/links";
import { runBlockSpec } from "../run-blocks";

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

const catalog = migrationCatalog();

describe("query blocks", () => {
  it("are one query spec per section, all limited to the project, and all ones the engine accepts", () => {
    const blocks = projectBlocks(PROJECT);
    expect(blocks.map((block) => block.key)).toEqual([...BLOCK_KEYS]);
    for (const block of blocks) {
      expect(block.spec.version).toBe(1);
      expect(JSON.stringify(block.spec.filter)).toContain(PROJECT);
      expect(block.spec.limit).toBeGreaterThan(0);
      // The real catalog (read from the migration) accepts every property, sort and filter the spec names.
      const lens = fromContractSpec(block.spec, catalog);
      const type = catalog[lens.type];
      for (const key of lens.select ?? []) expect(type.properties.find((p) => p.key === key), `${lens.type}.${key}`).toBeDefined();
      for (const sort of lens.sort ?? []) {
        expect(type.properties.find((p) => p.key === sort.property)?.sortable, `${lens.type} sorts by ${sort.property}`).toBe(true);
      }
    }
  });

  it("compile to the lens specs the database test (supabase/tests/lens-more-types.sql) compares with the old readers", () => {
    const risks = projectBlocks(PROJECT).find((block) => block.key === "risks")!;
    expect(fromContractSpec(risks.spec, catalog)).toEqual({
      version: 1,
      type: "risk",
      where: {
        and: [
          { property: "project", operator: "contains", value: PROJECT },
          { property: "status", operator: "is_any_of", value: ["open", "mitigating"] },
        ],
      },
      sort: [{ property: "score", direction: "desc" }],
      select: ["status", "likelihood", "impact", "score", "project"],
      limit: 8,
      offset: 0,
    });
    const files = projectBlocks(PROJECT).find((block) => block.key === "files")!;
    expect(fromContractSpec(files.spec, catalog)).toEqual({
      version: 1,
      type: "document",
      where: { and: [{ property: "project", operator: "contains", value: PROJECT }] },
      sort: [{ property: "edited_time", direction: "desc" }],
      select: ["edited_time", "kind"],
      limit: 8,
      offset: 0,
    });
  });
});

describe("the block runner", () => {
  const MEETING = "22222222-2222-4222-8222-222222222222";
  const TASK = "33333333-3333-4333-8333-333333333333";

  function fakeEngine(result: Partial<LensResult>) {
    const calls: Record<string, unknown>[] = [];
    const client = {
      rpc: (fn: string, args?: Record<string, unknown>) => {
        calls.push({ fn, ...args });
        return Promise.resolve({
          data: { type: "risk", columns: [], groupBy: null, rows: [], total: 0, groups: null, limit: 8, offset: 0, ...result },
          error: null,
        });
      },
    };
    return { client, calls };
  }

  it("runs the spec through lens_query on the viewer's client and links each row", async () => {
    const { client, calls } = fakeEngine({
      rows: [
        {
          id: "r1",
          title: "Venue falls through",
          group: null,
          values: { status: "open", likelihood: "high", impact: "medium", score: 6, project: { id: PROJECT, label: "Living" } },
        },
      ],
      total: 1,
    });
    const risks = projectBlocks(PROJECT).find((block) => block.key === "risks")!;
    const rows = await runBlockSpec(client, catalog, risks.spec, { timeZone: "America/Toronto" });
    expect(calls).toEqual([{ fn: "lens_query", spec: fromContractSpec(risks.spec, catalog), time_zone: "America/Toronto" }]);
    expect(rows[0]).toEqual({
      ref: { id: "r1", type: "risk" },
      title: "Venue falls through",
      href: `/projects/${PROJECT}`,
      values: {
        status: { kind: "status", value: "open" },
        likelihood: { kind: "select", value: "high" },
        impact: { kind: "select", value: "medium" },
        score: { kind: "number", value: 6 },
        project: { kind: "relation", value: [{ id: PROJECT, type: "project" }] },
      },
    });
  });

  it("links each type where its screen lives", () => {
    const project = { kind: "relation" as const, value: [{ id: PROJECT, type: "project" }] };
    const meeting = { kind: "relation" as const, value: [{ id: MEETING, type: "meeting" }] };
    const row = (type: string, values: Record<string, never | typeof project>) => ({ ref: { id: "x", type }, title: "", values });
    expect(objectHref(row("task", {}))).toBe("/my-work?task=x");
    expect(objectHref(row("document", { project }))).toBe("/documents/x");
    expect(objectHref(row("decision", { project, meeting }))).toBe(`/meetings/${MEETING}`);
    expect(objectHref(row("decision", { project, meeting: null as never }))).toBe(`/projects/${PROJECT}`);
    expect(objectHref(row("milestone", { project }))).toBe(`/projects/${PROJECT}`);
    expect(objectHref(row("risk", { project }))).toBe(`/projects/${PROJECT}`);
    expect(
      objectHref({ ref: { id: "x", type: "activity" }, title: "", values: { project, source_type: { kind: "text", value: "task" }, source_id: { kind: "text", value: TASK } } }),
    ).toBe(`/my-work?task=${TASK}`);
    expect(
      objectHref({ ref: { id: "x", type: "activity" }, title: "", values: { project, source_type: { kind: "text", value: "comment" }, source_id: { kind: "text", value: TASK } } }),
    ).toBe(`/projects/${PROJECT}`);
    // A hidden project (the engine shows nothing the viewer cannot read) falls back to the list.
    expect(objectHref(row("milestone", {}))).toBe("/projects");
  });

  it("refuses what the engine cannot answer instead of guessing", async () => {
    const { client, calls } = fakeEngine({});
    const options = { timeZone: "America/Toronto" };
    await expect(runBlockSpec(client, catalog, { version: 1, types: ["risk"], filter: { property: "secret", op: "eq", value: 1 } }, options)).rejects.toThrow(QueryError);
    await expect(runBlockSpec(client, catalog, { version: 1, types: ["goal"] }, options)).rejects.toThrow(QueryError);
    await expect(runBlockSpec(client, catalog, { version: 1, types: ["risk"], filter: { property: "score", op: "contains", value: 1 } }, options)).rejects.toThrow(QueryError);
    expect(calls).toEqual([]);
  });
});

describe("project page catalogue", () => {
  it("has every English key in French", () => {
    expect(catalogKeys(projectPageCatalogs["fr-CA"])).toEqual(catalogKeys(projectPageCatalogs.en));
  });
});
