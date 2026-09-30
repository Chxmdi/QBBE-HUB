import { describe, expect, it } from "vitest";
import { goalProgress, percent, progressPart, type ProgressInput } from "../progress";
import { overrideTurnsOn } from "../flag";
import { goalsEn } from "../i18n/en";
import { goalsFrCA } from "../i18n/fr-CA";

const project = (over: Partial<ProgressInput> = {}): ProgressInput => ({
  kind: "project", ref_id: "p", label: "P", project_completed: false, tasks_done: 1, tasks_total: 4,
  metric_direction: null, metric_baseline: null, metric_target: null, metric_latest: null, metric_latest_on: null,
  ...over,
});
const metric = (over: Partial<ProgressInput> = {}): ProgressInput => ({
  kind: "metric", ref_id: "m", label: "M", project_completed: null, tasks_done: null, tasks_total: null,
  metric_direction: "increase", metric_baseline: "100", metric_target: "200", metric_latest: "150", metric_latest_on: "2026-09-30",
  ...over,
});

describe("goal progress", () => {
  it("a project counts finished tasks, and a completed project is whole", () => {
    expect(progressPart(project()).progress).toBe(0.25);
    expect(progressPart(project({ project_completed: true })).progress).toBe(1);
    expect(progressPart(project({ tasks_done: 0, tasks_total: 0 })).progress).toBe(0);
  });

  it("a metric runs from baseline to target, either way, and is clamped", () => {
    expect(progressPart(metric()).progress).toBe(0.5);
    expect(progressPart(metric({ metric_direction: "decrease", metric_baseline: 40, metric_target: 20, metric_latest: 25 })).progress).toBe(0.75);
    expect(progressPart(metric({ metric_latest: 260 })).progress).toBe(1);
    expect(progressPart(metric({ metric_latest: 80 })).progress).toBe(0);
  });

  it("a metric without a baseline, target or measurement is not measured yet", () => {
    expect(progressPart(metric({ metric_latest: null })).progress).toBeNull();
    expect(progressPart(metric({ metric_baseline: null })).progress).toBeNull();
  });

  it("the goal is the mean of what can be measured", () => {
    const parts = [project(), metric(), metric({ ref_id: "x", metric_latest: null })].map(progressPart);
    expect(goalProgress(parts)).toBe(0.375);
    expect(percent(goalProgress(parts))).toBe(38);
    expect(goalProgress([])).toBeNull();
    expect(percent(null)).toBeNull();
  });
});

describe("module plumbing", () => {
  it("reads the staging override by name", () => {
    expect(overrideTurnsOn("wos_goals", "all")).toBe(true);
    expect(overrideTurnsOn("wos_goals", "wos_goalsx")).toBe(false);
  });

  it("French has every English key with the same placeholders", () => {
    const leaves = (node: unknown, prefix = ""): [string, string][] =>
      Object.entries(node as Record<string, unknown>).flatMap(([key, value]) =>
        typeof value === "string" ? [[`${prefix}${key}`, value]] : leaves(value, `${prefix}${key}.`),
      );
    const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    const fr = new Map(leaves(goalsFrCA));
    for (const [key, text] of leaves(goalsEn)) {
      expect(fr.has(key), key).toBe(true);
      expect(placeholders(fr.get(key)!), key).toEqual(placeholders(text));
    }
  });
});
