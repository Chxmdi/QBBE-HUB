"use client";

import * as React from "react";
import { Select } from "@/components/ui/input";
import type { CatalogProperty } from "@/lib/query/catalog";
import type { LensValue } from "@/lib/query/run";
import type { EditorKind } from "./editable";
import { isRef } from "./model";
import type { PersonOption } from "./table-lens";

/**
 * The in-place editor for one table cell. Wave 2 unit D1 owns this file (and
 * editable.ts): it extends editing to every property kind.
 */
export function CellEditor({
  kind,
  property,
  value,
  people,
  locale,
  label,
  notSet,
  onCommit,
  onCancel,
}: {
  kind: EditorKind;
  property: CatalogProperty;
  value: LensValue;
  people: PersonOption[];
  locale: string;
  label: string;
  notSet: string;
  onCommit: (next: LensValue, raw: string | null) => void;
  onCancel: () => void;
}) {
  const initial = isRef(value) ? value.id : value === null || value === undefined ? "" : String(value).slice(0, kind === "date" ? 10 : undefined);
  const [draft, setDraft] = React.useState(initial);
  const done = React.useRef(false);

  const finish = () => {
    if (done.current) return;
    done.current = true;
    const raw = draft.trim() === "" ? null : draft.trim();
    if (kind === "text" && raw === null) return onCancel();
    if (kind === "person") {
      const person = people.find((p) => p.id === raw);
      return onCommit(person ? { id: person.id, label: person.label } : null, raw);
    }
    if (kind === "select" && raw === null) return onCancel();
    onCommit(raw, raw);
  };
  const cancel = () => {
    if (done.current) return;
    done.current = true;
    onCancel();
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === "Enter") {
      e.preventDefault();
      finish();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancel();
    }
  };
  const common = {
    "aria-label": label,
    autoFocus: true,
    onKeyDown,
    onBlur: finish,
    className: "h-7! w-full rounded-(--radius-sm) border border-brand! bg-surface px-1.5! text-[13.5px]! text-ink",
  };

  if (kind === "select") {
    return (
      <Select {...common} value={draft} onChange={(e) => setDraft(e.target.value)}>
        {(property.choices ?? []).map((c) => (
          <option key={c.key} value={c.key}>
            {locale.startsWith("fr") ? c.label.fr : c.label.en}
          </option>
        ))}
      </Select>
    );
  }
  if (kind === "person") {
    return (
      <Select {...common} value={draft} onChange={(e) => setDraft(e.target.value)}>
        <option value="">{notSet}</option>
        {people.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
      </Select>
    );
  }
  return (
    <input
      {...common}
      type={kind === "date" ? "date" : "text"}
      maxLength={kind === "text" ? 300 : undefined}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
    />
  );
}
