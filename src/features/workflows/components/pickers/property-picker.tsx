"use client";

import * as React from "react";
import { Input, Label } from "@/components/ui/input";
import type { LensCatalog } from "@/lib/query/catalog";
import { fill, type WorkflowsMessages } from "../../i18n";
import { findPropertyOption, propertyOptions, type PropertyGroup, type PropertyOption } from "../../picker-options";
import { Combobox, type ComboboxGroup } from "./combobox";

/**
 * Picks a path for a condition from the properties of the trigger's type,
 * grouped by kind (U10). The raw path stays visible and editable in an
 * "advanced" field, so anything the catalog does not list still works.
 */
export function PropertyPicker({
  id,
  value,
  onChange,
  catalog,
  objectTypes,
  locale,
  m,
}: {
  id: string;
  /** The raw path. */
  value: string;
  onChange: (path: string, option: PropertyOption | null) => void;
  catalog: LensCatalog;
  objectTypes: readonly string[];
  locale: string;
  m: WorkflowsMessages;
}) {
  const groups = React.useMemo(() => propertyOptions(catalog, objectTypes, locale), [catalog, objectTypes, locale]);
  const optionLabel = (option: PropertyOption) =>
    option.side ? `${option.name} (${option.side === "after" ? m.steps.sideAfter : m.steps.sideBefore})` : option.name;
  const comboGroups: ComboboxGroup[] = React.useMemo(
    () => groups.map((group: PropertyGroup) => ({
      label: m.steps.groups[group.kind],
      options: group.options.map((option) => ({ id: option.path, label: optionLabel(option), description: option.path })),
    })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [groups, m],
  );
  const current = findPropertyOption(groups, value);
  const [showAdvanced, setShowAdvanced] = React.useState(!current && value !== "");

  return (
    <div className="space-y-2">
      <Combobox
        id={id}
        label={m.steps.property}
        hint={m.steps.propertyHint}
        selectedLabel={current ? optionLabel(current) : value}
        groups={comboGroups}
        m={m.picker}
        fill={fill}
        onSelect={(option) => onChange(option.id, findPropertyOption(groups, option.id))}
      />
      <div>
        <button
          type="button"
          className="text-[12.5px] text-brand-fg underline-offset-2 hover:underline"
          aria-expanded={showAdvanced}
          aria-controls={`${id}-advanced`}
          onClick={() => setShowAdvanced((shown) => !shown)}
        >
          {m.picker.advanced}
        </button>
        <div id={`${id}-advanced`} hidden={!showAdvanced} className="mt-1">
          <Label htmlFor={`${id}-path`}>{m.steps.advancedPath}</Label>
          <Input
            id={`${id}-path`}
            value={value}
            aria-describedby={`${id}-path-hint`}
            onChange={(event) => onChange(event.target.value, findPropertyOption(groups, event.target.value))}
          />
          <p id={`${id}-path-hint`} className="mt-1 text-[12.5px] text-muted">{m.steps.pathHint}</p>
        </div>
      </div>
    </div>
  );
}
