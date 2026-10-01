"use client";

import * as React from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox, Input, Label, Select, Textarea } from "@/components/ui/input";
import type { Locale } from "@/lib/i18n/config";
import { formatChoices, parseChoices } from "../editor-state";
import { formulaExample } from "../formula-examples";
import { fill, pick, type BlueprintsMessages } from "../i18n";
import {
  blueprintPropertyKinds,
  blueprintRollupFunctions,
  choiceKinds,
  numericKinds,
  validateBlueprint,
  type Blueprint,
  type BlueprintIssue,
  type BlueprintProperty,
  type BlueprintType,
} from "../schema";
import type { PropertyKind } from "@/lib/objects/contracts";

/**
 * The structured list editor: every type, its properties and their settings as
 * ordinary labelled form fields. This is the keyboard and screen-reader
 * equivalent of the canvas (WCAG 2.5.7): anything drawn there can be done
 * here, and the two stay in step because both edit the same blueprint.
 */
export function TypeListEditor({
  blueprint,
  issues,
  messages,
  locale,
  readOnly,
  onUpdateType,
  onRemoveType,
  onAddType,
  onAddProperty,
  onUpdateProperty,
  onRemoveProperty,
  onMoveProperty,
}: {
  blueprint: Blueprint;
  /** The current validation problems, so a formula can show its own under the field. */
  issues?: BlueprintIssue[];
  messages: BlueprintsMessages;
  locale: Locale;
  readOnly: boolean;
  onUpdateType: (key: string, patch: Partial<BlueprintType>) => void;
  onRemoveType: (key: string) => void;
  onAddType: () => void;
  onAddProperty: (typeKey: string) => void;
  onUpdateProperty: (typeKey: string, propertyKey: string, patch: Partial<BlueprintProperty>) => void;
  onRemoveProperty: (typeKey: string, propertyKey: string) => void;
  onMoveProperty: (typeKey: string, propertyKey: string, offset: -1 | 1) => void;
}) {
  return (
    <section aria-labelledby="blueprint-list-heading" className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="blueprint-list-heading" className="text-[15px] font-semibold text-ink">
            {messages.list.heading}
          </h2>
          <p className="mt-1 max-w-2xl text-[13px] text-muted">{messages.list.hint}</p>
        </div>
        {readOnly ? null : (
          <Button type="button" variant="secondary" size="sm" onClick={onAddType}>
            <Plus className="size-4" aria-hidden />
            {messages.canvas.addType}
          </Button>
        )}
      </div>

      <ol className="space-y-4">
        {blueprint.types.map((type, index) => {
          const name = pick(type.name, locale);
          const id = `type-${index}`;
          return (
            <li key={index}>
              <fieldset className="rounded-(--radius-md) border border-line bg-surface p-4" disabled={readOnly}>
                <legend className="px-1 text-[13px] font-semibold text-ink">
                  {fill(messages.list.type, { n: index + 1 })}: {name}
                </legend>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div>
                    <Label htmlFor={`${id}-en`}>{messages.list.typeNameEn}</Label>
                    <Input
                      id={`${id}-en`}
                      value={type.name.en}
                      onChange={(e) => onUpdateType(type.key, { name: { ...type.name, en: e.target.value } })}
                    />
                  </div>
                  <div>
                    <Label htmlFor={`${id}-fr`}>{messages.list.typeNameFr}</Label>
                    <Input
                      id={`${id}-fr`}
                      lang="fr-CA"
                      value={type.name.fr}
                      onChange={(e) => onUpdateType(type.key, { name: { ...type.name, fr: e.target.value } })}
                    />
                  </div>
                  <div>
                    <Label htmlFor={`${id}-key`}>{messages.list.typeKey}</Label>
                    <Input
                      id={`${id}-key`}
                      value={type.key}
                      spellCheck={false}
                      onChange={(e) => onUpdateType(type.key, { key: e.target.value })}
                    />
                  </div>
                </div>

                <h3 className="mt-4 mb-2 text-[13px] font-semibold text-ink">
                  {fill(messages.list.properties, { name })}
                </h3>
                {type.properties.length === 0 ? (
                  <p className="text-[13px] text-muted">{messages.list.noProperties}</p>
                ) : (
                  <ol className="space-y-3">
                    {type.properties.map((property, p) => (
                      <PropertyRow
                        key={p}
                        id={`${id}-p${p}`}
                        blueprint={blueprint}
                        type={type}
                        typeIndex={index}
                        propertyIndex={p}
                        issues={issues}
                        property={property}
                        first={p === 0}
                        last={p === type.properties.length - 1}
                        messages={messages}
                        locale={locale}
                        onUpdate={(patch) => onUpdateProperty(type.key, property.key, patch)}
                        onRemove={() => onRemoveProperty(type.key, property.key)}
                        onMove={(offset) => onMoveProperty(type.key, property.key, offset)}
                      />
                    ))}
                  </ol>
                )}

                {readOnly ? null : (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button type="button" size="sm" variant="secondary" onClick={() => onAddProperty(type.key)}>
                      <Plus className="size-4" aria-hidden />
                      {messages.list.addProperty}
                      <span className="sr-only"> ({name})</span>
                    </Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => onRemoveType(type.key)}>
                      <Trash2 className="size-4" aria-hidden />
                      {fill(messages.list.removeType, { name })}
                    </Button>
                  </div>
                )}
              </fieldset>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function PropertyRow({
  id,
  blueprint,
  type,
  typeIndex,
  propertyIndex,
  issues,
  property,
  first,
  last,
  messages,
  locale,
  onUpdate,
  onRemove,
  onMove,
}: {
  id: string;
  blueprint: Blueprint;
  type: BlueprintType;
  typeIndex: number;
  propertyIndex: number;
  issues?: BlueprintIssue[];
  property: BlueprintProperty;
  first: boolean;
  last: boolean;
  messages: BlueprintsMessages;
  locale: Locale;
  onUpdate: (patch: Partial<BlueprintProperty>) => void;
  onRemove: () => void;
  onMove: (offset: -1 | 1) => void;
}) {
  const name = pick(property.name, locale) || property.key;
  const [choicesText, setChoicesText] = React.useState(() => formatChoices(property.choices));
  const relations = blueprint.relations.filter((r) => r.from === type.key || r.to === type.key);
  const relationProperties = type.properties.filter((p) => p.kind === "relation" && p.relation);
  const relatedType = (relationPropertyKey: string | undefined) => {
    const relationProperty = relationProperties.find((p) => p.key === relationPropertyKey);
    const relation = blueprint.relations.find((r) => r.key === relationProperty?.relation);
    if (!relation) return undefined;
    return blueprint.types.find((t) => t.key === (relation.from === type.key ? relation.to : relation.from));
  };
  const numericTargets = relatedType(property.rollup?.relation)?.properties.filter((p) =>
    numericKinds.includes(p.kind as PropertyKind),
  );

  return (
    <li className="rounded-(--radius-sm) border border-line/80 bg-surface-soft/50 p-3">
      <div className="grid gap-3 sm:grid-cols-4">
        <div>
          <Label htmlFor={`${id}-en`}>{messages.list.propertyNameEn}</Label>
          <Input
            id={`${id}-en`}
            value={property.name.en}
            onChange={(e) => onUpdate({ name: { ...property.name, en: e.target.value } })}
          />
        </div>
        <div>
          <Label htmlFor={`${id}-fr`}>{messages.list.propertyNameFr}</Label>
          <Input
            id={`${id}-fr`}
            lang="fr-CA"
            value={property.name.fr}
            onChange={(e) => onUpdate({ name: { ...property.name, fr: e.target.value } })}
          />
        </div>
        <div>
          <Label htmlFor={`${id}-key`}>{messages.list.propertyKey}</Label>
          <Input
            id={`${id}-key`}
            value={property.key}
            spellCheck={false}
            onChange={(e) => onUpdate({ key: e.target.value })}
          />
        </div>
        <div>
          <Label htmlFor={`${id}-kind`}>{messages.list.propertyKind}</Label>
          <Select
            id={`${id}-kind`}
            value={property.kind}
            onChange={(e) => onUpdate({ kind: e.target.value as BlueprintProperty["kind"] })}
          >
            {blueprintPropertyKinds.map((kind) => (
              <option key={kind} value={kind}>
                {messages.kinds[kind as keyof BlueprintsMessages["kinds"]]}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {choiceKinds.includes(property.kind as PropertyKind) ? (
        <div className="mt-3">
          <Label htmlFor={`${id}-choices`}>{messages.list.choices}</Label>
          <Textarea
            id={`${id}-choices`}
            value={choicesText}
            onChange={(e) => {
              setChoicesText(e.target.value);
              onUpdate({ choices: parseChoices(e.target.value) });
            }}
          />
        </div>
      ) : null}
      {property.kind === "currency" ? (
        <div className="mt-3 max-w-40">
          <Label htmlFor={`${id}-currency`}>{messages.list.currency}</Label>
          <Input
            id={`${id}-currency`}
            value={property.currency ?? ""}
            maxLength={3}
            onChange={(e) => onUpdate({ currency: e.target.value.toUpperCase() })}
          />
        </div>
      ) : null}
      {property.kind === "relation" ? (
        <div className="mt-3 max-w-sm">
          <Label htmlFor={`${id}-relation`}>{messages.list.relation}</Label>
          <Select
            id={`${id}-relation`}
            value={property.relation ?? ""}
            onChange={(e) => onUpdate({ relation: e.target.value || undefined })}
          >
            <option value="">{messages.list.chooseRelation}</option>
            {relations.map((relation) => (
              <option key={relation.key} value={relation.key}>
                {pick(relation.name, locale)} ({relation.key})
              </option>
            ))}
          </Select>
        </div>
      ) : null}

      {property.kind === "formula" ? (
        <FormulaField
          id={id}
          blueprint={blueprint}
          type={type}
          typeIndex={typeIndex}
          propertyIndex={propertyIndex}
          issues={issues}
          property={property}
          messages={messages}
          locale={locale}
          onChange={(expression) => onUpdate({ expression })}
        />
      ) : null}
      {property.kind === "rollup" ? (
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <div>
            <Label htmlFor={`${id}-rollup-relation`}>{messages.list.rollupRelation}</Label>
            <Select
              id={`${id}-rollup-relation`}
              value={property.rollup?.relation ?? ""}
              aria-describedby={relationProperties.length ? undefined : `${id}-rollup-none`}
              onChange={(e) =>
                onUpdate({
                  rollup: { function: "count", ...property.rollup, relation: e.target.value, target: undefined },
                })
              }
            >
              <option value="">{messages.list.chooseRelationProperty}</option>
              {relationProperties.map((p) => (
                <option key={p.key} value={p.key}>
                  {pick(p.name, locale) || p.key}
                </option>
              ))}
            </Select>
            {relationProperties.length ? null : (
              <p id={`${id}-rollup-none`} className="mt-1 text-[12.5px] text-muted">
                {messages.list.noRelationProperties}
              </p>
            )}
          </div>
          <div>
            <Label htmlFor={`${id}-rollup-function`}>{messages.list.rollupFunction}</Label>
            <Select
              id={`${id}-rollup-function`}
              value={property.rollup?.function ?? "count"}
              onChange={(e) =>
                onUpdate({
                  rollup: {
                    relation: property.rollup?.relation ?? "",
                    target: property.rollup?.target,
                    function: e.target.value as NonNullable<BlueprintProperty["rollup"]>["function"],
                  },
                })
              }
            >
              {blueprintRollupFunctions.map((fn) => (
                <option key={fn} value={fn}>
                  {messages.rollupFunctions[fn]}
                </option>
              ))}
            </Select>
          </div>
          {property.rollup && property.rollup.function !== "count" ? (
            <div>
              <Label htmlFor={`${id}-rollup-target`}>{messages.list.rollupTarget}</Label>
              <Select
                id={`${id}-rollup-target`}
                value={property.rollup.target ?? ""}
                onChange={(e) => onUpdate({ rollup: { ...property.rollup!, target: e.target.value || undefined } })}
              >
                <option value="">{messages.list.chooseTarget}</option>
                {(numericTargets ?? []).map((p) => (
                  <option key={p.key} value={p.key}>
                    {pick(p.name, locale) || p.key}
                  </option>
                ))}
              </Select>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <label className="mr-2 inline-flex items-center gap-2 text-[13px] text-ink">
          <Checkbox checked={property.required ?? false} onChange={(e) => onUpdate({ required: e.target.checked || undefined })} />
          {messages.list.required}
        </label>
        <Button type="button" size="sm" variant="ghost" disabled={first} onClick={() => onMove(-1)} aria-label={fill(messages.list.moveUp, { name })}>
          <ArrowUp className="size-4" aria-hidden />
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={last} onClick={() => onMove(1)} aria-label={fill(messages.list.moveDown, { name })}>
          <ArrowDown className="size-4" aria-hidden />
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onRemove}>
          <Trash2 className="size-4" aria-hidden />
          {fill(messages.list.removeProperty, { name })}
        </Button>
      </div>
    </li>
  );
}

/**
 * The formula text, checked as it is typed. The message under the field is
 * the engine's own (position and names included) in the interface language;
 * when the formula is valid, a worked example over the sample record shows
 * what it will calculate.
 */
function FormulaField({
  id,
  blueprint,
  type,
  typeIndex,
  propertyIndex,
  issues,
  property,
  messages,
  locale,
  onChange,
}: {
  id: string;
  blueprint: Blueprint;
  type: BlueprintType;
  typeIndex: number;
  propertyIndex: number;
  issues?: BlueprintIssue[];
  property: BlueprintProperty;
  messages: BlueprintsMessages;
  locale: Locale;
  onChange: (expression: string) => void;
}) {
  // The problems for this property alone: validation is already done for the
  // whole blueprint by the designer; when it is not passed in, run it here.
  const own = React.useMemo(() => {
    const all = issues ?? (() => {
      const result = validateBlueprint(blueprint);
      return result.ok ? [] : result.issues;
    })();
    return all.filter(
      (issue) =>
        issue.path[0] === "types" &&
        issue.path[1] === typeIndex &&
        issue.path[2] === "properties" &&
        issue.path[3] === propertyIndex &&
        (issue.code.startsWith("formula") || issue.code === "needsFormula"),
    );
  }, [issues, blueprint, typeIndex, propertyIndex]);
  const problem = own[0];
  const problemText = problem
    ? problem.message
      ? pick(problem.message, locale)
      : ((messages.errors as Record<string, unknown>)[problem.code] as string | undefined) ?? messages.errors.invalid
    : null;
  const example = React.useMemo(
    () => (problem ? null : formulaExample({ blueprintKey: blueprint.key, type, property, locale })),
    [problem, blueprint.key, type, property, locale],
  );
  const describedBy = `${id}-expression-hint ${id}-expression-status`;

  return (
    <div className="mt-3">
      <Label htmlFor={`${id}-expression`}>{messages.list.expression}</Label>
      <Textarea
        id={`${id}-expression`}
        value={property.expression ?? ""}
        spellCheck={false}
        rows={2}
        aria-invalid={problem ? true : undefined}
        aria-describedby={describedBy}
        onChange={(e) => onChange(e.target.value)}
      />
      <p id={`${id}-expression-hint`} className="mt-1 text-[12.5px] text-muted">
        {messages.list.expressionHint}
      </p>
      <p
        id={`${id}-expression-status`}
        data-testid="formula-status"
        aria-live="polite"
        className={problemText ? "mt-1 text-[12.5px] text-danger-fg" : "mt-1 text-[12.5px] text-ink"}
      >
        {problemText
          ? problemText
          : example
            ? example.ok
              ? example.inputs.length
                ? fill(messages.list.formulaExample, {
                    sample: example.inputs.map((input) => `${input.name} = ${input.value}`).join(", "),
                    result: example.result,
                  })
                : fill(messages.list.formulaExampleNoInputs, { result: example.result })
              : example.message
            : property.expression?.trim()
              ? messages.list.formulaOk
              : ""}
      </p>
    </div>
  );
}
