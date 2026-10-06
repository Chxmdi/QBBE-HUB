import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { dueGroup, groupTasks } from "../group";
import { overrideTurnsOn } from "../flag";
import { mobileEn } from "../i18n/en";
import { mobileFrCA } from "../i18n/fr-CA";
import manifest from "@/app/manifest";

describe("due groups", () => {
  it("sorts a due date into overdue, today, the next week, later or none", () => {
    expect(dueGroup("2026-09-29", "2026-09-30")).toBe("overdue");
    expect(dueGroup("2026-09-30", "2026-09-30")).toBe("today");
    expect(dueGroup("2026-10-07", "2026-09-30")).toBe("week");
    expect(dueGroup("2026-10-08", "2026-09-30")).toBe("later");
    expect(dueGroup(null, "2026-09-30")).toBe("none");
  });

  it("groups tasks in date order, with today inside the next seven days", () => {
    const groups = groupTasks(
      [
        { id: "c", dueOn: "2026-10-03" },
        { id: "a", dueOn: "2026-09-30" },
        { id: "o", dueOn: "2026-09-01" },
        { id: "n", dueOn: null },
        { id: "l", dueOn: "2026-12-01" },
      ],
      "2026-09-30",
    );
    expect(groups.overdue.map((t) => t.id)).toEqual(["o"]);
    expect(groups.week.map((t) => t.id)).toEqual(["a", "c"]);
    expect(groups.later.map((t) => t.id)).toEqual(["l"]);
    expect(groups.none.map((t) => t.id)).toEqual(["n"]);
  });
});

describe("installable web app", () => {
  it("names the app, opens on Home and lists icons that exist", () => {
    const m = manifest();
    expect(m.name).toBe("QBBE Hub");
    expect(m.start_url).toBe("/");
    expect(m.display).toBe("standalone");
    const sizes = (m.icons ?? []).map((icon) => icon.sizes);
    expect(sizes).toEqual(expect.arrayContaining(["192x192", "512x512"]));
    expect((m.icons ?? []).some((icon) => icon.purpose === "maskable")).toBe(true);
    for (const icon of m.icons ?? []) {
      expect(existsSync(join(process.cwd(), "public", icon.src)), icon.src).toBe(true);
    }
  });
});

describe("module plumbing", () => {
  it("reads the staging override by name", () => {
    expect(overrideTurnsOn("wos_mobile", "wos_mobile")).toBe(true);
    expect(overrideTurnsOn("wos_mobile", "")).toBe(false);
  });

  it("French has every English key with the same placeholders", () => {
    const leaves = (node: unknown, prefix = ""): [string, string][] =>
      Object.entries(node as Record<string, unknown>).flatMap(([key, value]) =>
        typeof value === "string" ? [[`${prefix}${key}`, value]] : leaves(value, `${prefix}${key}.`),
      );
    const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    const fr = new Map(leaves(mobileFrCA));
    for (const [key, text] of leaves(mobileEn)) {
      expect(fr.has(key), key).toBe(true);
      expect(placeholders(fr.get(key)!), key).toEqual(placeholders(text));
    }
  });
});
