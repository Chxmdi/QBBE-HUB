import { describe, expect, it } from "vitest";
import { blueprintsEn } from "../i18n/en";
import { blueprintsFrCA } from "../i18n/fr-CA";
import { findConflicts, planBlueprint } from "../plan";
import { previewBlueprint } from "../preview";
import { emptyBlueprint, keyFromName, validateBlueprint, type BlueprintInput } from "../schema";

function sample(): BlueprintInput {
  return {
    version: 1,
    key: "recruiting",
    name: { en: "Recruiting", fr: "Recrutement" },
    description: { en: "", fr: "" },
    types: [
      {
        key: "opening",
        name: { en: "Opening", fr: "Poste" },
        properties: [
          {
            key: "stage",
            name: { en: "Stage", fr: "Étape" },
            kind: "status",
            choices: [
              { key: "open", label: { en: "Open", fr: "Ouvert" } },
              { key: "filled", label: { en: "Filled", fr: "Pourvu" } },
            ],
          },
          { key: "salary", name: { en: "Salary", fr: "Salaire" }, kind: "currency", currency: "CAD" },
        ],
      },
      {
        key: "candidate",
        name: { en: "Candidate", fr: "Candidat" },
        properties: [
          { key: "applied_for", name: { en: "Applied for", fr: "Poste visé" }, kind: "relation", relation: "applies_for" },
          { key: "applied_on", name: { en: "Applied on", fr: "Date" }, kind: "date" },
        ],
      },
    ],
    relations: [
      {
        key: "applies_for",
        from: "candidate",
        to: "opening",
        name: { en: "applies for", fr: "postule à" },
        reverseName: { en: "applicants", fr: "candidatures" },
        cardinality: "many_to_many",
      },
    ],
    lenses: [{ key: "applications", type: "candidate", kind: "calendar", name: { en: "Calendar", fr: "Calendrier" }, groupBy: "applied_on" }],
    workflows: [
      {
        key: "welcome",
        type: "candidate",
        name: { en: "Welcome", fr: "Accueil" },
        trigger: { on: "created" },
        steps: [{ kind: "create_task", title: { en: "Call back", fr: "Rappeler" }, dueInDays: 2 }],
      },
    ],
  };
}

function issueCodes(input: unknown): string[] {
  const result = validateBlueprint(input);
  return result.ok ? [] : result.issues.map((issue) => issue.code);
}

describe("validateBlueprint", () => {
  it("accepts a complete blueprint", () => {
    expect(validateBlueprint(sample()).ok).toBe(true);
    expect(validateBlueprint(emptyBlueprint()).ok).toBe(true);
  });

  it("requires both languages", () => {
    const bp = sample();
    bp.types[0].name.fr = " ";
    expect(issueCodes(bp)).toContain("missingFrench");
  });

  it("rejects bad keys and duplicates", () => {
    const bp = sample();
    bp.types[1].key = "Opening";
    expect(issueCodes(bp)).toContain("invalidKey");
    const dup = sample();
    dup.types[1].key = "opening";
    expect(issueCodes(dup)).toContain("duplicateKey");
  });

  it("checks choices, currency and relations", () => {
    const bp = sample();
    bp.types[0].properties[0].choices = [];
    bp.types[0].properties[1].currency = undefined;
    bp.types[1].properties[0].relation = "missing";
    expect(issueCodes(bp)).toEqual(expect.arrayContaining(["needsChoices", "needsCurrency", "unknownRelation"]));
  });

  it("refuses a relation property on a type the relation does not touch", () => {
    const bp = sample();
    bp.types[0].properties.push({ key: "rel", name: { en: "R", fr: "R" }, kind: "relation", relation: "applies_for" });
    bp.relations[0].to = "candidate";
    expect(issueCodes(bp)).toContain("relationNotOnType");
  });

  it("checks lens, form and workflow references", () => {
    const bp = sample();
    bp.lenses = [{ key: "b", type: "opening", kind: "board", name: { en: "B", fr: "B" }, groupBy: "salary" }];
    bp.forms = [{ key: "f", type: "ghost", name: { en: "F", fr: "F" }, fields: ["title"] }];
    bp.workflows![0].steps = [{ kind: "set_property", property: "nope", value: "x" }];
    expect(issueCodes(bp)).toEqual(expect.arrayContaining(["boardNeedsChoice", "unknownType", "unknownProperty"]));
  });

  it("does not let a blueprint declare automatic properties", () => {
    const bp = sample();
    (bp.types[0].properties as unknown[]).push({ key: "made", name: { en: "M", fr: "M" }, kind: "created_time" });
    expect(validateBlueprint(bp).ok).toBe(false);
  });

  it("has a message in both languages for every validation code", () => {
    for (const code of ["invalid", "invalidKey", "duplicateKey", "needsChoices", "unknownRelation", "boardNeedsChoice", "calendarNeedsDate"]) {
      expect(blueprintsEn.errors).toHaveProperty(code);
      expect(blueprintsFrCA.errors).toHaveProperty(code);
    }
  });
});

describe("previewBlueprint", () => {
  it("adds a table and a form per type and a board where there is a status", () => {
    const result = validateBlueprint(sample());
    if (!result.ok) throw new Error("sample should validate");
    const preview = previewBlueprint(result.blueprint);
    expect(preview.lenses.map((l) => [l.key, l.kind, l.source])).toEqual([
      ["applications", "calendar", "blueprint"],
      ["opening_table", "table", "default"],
      ["opening_board", "board", "default"],
      ["candidate_table", "table", "default"],
    ]);
    expect(preview.lenses.find((l) => l.kind === "board")?.groupBy).toBe("stage");
    expect(preview.forms.map((f) => f.fields)).toEqual([
      ["title", "stage", "salary"],
      ["title", "applied_on"],
    ]);
  });
});

describe("planBlueprint", () => {
  it("creates everything in one ordered list, tagged with the blueprint", () => {
    const result = validateBlueprint(sample());
    if (!result.ok) throw new Error("sample should validate");
    let n = 0;
    const plan = planBlueprint(result.blueprint, () => `id-${++n}`);
    expect(plan.counts).toEqual({
      object_type: 2,
      relation_type: 1,
      property_definition: 4,
      lens: 4,
      form: 2,
      workflow: 1,
    });
    expect(plan.changes).toHaveLength(14);
    expect(plan.changes.every((c) => c.kind === "create" && c.values.blueprint_key === "recruiting")).toBe(true);

    const relation = plan.changes.find((c) => c.kind === "create" && c.object.type === "relation_type");
    expect(relation?.kind === "create" && relation.values).toMatchObject({ from_type_id: "id-2", to_type_id: "id-1" });
    const property = plan.changes.find(
      (c) => c.kind === "create" && c.object.type === "property_definition" && c.values.key === "applied_for",
    );
    expect(property?.kind === "create" && property.values.options).toEqual({
      relationTypeKey: "applies_for",
      relationTypeId: "id-3",
      direction: "outgoing",
      targetTypeKey: "opening",
    });
    const workflow = plan.changes.find((c) => c.kind === "create" && c.object.type === "workflow");
    expect(workflow?.kind === "create" && workflow.values.enabled).toBe(false);
  });

  it("finds clashes with native types and earlier builds", () => {
    const result = validateBlueprint({ ...sample(), types: [{ key: "task", name: { en: "T", fr: "T" }, properties: [] }], relations: [], lenses: [], workflows: [] });
    if (!result.ok) throw new Error("should validate");
    expect(findConflicts(result.blueprint, { types: [], relations: [] })).toEqual([{ kind: "type", key: "task" }]);
    const ok = validateBlueprint(sample());
    if (!ok.ok) throw new Error("should validate");
    expect(findConflicts(ok.blueprint, { types: ["candidate"], relations: ["applies_for"] })).toEqual([
      { kind: "type", key: "candidate" },
      { kind: "relation", key: "applies_for" },
    ]);
  });
});

describe("keyFromName", () => {
  it("makes a key from a name in either language", () => {
    expect(keyFromName("Job opening")).toBe("job_opening");
    expect(keyFromName("Événement spécial")).toBe("evenement_special");
    expect(keyFromName("2024 plan")).toBe("plan");
    expect(keyFromName("!!!")).toBe("item");
  });
});
