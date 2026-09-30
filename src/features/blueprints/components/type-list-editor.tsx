"use client";

import * as React from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox, Input, Label, Select, Textarea } from "@/components/ui/input";
import type { Locale } from "@/lib/i18n/config";
import { formatChoices, parseChoices } from "../editor-state";
import { fill, pick, type BlueprintsMessages } from "../i18n";
import {
  blueprintPropertyKinds,
  choiceKinds,
  type Blueprint,
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
