import { describe, expect, it } from "vitest";
import { formulaExample, sampleRecord } from "../formula-examples";
import { blueprintsEn } from "../i18n/en";
import { blueprintsFrCA } from "../i18n/fr-CA";
import { orderProperties, planBlueprint } from "../plan";
import { starterBlueprints } from "../starters";
import { validateBlueprint, type Blueprint, type BlueprintInput } from "../schema";

/**
 * Formulas and rollups as blueprint property kinds (U7): the schema accepts
 * and refuses them with messages in both languages, the plan orders them
 * after what they read, and the designer's worked example matches the engine.
 */

function sample(): BlueprintInput {
  return {
    version: 1,
    key: "grants",
    name: { en: "Grants", fr: "Subventions" },
    description: { en: "", fr: "" },
    types: [
      {
        key: "grant_application",
        name: { en: "Application", fr: "Demande" },
        properties: [
          { key: "requested", name: { en: "Amount requested", fr: "Montant demandé" }, kind: "currency", currency: "CAD" },
          { key: "awarded", name: { en: "Amount awarded", fr: "Montant accordé" }, kind: "currency", currency: "CAD" },
          {
            key: "shortfall",
            name: { en: "Shortfall", fr: "Manque à gagner" },
            kind: "formula",
            expression: 'prop("Amount requested") - prop("awarded")',
          },
          {
            key: "share",
            name: { en: "Share awarded", fr: "Part accordée" },
            kind: "formula",
            expression: 'round(100 * (1 - prop("shortfall") / prop("requested")), 1)',
          },
          { key: "reports", name: { en: "Reports", fr: "Rapports" }, kind: "relation", relation: "reports_on" },
          {
            key: "report_count",
            name: { en: "Reports filed", fr: "Rapports déposés" },
            kind: "rollup",
            rollup: { relation: "reports", function: "count" },
          },
          {
            key: "hours_total",
            name: { en: "Hours reported", fr: "Heures déclarées" },
            kind: "rollup",
            rollup: { relation: "reports", target: "hours", function: "sum" },
          },
        ],
      },
      {
        key: "grant_report",
        name: { en: "Report", fr: "Rapport" },
        properties: [
          { key: "hours", name: { en: "Hours", fr: "Heures" }, kind: "number" },
          { key: "grant", name: { en: "Grant", fr: "Subvention" }, kind: "relation", relation: "reports_on" },
        ],
      },
    ],
    relations: [
      {
        key: "reports_on",
        from: "grant_report",
        to: "grant_application",
        name: { en: "reports on", fr: "rend compte de" },
        reverseName: { en: "reports", fr: "rapports" },
        cardinality: "one_to_many",
      },
    ],
  };
}

function valid(input: BlueprintInput): Blueprint {
  const result = validateBlueprint(input);
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.blueprint;
}

function issues(input: unknown) {
  const result = validateBlueprint(input);
  return result.ok ? [] : result.issues;
}

describe("schema: formula and rollup kinds", () => {
  it("accepts formulas that read other properties and rollups over a relation property", () => {
    expect(validateBlueprint(sample()).ok).toBe(true);
  });

  it("names the problem in a formula, in both languages, with its position", () => {
    const bp = sample();
    bp.types[0].properties[2].expression = 'prop("Amount requested") - prop("Salry")';
    const [issue] = issues(bp);
    expect(issue.code).toBe("formulaInvalid");
    expect(issue.path).toEqual(["types", 0, "properties", 2]);
    expect(issue.message?.en).toBe("There is no property called “Salry”.");
    expect(issue.message?.fr).toBe("Il n’existe aucune propriété nommée « Salry ».");

    bp.types[0].properties[2].expression = "1 + ";
    expect(issues(bp)[0].message?.en).toBe("The formula ends too early.");
    bp.types[0].properties[2].expression = "nope(1)";
    expect(issues(bp)[0].message?.fr).toBe("Il n’existe aucune fonction nommée « nope ».");
    bp.types[0].properties[2].expression = "1 $ 2";
    expect(issues(bp)[0].message?.en).toBe("Unexpected character “$” at position 3.");
  });

  it("requires an expression, refuses one on another kind, and caps its length", () => {
    const bp = sample();
    bp.types[0].properties[2].expression = "  ";
    expect(issues(bp).map((i) => i.code)).toContain("needsFormula");
    const other = sample();
    other.types[1].properties[0].expression = "1";
    expect(issues(other).map((i) => i.code)).toContain("formulaNotAllowed");
    const long = sample();
    long.types[0].properties[2].expression = "1".repeat(2001);
    expect(issues(long).map((i) => i.code)).toContain("formulaTooLong");
  });

  it("refuses formulas that depend on themselves through other formulas", () => {
    const bp = sample();
    bp.types[0].properties[2].expression = 'prop("share") + 1';
    const codes = issues(bp);
    expect(codes.filter((i) => i.code === "formulaCircular").map((i) => i.path)).toEqual([
      ["types", 0, "properties", 2],
      ["types", 0, "properties", 3],
    ]);
    const self = sample();
    self.types[0].properties[2].expression = 'prop("Shortfall") * 2';
    expect(issues(self).map((i) => i.code)).toEqual(["formulaCircular"]);
  });

  it("checks that a rollup names a relation property of its type and a number to sum", () => {
    const bp = sample();
    bp.types[0].properties[6].rollup = { relation: "requested", target: "hours", function: "sum" };
    expect(issues(bp)[0]).toMatchObject({ code: "rollupNeedsRelation", path: ["types", 0, "properties", 6, "rollup", "relation"] });

    const text = sample();
    text.types[1].properties[0].kind = "text";
    expect(issues(text)[0]).toMatchObject({ code: "rollupNeedsNumber", path: ["types", 0, "properties", 6, "rollup", "target"] });

    const missing = sample();
    missing.types[0].properties[6].rollup = { relation: "reports", function: "average" };
    expect(issues(missing).map((i) => i.code)).toContain("rollupNeedsNumber");

    const count = sample();
    count.types[0].properties[5].rollup = { relation: "reports", function: "count" };
    expect(validateBlueprint(count).ok).toBe(true);

    const none = sample();
    delete none.types[0].properties[5].rollup;
    expect(issues(none).map((i) => i.code)).toContain("needsRollup");
    const stray = sample();
    stray.types[1].properties[0].rollup = { relation: "grant", function: "count" };
    expect(issues(stray).map((i) => i.code)).toContain("rollupNotAllowed");
    const badFunction = sample();
    (badFunction.types[0].properties[5].rollup as { function: string }).function = "median";
    expect(validateBlueprint(badFunction).ok).toBe(false);
  });

  it("has English and French text for every new code, kind and field", () => {
    for (const code of [
      "needsFormula", "formulaInvalid", "formulaTooLong", "formulaNotAllowed", "formulaCircular",
      "needsRollup", "rollupNeedsRelation", "rollupNeedsNumber", "rollupNotAllowed", "propertyKindClash",
      "buildRolledBack", "undoIncomplete", "failedBecause",
    ]) {
      expect(typeof (blueprintsEn.errors as Record<string, unknown>)[code]).toBe("string");
      expect(typeof (blueprintsFrCA.errors as Record<string, unknown>)[code]).toBe("string");
      expect((blueprintsEn.errors as Record<string, unknown>)[code]).not.toBe((blueprintsFrCA.errors as Record<string, unknown>)[code]);
    }
    expect(blueprintsEn.kinds.formula).toBe("Formula");
    expect(blueprintsFrCA.kinds.formula).toBe("Formule");
    expect(blueprintsFrCA.kinds.rollup).not.toBe(blueprintsEn.kinds.rollup);
    expect(Object.keys(blueprintsFrCA.rollupFunctions)).toEqual(Object.keys(blueprintsEn.rollupFunctions));
    expect(blueprintsFrCA.list.formulaExample).toContain("{sample}");
    expect(blueprintsFrCA.list.formulaExample).toContain("{result}");
  });
});

describe("plan: formulas and rollups come after what they read", () => {
  it("orders rollups after their relation and target, and formulas after their inputs", () => {
    const bp = valid(sample());
    // Draw the dependents first to prove the order comes from references, not drawing.
    const application = bp.types[0];
    application.properties = [...application.properties].reverse();
    const ordered = orderProperties(bp).map(({ type, property }) => `${type.key}.${property.key}`);
    const at = (id: string) => ordered.indexOf(id);
    expect(at("grant_application.shortfall")).toBeGreaterThan(at("grant_application.requested"));
    expect(at("grant_application.shortfall")).toBeGreaterThan(at("grant_application.awarded"));
    expect(at("grant_application.share")).toBeGreaterThan(at("grant_application.shortfall"));
    expect(at("grant_application.report_count")).toBeGreaterThan(at("grant_application.reports"));
    expect(at("grant_application.hours_total")).toBeGreaterThan(at("grant_application.reports"));
    expect(at("grant_application.hours_total")).toBeGreaterThan(at("grant_report.hours"));
    expect(ordered).toHaveLength(9);
    // Plain properties keep their drawn order and positions.
    const plan = planBlueprint(bp, () => "id");
    const rows = plan.changes.filter((c) => c.kind === "create" && c.object.type === "property_definition");
    expect(rows.map((c) => c.kind === "create" && c.values.key)).toEqual(ordered.map((id) => id.split(".")[1]));
    const shortfall = rows.find((c) => c.kind === "create" && c.values.key === "shortfall");
    expect(shortfall?.kind === "create" && shortfall.values.position).toBe(4);
    expect(shortfall?.kind === "create" && shortfall.values.options).toEqual({ expression: 'prop("Amount requested") - prop("awarded")' });
    const hours = rows.find((c) => c.kind === "create" && c.values.key === "hours_total");
    expect(hours?.kind === "create" && hours.values.options).toEqual({ relationProperty: "reports", targetProperty: "hours", function: "sum" });
    const count = rows.find((c) => c.kind === "create" && c.values.key === "report_count");
    expect(count?.kind === "create" && count.values.options).toEqual({ relationProperty: "reports", targetProperty: null, function: "count" });
    const relation = rows.find((c) => c.kind === "create" && c.values.key === "reports");
    expect(relation?.kind === "create" && relation.values.options).toMatchObject({ direction: "incoming", targetTypeKey: "grant_report" });
    expect(plan.counts.property_definition).toBe(9);
  });

  it("still ends when formulas form a loop", () => {
    const bp = valid(sample());
    bp.types[0].properties[2].expression = 'prop("share") + 1';
    expect(orderProperties(bp)).toHaveLength(9);
  });
});

describe("formula examples", () => {
  const bp = valid(sample());
  const type = bp.types[0];

  it("works the formula over the sample record with the real engine", () => {
    const example = formulaExample({ blueprintKey: "grant", type, property: type.properties[2], locale: "en", today: "2026-10-15" });
    expect(example).toEqual({
      ok: true,
      inputs: [
        { name: "Amount requested", value: "1,250.5" },
        { name: "Amount awarded", value: "1,250.5" },
      ],
      result: "0",
    });
    const fr = formulaExample({ blueprintKey: "grant", type, property: type.properties[3], locale: "fr-CA", today: "2026-10-15" });
    expect(fr?.ok && fr.inputs.map((i) => i.name)).toEqual(["Manque à gagner", "Montant demandé"]);
    expect(fr?.ok && fr.result).toBe("100");
  });

  it("uses a starter's realistic values when the property is one of its own", () => {
    const grant = starterBlueprints.find((json) => (json as { key: string }).key === "grant") as BlueprintInput;
    const application = valid(grant).types.find((t) => t.key === "grant_application")!;
    const record = sampleRecord("grant", application, "2026-10-15");
    expect(record.amount_requested).toBe(50000);
    expect(record.amount_awarded).toBe(35000);
    expect(record.stage).toBe("submitted");
    const example = formulaExample({
      blueprintKey: "grant",
      type: { ...application, properties: [...application.properties, { key: "gap", name: { en: "Gap", fr: "Écart" }, kind: "formula", expression: 'prop("Amount requested") - prop("Amount awarded")' }] },
      property: { key: "gap", name: { en: "Gap", fr: "Écart" }, kind: "formula", expression: 'prop("Amount requested") - prop("Amount awarded")' },
      locale: "en",
      today: "2026-10-15",
    });
    expect(example?.ok && example.result).toBe("15,000");
  });

  it("reports the engine's message when the formula fails on the sample", () => {
    const broken = { key: "bad", name: { en: "Bad", fr: "Mauvais" }, kind: "formula" as const, expression: '1 / 0' };
    const example = formulaExample({ blueprintKey: "x", type: { ...type, properties: [...type.properties, broken] }, property: broken, locale: "fr-CA" });
    expect(example).toEqual({ ok: false, message: "Division par zéro." });
    expect(formulaExample({ blueprintKey: "x", type, property: type.properties[0], locale: "en" })).toBeNull();
  });
});
