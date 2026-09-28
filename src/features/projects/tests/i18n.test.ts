import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { portfolioEn } from "@/lib/i18n/messages/workspace/portfolio.en";
import { createTranslator } from "@/lib/i18n/translate";
import { accessRoleLabel, localizeIssue } from "@/features/projects/i18n";
import { completeMilestoneSchema } from "@/features/projects/schemas";
import { updateRiskSchema } from "@/features/risks/schemas";
import { recordOperationSchema } from "@/features/outcomes/schemas";

const en = createTranslator("en");
const fr = createTranslator("fr-CA");

// Where the schema sentences live. A `validation` entry that no longer appears
// in any of these files has drifted from its schema and would stop translating.
const SOURCES = [
  "src/features/projects/schemas.ts",
  "src/features/projects/services/project.commands.ts",
  "src/features/programs/services/program.commands.ts",
  "src/features/programs/services/program-template.commands.ts",
  "src/features/risks/schemas.ts",
  "src/features/outcomes/schemas.ts",
].map((path) => readFileSync(join(process.cwd(), path), "utf8"));

describe("portfolio validation messages (#141)", () => {
  it("every catalogued sentence is still written in a schema", () => {
    for (const ns of ["projects", "programs", "risks", "outcomes"] as const) {
      for (const [key, text] of Object.entries(portfolioEn[ns].validation)) {
        expect(
          SOURCES.some((source) => source.includes(JSON.stringify(text))),
          `${ns}.validation.${key}`,
        ).toBe(true);
      }
    }
  });

  it("keeps English schema messages word for word and translates them to French", () => {
    const cases = [
      completeMilestoneSchema.safeParse({
        milestoneId: "00000000-0000-4000-8000-000000000000",
        completed: true,
      }),
      updateRiskSchema.safeParse({
        riskId: "00000000-0000-4000-8000-000000000000",
        status: "accepted",
      }),
      recordOperationSchema.safeParse({
        programId: "00000000-0000-4000-8000-000000000000",
        title: "Reading club",
        occurredOn: "2026-09-01",
        status: "delivered",
      }),
    ];
    for (const result of cases) {
      expect(result.success).toBe(false);
      if (result.success) continue;
      const message = result.error.issues[0].message;
      expect(localizeIssue(en, message, "projects.errors.invalidInput")).toBe(message);
      const french = localizeIssue(fr, message, "projects.errors.invalidInput");
      expect(french).not.toBe(message);
      expect(french.length).toBeGreaterThan(0);
    }
  });

  it("passes an unknown message through in English and falls back in French", () => {
    const message = "String must contain at most 200 character(s)";
    expect(localizeIssue(en, message, "projects.errors.invalidInput")).toBe(message);
    expect(localizeIssue(fr, message, "projects.errors.invalidInput")).toBe("Saisie invalide.");
  });

  it("names access roles as the page always did in English", () => {
    expect(accessRoleLabel("project_manager", en)).toBe("project manager");
    expect(accessRoleLabel("read_only", fr)).toBe("lecture seule");
    expect(accessRoleLabel("something_new", fr)).toBe("something new");
  });
});
