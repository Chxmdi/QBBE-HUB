"use client";

import * as React from "react";
import { Input, Label } from "@/components/ui/input";
import { fill, type WorkflowsMessages } from "../../i18n";
import { searchableTypes } from "../../picker-options";
import { THIS_ITEM } from "../../editor-model";
import { recordTitle, searchRecords, type PickerOption } from "../../services/workflow.pickers";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
import { Combobox, type ComboboxGroup } from "./combobox";

/**
 * Finds a record by title through global_search, limited to one type (U10).
 * The chosen id stays visible in an "advanced" field, which also accepts a
 * `{{path}}` placeholder such as the item that changed.
 */
export function RecordPicker({
  id,
  type,
  value,
  onChange,
  label,
  idLabel,
  allowThisItem,
  m,
}: {
  id: string;
  /** The workflow object type to search within, e.g. "task". */
  type: string;
  /** The raw id or placeholder. */
  value: string;
  onChange: (value: string) => void;
  label: string;
  /** Label of the raw id field. */
  idLabel: string;
  /** Offers "{{event.object.id}}" as the first option. */
  allowThisItem?: boolean;
  m: WorkflowsMessages;
}) {
  const searchable = (searchableTypes as readonly string[]).includes(type);
  const [options, setOptions] = React.useState<PickerOption[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [chosen, setChosen] = React.useState<{ id: string; label: string } | null>(null);
  const latest = React.useRef(0);

  // A saved workflow or a picked event holds only the id: name it once.
  React.useEffect(() => {
    if (!searchable || !UUID.test(value) || chosen?.id === value) return;
    let cancelled = false;
    recordTitle({ type, id: value }).then((title) => {
      if (!cancelled && title) setChosen({ id: value, label: title });
    });
    return () => {
      cancelled = true;
    };
  }, [searchable, type, value, chosen]);

  const onQuery = React.useCallback(async (query: string) => {
    if (!searchable) return;
    const call = ++latest.current;
    setLoading(true);
    const found = await searchRecords({ type, query });
    if (call !== latest.current) return;
    setOptions(found);
    setLoading(false);
  }, [searchable, type]);

  const groups: ComboboxGroup[] = [{
    label: "",
    options: [
      ...(allowThisItem ? [{ id: THIS_ITEM, label: m.steps.thisItem, description: THIS_ITEM }] : []),
      ...options.map((option) => ({ id: option.id, label: option.label, description: option.description })),
    ],
  }];
  const selectedLabel = value === THIS_ITEM ? m.steps.thisItem : chosen && chosen.id === value ? chosen.label : value;

  return (
    <div className="space-y-2">
      {searchable || allowThisItem ? (
        <Combobox
          id={id}
          label={label}
          hint={searchable ? undefined : m.picker.searchUnavailable}
          selectedLabel={selectedLabel}
          groups={groups}
          loading={loading}
          m={m.picker}
          fill={fill}
          onQuery={searchable ? onQuery : undefined}
          onSelect={(option) => {
            setChosen({ id: option.id, label: option.label });
            onChange(option.id);
          }}
          onClear={() => {
            setChosen(null);
            onChange("");
          }}
        />
      ) : (
        <p className="text-[12.5px] text-muted">{m.picker.searchUnavailable}</p>
      )}
      <div>
        <Label htmlFor={`${id}-id`}>{idLabel}</Label>
        <Input id={`${id}-id`} value={value} onChange={(event) => onChange(event.target.value)} />
      </div>
    </div>
  );
}
