import { z } from "zod";
import { requiredText } from "@/lib/schema";
import { formulaDependencies, parseFormula, validateFormula } from "@/features/objects/formula";
import { MAX_FORMULA_LENGTH } from "@/features/objects/formula/parser";
import { rollupFunctions } from "@/features/objects/services/rollups";
import { propertyKinds, type LensKind, type LocalizedText, type PropertyKind } from "@/lib/objects/contracts";

/**
 * What a blueprint is (V2-2, epic #199): the types, properties and relations
 * someone draws in the designer, plus any lenses, forms and workflows they add
 * by hand. Starter blueprints are JSON files checked against this schema, and
 * the designer saves the same shape.
 *
 * Lenses, forms and workflows here are *descriptions* of what building will
 * create. Their real definitions belong to S4 (lenses), S6b (forms) and S6
 * (workflows); `plan.ts` turns these descriptions into the change set those
 * streams will receive. Listed under "Contract additions" in the PR.
 *
 * Validation messages are keys into the blueprints dictionary
 * (`i18n/en.ts`, `errors.*`), so the designer can show them in either language.
 */

/** Lower snake case, starting with a letter, as `object_type.key` requires. */
export const blueprintKeyPattern = /^[a-z][a-z0-9_]{0,47}$/;

const key = z.string().regex(blueprintKeyPattern, "invalidKey");

export const localizedTextSchema = z.object({
  en: requiredText("missingEnglish").max(120, "tooLong"),
  fr: requiredText("missingFrench").max(120, "tooLong"),
});

/**
 * Kinds a person can add. The automatic ones (created by, edited time and so
 * on) exist on every type already, so a blueprint cannot declare them. A
 * formula carries its expression (V1-8) and a rollup names the relation
 * property it counts or sums over (V1-7); both are checked below.
 */
export const blueprintPropertyKinds = propertyKinds.filter(
  (kind) => !["created_by", "created_time", "edited_by", "edited_time"].includes(kind),
) as Exclude<PropertyKind, "created_by" | "created_time" | "edited_by" | "edited_time">[];

/** Kinds whose values are picked from a list of choices. */
export const choiceKinds: readonly PropertyKind[] = ["status", "select", "multi_select"];

/** Kinds a rollup can sum, average or take the minimum or maximum of (as the database allows). */
export const numericKinds: readonly PropertyKind[] = ["number", "currency", "duration", "progress", "rating", "rollup"];

export const blueprintRollupFunctions = rollupFunctions;

export const blueprintLensKinds = [
  "table",
  "board",
  "list",
  "calendar",
  "timeline",
  "gallery",
] as const satisfies readonly LensKind[];

const choiceSchema = z.object({
  key,
  label: localizedTextSchema,
});

export const blueprintPropertySchema = z.object({
  key,
  name: localizedTextSchema,
  kind: z.enum(blueprintPropertyKinds as [string, ...string[]]),
  required: z.boolean().optional(),
  choices: z.array(choiceSchema).max(30).optional(),
  /** ISO 4217 code for `currency`. */
  currency: z.string().regex(/^[A-Z]{3}$/, "invalidCurrency").optional(),
  /** For `relation`: the key of a relation in this blueprint. */
  relation: key.optional(),
  /** For `formula`: the expression, in the formula language of src/features/objects/formula. */
  expression: z.string().max(MAX_FORMULA_LENGTH, "formulaTooLong").optional(),
  /** For `rollup`: what to summarise, over which relation property of the same type. */
  rollup: z
    .object({
      /** A relation property key on the same type. */
      relation: key,
      /** A numeric property key on the related type; not needed for `count`. */
      target: key.optional(),
      function: z.enum(blueprintRollupFunctions),
    })
    .optional(),
});

export const blueprintTypeSchema = z.object({
  key,
  name: localizedTextSchema,
  icon: z.string().max(40).optional(),
  properties: z.array(blueprintPropertySchema).max(40),
  /** Where the card sits on the designer canvas. */
  layout: z.object({ x: z.number().min(0).max(4000), y: z.number().min(0).max(4000) }).optional(),
});

export const blueprintRelationSchema = z.object({
  key,
  from: key,
  to: key,
  name: localizedTextSchema,
  reverseName: localizedTextSchema,
  cardinality: z.enum(["one_to_one", "one_to_many", "many_to_many"]),
});

export const blueprintLensSchema = z.object({
  key,
  type: key,
  kind: z.enum(blueprintLensKinds),
  name: localizedTextSchema,
  /** Board columns, or the date for calendar and timeline. */
  groupBy: key.optional(),
});

export const blueprintFormSchema = z.object({
  key,
  type: key,
  name: localizedTextSchema,
  fields: z.array(key).min(1, "formNeedsFields").max(40),
});

const workflowStepSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("notify"),
    role: z.enum(["owner", "admin", "staff", "volunteer"]),
    message: localizedTextSchema,
  }),
  z.object({ kind: z.literal("set_property"), property: key, value: z.string().max(200) }),
  z.object({
    kind: z.literal("create_task"),
    title: localizedTextSchema,
    dueInDays: z.number().int().min(0).max(365).optional(),
  }),
]);

export const blueprintWorkflowSchema = z.object({
  key,
  type: key,
  name: localizedTextSchema,
  trigger: z.discriminatedUnion("on", [
    z.object({ on: z.literal("created") }),
    z.object({ on: z.literal("property_changed"), property: key, to: z.string().max(200).optional() }),
  ]),
  steps: z.array(workflowStepSchema).min(1, "workflowNeedsSteps").max(20),
});

const baseBlueprintSchema = z.object({
  version: z.literal(1),
  key,
  name: localizedTextSchema,
  description: z.object({ en: z.string().max(500), fr: z.string().max(500) }),
  types: z.array(blueprintTypeSchema).min(1, "needsAType").max(20),
  relations: z.array(blueprintRelationSchema).max(40),
  lenses: z.array(blueprintLensSchema).max(40).default([]),
  forms: z.array(blueprintFormSchema).max(20).default([]),
  workflows: z.array(blueprintWorkflowSchema).max(20).default([]),
});

function duplicates(keys: string[]): string[] {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const k of keys) (seen.has(k) ? repeated : seen).add(k);
  return [...repeated];
}

/** A blueprint whose references all resolve. */
export const blueprintSchema = baseBlueprintSchema.superRefine((bp, ctx) => {
  const issue = (message: string, path: (string | number)[]) =>
    ctx.addIssue({ code: z.ZodIssueCode.custom, message, path });

  const types = new Map(bp.types.map((type) => [type.key, type]));
  const relations = new Map(bp.relations.map((relation) => [relation.key, relation]));

  /** The property a formula or rollup on `type` can name: every property of the type, plus the title. */
  const namesOn = (type: z.infer<typeof blueprintTypeSchema>) => [
    "title",
    ...type.properties.flatMap((p) => [p.key, p.name.en, p.name.fr]),
  ];

  /** The type at the other end of a relation property, as the database resolves it. */
  const relatedType = (type: z.infer<typeof blueprintTypeSchema>, relationKey: string) => {
    const relation = relations.get(relationKey);
    if (!relation) return undefined;
    return types.get(relation.from === type.key ? relation.to : relation.from);
  };

  function checkFormula(
    type: z.infer<typeof blueprintTypeSchema>,
    property: z.infer<typeof blueprintPropertySchema>,
    path: (string | number)[],
  ) {
    if (!property.expression?.trim()) return issue("needsFormula", path);
    const known = namesOn(type);
    const en = validateFormula(property.expression, known, "en");
    if (en.ok) return;
    const fr = validateFormula(property.expression, known, "fr-CA");
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "formulaInvalid",
      path,
      params: { message: { en: en.message, fr: fr.ok ? en.message : fr.message } satisfies LocalizedText },
    });
  }

  /** A formula that depends on itself through other formulas of the type is refused here, not at build time. */
  function checkFormulaLoops(type: z.infer<typeof blueprintTypeSchema>, t: number) {
    const formulas = type.properties.filter((p) => p.kind === "formula" && p.expression?.trim());
    if (!formulas.length) return;
    const byKey = new Map(formulas.map((p) => [p.key, p]));
    const resolve = (name: string) => {
      const lower = name.toLowerCase();
      return type.properties.find(
        (p) => p.key.toLowerCase() === lower || p.name.en.toLowerCase() === lower || p.name.fr.toLowerCase() === lower,
      )?.key;
    };
    const dependencies = new Map<string, string[]>();
    for (const formula of formulas) {
      try {
        dependencies.set(
          formula.key,
          formulaDependencies(parseFormula(formula.expression!))
            .map(resolve)
            .filter((k): k is string => !!k && byKey.has(k)),
        );
      } catch {
        dependencies.set(formula.key, []);
      }
    }
    const inLoop = new Set<string>();
    const visit = (start: string, current: string, seen: Set<string>) => {
      for (const next of dependencies.get(current) ?? []) {
        if (next === start) inLoop.add(start);
        else if (!seen.has(next)) visit(start, next, new Set(seen).add(next));
      }
    };
    for (const formula of formulas) visit(formula.key, formula.key, new Set([formula.key]));
    for (const key of inLoop) {
      issue("formulaCircular", ["types", t, "properties", type.properties.findIndex((p) => p.key === key)]);
    }
  }

  function checkRollup(
    type: z.infer<typeof blueprintTypeSchema>,
    property: z.infer<typeof blueprintPropertySchema>,
    path: (string | number)[],
  ) {
    if (!property.rollup) return issue("needsRollup", path);
    const relationProperty = type.properties.find((p) => p.key === property.rollup!.relation);
    if (!relationProperty || relationProperty.kind !== "relation" || !relationProperty.relation) {
      return issue("rollupNeedsRelation", [...path, "rollup", "relation"]);
    }
    if (property.rollup.function === "count") return;
    const target = property.rollup.target
      ? relatedType(type, relationProperty.relation)?.properties.find((p) => p.key === property.rollup!.target)
      : undefined;
    if (!target || !numericKinds.includes(target.kind as PropertyKind)) {
      issue("rollupNeedsNumber", [...path, "rollup", "target"]);
    }
  }

  for (const k of duplicates(bp.types.map((t) => t.key))) issue("duplicateKey", ["types", k]);
  for (const k of duplicates(bp.relations.map((r) => r.key))) issue("duplicateKey", ["relations", k]);
  for (const k of duplicates(bp.lenses.map((l) => l.key))) issue("duplicateKey", ["lenses", k]);
  for (const k of duplicates(bp.forms.map((f) => f.key))) issue("duplicateKey", ["forms", k]);
  for (const k of duplicates(bp.workflows.map((w) => w.key))) issue("duplicateKey", ["workflows", k]);

  bp.types.forEach((type, t) => {
    for (const k of duplicates(type.properties.map((p) => p.key))) {
      issue("duplicateKey", ["types", t, "properties", k]);
    }
    type.properties.forEach((property, p) => {
      const path = ["types", t, "properties", p];
      if (choiceKinds.includes(property.kind as PropertyKind)) {
        if (!property.choices?.length) issue("needsChoices", path);
        else for (const k of duplicates(property.choices.map((c) => c.key))) issue("duplicateKey", [...path, k]);
      } else if (property.choices) {
        issue("choicesNotAllowed", path);
      }
      if (property.kind === "currency" && !property.currency) issue("needsCurrency", path);
      if (property.kind === "relation") {
        const relation = property.relation ? relations.get(property.relation) : undefined;
        if (!relation) issue("unknownRelation", path);
        else if (relation.from !== type.key && relation.to !== type.key) issue("relationNotOnType", path);
      } else if (property.relation) {
        issue("relationNotAllowed", path);
      }
      if (property.kind === "formula") {
        checkFormula(type, property, path);
      } else if (property.expression !== undefined) {
        issue("formulaNotAllowed", path);
      }
      if (property.kind === "rollup") {
        checkRollup(type, property, path);
      } else if (property.rollup) {
        issue("rollupNotAllowed", path);
      }
    });
    checkFormulaLoops(type, t);
  });

  bp.relations.forEach((relation, r) => {
    if (!types.has(relation.from)) issue("unknownType", ["relations", r, "from"]);
    if (!types.has(relation.to)) issue("unknownType", ["relations", r, "to"]);
  });

  const propertyOf = (typeKey: string, propertyKey: string) =>
    types.get(typeKey)?.properties.find((p) => p.key === propertyKey);

  bp.lenses.forEach((lens, l) => {
    if (!types.has(lens.type)) return issue("unknownType", ["lenses", l, "type"]);
    if (lens.kind === "board") {
      const group = lens.groupBy ? propertyOf(lens.type, lens.groupBy) : undefined;
      if (!group || !choiceKinds.includes(group.kind as PropertyKind)) issue("boardNeedsChoice", ["lenses", l, "groupBy"]);
    } else if (lens.kind === "calendar" || lens.kind === "timeline") {
      const date = lens.groupBy ? propertyOf(lens.type, lens.groupBy) : undefined;
      if (!date || !["date", "date_range"].includes(date.kind)) issue("calendarNeedsDate", ["lenses", l, "groupBy"]);
    } else if (lens.groupBy && !propertyOf(lens.type, lens.groupBy)) {
      issue("unknownProperty", ["lenses", l, "groupBy"]);
    }
  });

  bp.forms.forEach((form, f) => {
    if (!types.has(form.type)) return issue("unknownType", ["forms", f, "type"]);
    form.fields.forEach((field, i) => {
      if (field !== "title" && !propertyOf(form.type, field)) issue("unknownProperty", ["forms", f, "fields", i]);
    });
  });

  bp.workflows.forEach((workflow, w) => {
    if (!types.has(workflow.type)) return issue("unknownType", ["workflows", w, "type"]);
    if (workflow.trigger.on === "property_changed" && !propertyOf(workflow.type, workflow.trigger.property)) {
      issue("unknownProperty", ["workflows", w, "trigger", "property"]);
    }
    workflow.steps.forEach((step, s) => {
      if (step.kind === "set_property" && !propertyOf(workflow.type, step.property)) {
        issue("unknownProperty", ["workflows", w, "steps", s, "property"]);
      }
    });
  });
});

export type Blueprint = z.infer<typeof blueprintSchema>;
/** What the designer edits: lenses, forms and workflows may be left out. */
export type BlueprintInput = z.input<typeof blueprintSchema>;
export type BlueprintType = Blueprint["types"][number];
export type BlueprintProperty = BlueprintType["properties"][number];
export type BlueprintRelation = Blueprint["relations"][number];
export type BlueprintLens = Blueprint["lenses"][number];
export type BlueprintForm = Blueprint["forms"][number];
export type BlueprintWorkflow = Blueprint["workflows"][number];

export interface BlueprintIssue {
  /** Key into the dictionary's `errors` group. */
  code: string;
  path: (string | number)[];
  /** A ready sentence in each language when the code alone is not enough (formula errors name positions and names). */
  message?: LocalizedText;
}

export type ValidationResult =
  | { ok: true; blueprint: Blueprint }
  | { ok: false; issues: BlueprintIssue[] };

export function validateBlueprint(input: unknown): ValidationResult {
  const parsed = blueprintSchema.safeParse(input);
  if (parsed.success) return { ok: true, blueprint: parsed.data };
  return {
    ok: false,
    issues: parsed.error.issues.map((issue) => ({
      code: issue.code === "custom" || issue.message in knownCodes ? issue.message : "invalid",
      path: issue.path,
      ...(issue.code === "custom" && isLocalizedText(issue.params?.message) ? { message: issue.params.message } : {}),
    })),
  };
}

const knownCodes: Record<string, true> = Object.fromEntries(
  [
    "invalidKey",
    "missingEnglish",
    "missingFrench",
    "tooLong",
    "invalidCurrency",
    "formNeedsFields",
    "workflowNeedsSteps",
    "needsAType",
    "formulaTooLong",
  ].map((code) => [code, true]),
);

function isLocalizedText(value: unknown): value is LocalizedText {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as LocalizedText).en === "string" &&
    typeof (value as LocalizedText).fr === "string"
  );
}

/** A fresh, valid-shaped blueprint for the designer's "New" button. */
export function emptyBlueprint(): Blueprint {
  return {
    version: 1,
    key: "new_blueprint",
    name: { en: "New blueprint", fr: "Nouveau plan" },
    description: { en: "", fr: "" },
    types: [
      {
        key: "item",
        name: { en: "Item", fr: "Élément" },
        properties: [],
        layout: { x: 40, y: 40 },
      },
    ],
    relations: [],
    lenses: [],
    forms: [],
    workflows: [],
  };
}

/** Turns a display name into a key: "Job opening" becomes `job_opening`. */
export function keyFromName(name: string): string {
  const base = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^[^a-z]+/, "")
    .slice(0, 48);
  return base || "item";
}
