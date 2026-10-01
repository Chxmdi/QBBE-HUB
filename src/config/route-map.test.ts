import { readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DAILY_TASKS, ROUTE_MAP } from "./route-map";

const APP_DIR = path.resolve(__dirname, "../app");

/** Every page.tsx under src/app, as the URL pattern Next.js serves it at. */
function routesInApp(): string[] {
  const routes: string[] = [];
  const walk = (dir: string, segments: string[]) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        // A `_private` folder is not routed; a `@slot` folder is a parallel
        // route whose pages serve at the parent's URL.
        if (entry.name.startsWith("_")) continue;
        walk(path.join(dir, entry.name), [...segments, entry.name]);
      } else if (entry.name === "page.tsx") {
        routes.push(patternFor(segments));
      }
    }
  };
  walk(APP_DIR, []);
  return routes.sort();
}

/** Drops route groups like `(workspace)` and slots like `@modal`; keeps dynamic segments like `[id]`. */
function patternFor(segments: string[]): string {
  const visible = segments.filter(
    (s) => !(s.startsWith("(") && s.endsWith(")")) && !s.startsWith("@"),
  );
  return "/" + visible.join("/");
}

const byPattern = new Map(ROUTE_MAP.map((entry) => [entry.pattern, entry]));

describe("route map", () => {
  it("classifies every page.tsx under src/app exactly once", () => {
    const routes = routesInApp();
    expect(routes.length).toBeGreaterThan(0);

    const unmapped = routes.filter((route) => !byPattern.has(route));
    expect(unmapped, "pages with no ROUTE_MAP entry").toEqual([]);

    const duplicates = ROUTE_MAP.map((e) => e.pattern).filter(
      (pattern, index, all) => all.indexOf(pattern) !== index,
    );
    expect(duplicates, "patterns listed more than once").toEqual([]);

    const stale = ROUTE_MAP.map((e) => e.pattern).filter((p) => !routes.includes(p));
    expect(stale, "ROUTE_MAP entries with no page.tsx").toEqual([]);

    expect(ROUTE_MAP.length).toBe(routes.length);
  });

  it("names a canonical destination for every migration and deprecated entry, and only those", () => {
    for (const entry of ROUTE_MAP) {
      const leaving = entry.status === "migration" || entry.status === "deprecated";
      if (leaving) {
        expect(entry.canonical, `${entry.pattern} needs a canonical`).toBeTruthy();
        const target = byPattern.get(entry.canonical!);
        expect(target, `${entry.pattern} -> ${entry.canonical} is not in the map`).toBeDefined();
        expect(target!.pattern, `${entry.pattern} points at itself`).not.toBe(entry.pattern);
        expect(
          ["migration", "deprecated"].includes(target!.status),
          `${entry.pattern} -> ${entry.canonical} is itself on its way out`,
        ).toBe(false);
      } else {
        expect(entry.canonical, `${entry.pattern} is ${entry.status} and must not name a canonical`).toBeUndefined();
      }
    }
  });

  it("marks beta entries with a wos_* switch and nothing in production with one", () => {
    for (const entry of ROUTE_MAP) {
      if (entry.status === "beta") {
        expect(entry.switch, `${entry.pattern} is beta without a switch`).toMatch(/^wos_[a-z0-9_]+$/);
      }
      if (entry.status === "production") {
        expect(entry.switch, `${entry.pattern} is production but has a switch`).toBeUndefined();
      }
      if (entry.switch) expect(entry.switch).toMatch(/^wos_[a-z0-9_]+$/);
    }
  });

  it("keeps the admin status to the administration areas", () => {
    for (const entry of ROUTE_MAP) {
      const inAdminArea =
        entry.pattern === "/admin" ||
        entry.pattern.startsWith("/admin/") ||
        ["/spaces/admin", "/spaces/roles", "/spaces/publish"].includes(entry.pattern);
      expect(entry.status === "admin", `${entry.pattern}: admin status and admin area disagree`).toBe(inAdminArea);
    }
  });

  it("names one canonical destination per daily task, each exactly once", () => {
    const expectedTasks = ["Home", "My Work", "Pages", "Data", "Communication", "Programs", "Settings"];
    expect(DAILY_TASKS.map((d) => d.task).sort()).toEqual([...expectedTasks].sort());

    const destinations = DAILY_TASKS.map((d) => d.canonical);
    expect(new Set(destinations).size, "two daily tasks share a destination").toBe(destinations.length);

    for (const { task, canonical } of DAILY_TASKS) {
      const target = byPattern.get(canonical);
      expect(target, `${task} -> ${canonical} is not in the map`).toBeDefined();
      expect(
        ["migration", "deprecated"].includes(target!.status),
        `${task} -> ${canonical} must not be a screen on its way out`,
      ).toBe(false);
      expect(target!.task.length, `${canonical} has an empty task`).toBeGreaterThan(0);
    }
  });

  it("gives every entry a task", () => {
    for (const entry of ROUTE_MAP) {
      expect(entry.task.trim().length, entry.pattern).toBeGreaterThan(0);
    }
  });
});
