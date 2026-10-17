import { execSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { triggerEventLabel } from "@/features/admin/labels";
import { createTranslator } from "@/lib/i18n/translate";

/**
 * Every trigger the app records on a workflow run is shown on Admin by name.
 * One without a label fell back to its raw code: "object event" on the French
 * Admin page (release candidate, 2026-10-05).
 */
const recorded = [
  ...new Set(
    execSync("git grep -hoE 'trigger_event: \"[a-z_]+\"' -- src", { encoding: "utf8" })
      .split("\n")
      .map((line) => line.match(/"([a-z_]+)"/)?.[1])
      .filter((code): code is string => Boolean(code)),
  ),
];

describe("workflow trigger labels on Admin", () => {
  it("finds the triggers the app records", () => {
    expect(recorded).toEqual(expect.arrayContaining(["object_event", "task_status_changed"]));
  });

  it.each(["en", "fr-CA"] as const)("has a label for every recorded trigger in %s", (locale) => {
    const t = createTranslator(locale);
    for (const code of recorded) {
      const key = `admin.workspace.workflows.triggerEvents.${code}` as Parameters<typeof t>[0];
      expect(t(key), code).not.toBe(key);
    }
  });

  it("calls a record-change run what it is in French", () => {
    expect(triggerEventLabel("object_event", createTranslator("fr-CA"))).toBe("fiche modifiée");
  });
});
