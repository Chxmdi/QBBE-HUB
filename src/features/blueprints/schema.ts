import { z } from "zod";
import { requiredText } from "@/lib/schema";
import { propertyKinds, type LensKind, type PropertyKind } from "@/lib/objects/contracts";

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
 * on) exist on every type already, and formulas and rollups need definitions
 * that arrive with V1-7, so a blueprint cannot declare them yet.
 */
export const blueprintPropertyKinds = propertyKinds.filter(
  (kind) =>
    !["created_by", "created_time", "edited_by", "edited_time", "formula", "rollup"].includes(kind),
) as Exclude<
  PropertyKind,
  "created_by" | "created_time" | "edited_by" | "edited_time" | "formula" | "rollup"
>[];

/** Kinds whose values are picked from a list of choices. */
export const choiceKinds: readonly PropertyKind[] = ["status", "select", "multi_select"];

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
    });
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
  ].map((code) => [code, true]),
);

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
