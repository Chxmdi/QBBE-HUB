"use client";

import * as React from "react";
import { Input, Label } from "@/components/ui/input";
import { fill, type WorkflowsMessages } from "../../i18n";
import { peopleByIds, searchPeople, type PickerOption } from "../../services/workflow.pickers";
import { Combobox, type ComboboxGroup } from "./combobox";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Finds an active member by name (U10). The chosen id stays visible in an
 * "advanced" field, which also accepts a `{{path}}` placeholder.
 */
export function PersonPicker({
  id,
  value,
  onChange,
  label,
  idLabel,
  idHint,
  m,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  label: string;
  idLabel: string;
  idHint?: string;
  m: WorkflowsMessages;
}) {
  const [options, setOptions] = React.useState<PickerOption[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [names, setNames] = React.useState<Record<string, string>>({});
  const latest = React.useRef(0);

  // A saved workflow holds only the id: look the name up once.
  React.useEffect(() => {
    if (!UUID.test(value) || names[value]) return;
    let cancelled = false;
    peopleByIds([value]).then((found) => {
      if (cancelled || found.length === 0) return;
      setNames((current) => ({ ...current, [found[0].id]: found[0].label }));
    });
    return () => {
      cancelled = true;
    };
  }, [value, names]);

  const onQuery = React.useCallback(async (query: string) => {
    const call = ++latest.current;
    setLoading(true);
    const found = await searchPeople({ query });
    if (call !== latest.current) return;
    setOptions(found);
    setLoading(false);
  }, []);

  const groups: ComboboxGroup[] = options.length
    ? [{ label: "", options: options.map((option) => ({ id: option.id, label: option.label, description: option.description })) }]
    : [];

  return (
    <div className="space-y-2">
      <Combobox
        id={id}
        label={label}
        selectedLabel={names[value] ?? value}
        groups={groups}
        loading={loading}
        m={m.picker}
        fill={fill}
        onQuery={onQuery}
        onSelect={(option) => {
          setNames((current) => ({ ...current, [option.id]: option.label }));
          onChange(option.id);
        }}
        onClear={() => onChange("")}
      />
      <div>
        <Label htmlFor={`${id}-id`}>{idLabel}</Label>
        <Input
          id={`${id}-id`}
          value={value}
          aria-describedby={idHint ? `${id}-id-hint` : undefined}
          onChange={(event) => onChange(event.target.value)}
        />
        {idHint ? <p id={`${id}-id-hint`} className="mt-1 text-[12.5px] text-muted">{idHint}</p> : null}
      </div>
    </div>
  );
}
