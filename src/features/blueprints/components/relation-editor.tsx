"use client";

import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import type { Locale } from "@/lib/i18n/config";
import { fill, pick, type BlueprintsMessages } from "../i18n";
import type { Blueprint, BlueprintRelation } from "../schema";

const cardinalities = ["one_to_one", "one_to_many", "many_to_many"] as const;

/** Relations as a list of labelled fields, the equivalent of drawing lines. */
export function RelationEditor({
  blueprint,
  messages,
  locale,
  readOnly,
  onAdd,
  onUpdate,
  onRemove,
}: {
  blueprint: Blueprint;
  messages: BlueprintsMessages;
  locale: Locale;
  readOnly: boolean;
  onAdd: () => void;
  onUpdate: (key: string, patch: Partial<BlueprintRelation>) => void;
  onRemove: (key: string) => void;
}) {
  const typeName = (key: string) => {
    const type = blueprint.types.find((t) => t.key === key);
    return type ? pick(type.name, locale) : key;
  };

  return (
    <section aria-labelledby="blueprint-relations-heading" className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 id="blueprint-relations-heading" className="text-[15px] font-semibold text-ink">
          {messages.relations.heading}
        </h2>
        {readOnly || blueprint.types.length === 0 ? null : (
          <Button type="button" variant="secondary" size="sm" onClick={onAdd}>
            <Plus className="size-4" aria-hidden />
            {messages.relations.add}
          </Button>
        )}
      </div>
      {blueprint.relations.length === 0 ? (
        <p className="text-[13px] text-muted">{messages.relations.empty}</p>
      ) : (
        <ol className="space-y-3">
          {blueprint.relations.map((relation, index) => {
            const id = `relation-${index}`;
            const summary = fill(messages.relations.summary, {
              from: typeName(relation.from),
              name: pick(relation.name, locale),
              to: typeName(relation.to),
            });
            const text = (field: "name" | "reverseName", lang: "en" | "fr", label: string) => (
              <div>
                <Label htmlFor={`${id}-${field}-${lang}`}>{label}</Label>
                <Input
                  id={`${id}-${field}-${lang}`}
                  lang={lang === "fr" ? "fr-CA" : undefined}
                  value={relation[field][lang]}
                  onChange={(e) => onUpdate(relation.key, { [field]: { ...relation[field], [lang]: e.target.value } })}
                />
              </div>
            );
            return (
              <li key={index}>
                <fieldset className="rounded-(--radius-md) border border-line bg-surface p-4" disabled={readOnly}>
                  <legend className="px-1 text-[13px] font-semibold text-ink">{summary}</legend>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div>
                      <Label htmlFor={`${id}-from`}>{messages.relations.from}</Label>
                      <Select id={`${id}-from`} value={relation.from} onChange={(e) => onUpdate(relation.key, { from: e.target.value })}>
                        {blueprint.types.map((t) => (
                          <option key={t.key} value={t.key}>{pick(t.name, locale)}</option>
                        ))}
                      </Select>
                    </div>
                    <div>
                      <Label htmlFor={`${id}-to`}>{messages.relations.to}</Label>
                      <Select id={`${id}-to`} value={relation.to} onChange={(e) => onUpdate(relation.key, { to: e.target.value })}>
                        {blueprint.types.map((t) => (
                          <option key={t.key} value={t.key}>{pick(t.name, locale)}</option>
                        ))}
                      </Select>
                    </div>
                    <div>
                      <Label htmlFor={`${id}-cardinality`}>{messages.relations.cardinality}</Label>
                      <Select
                        id={`${id}-cardinality`}
                        value={relation.cardinality}
                        onChange={(e) => onUpdate(relation.key, { cardinality: e.target.value as BlueprintRelation["cardinality"] })}
                      >
                        {cardinalities.map((c) => (
                          <option key={c} value={c}>{messages.cardinality[c]}</option>
                        ))}
                      </Select>
                    </div>
                    {text("name", "en", messages.relations.nameEn)}
                    {text("name", "fr", messages.relations.nameFr)}
                    <div className="hidden sm:block" />
                    {text("reverseName", "en", messages.relations.reverseEn)}
                    {text("reverseName", "fr", messages.relations.reverseFr)}
                  </div>
                  {readOnly ? null : (
                    <Button type="button" size="sm" variant="ghost" className="mt-3" onClick={() => onRemove(relation.key)}>
                      <Trash2 className="size-4" aria-hidden />
                      {fill(messages.relations.remove, { name: summary })}
                    </Button>
                  )}
                </fieldset>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
