"use client";

import * as React from "react";
import { Select } from "@/components/ui/input";
import type { CatalogProperty } from "@/lib/query/catalog";
import type { LensValue } from "@/lib/query/run";
import { useLensT } from "@/features/lenses/i18n/client";
import { maxLengthFor, parseCellInput, type CellError, type CellOption, type EditorKind } from "./editable";
import { isRef } from "./model";
import type { PersonOption } from "./table-lens";
import { loadCellOptions } from "./units/d1-options";

/**
 * The in-place editor for one table cell. Wave 2 unit D1 owns this file (and
 * editable.ts): one editor per property kind. A value that does not fit the
 * kind is refused here with a message, and the editor stays open; nothing is
 * saved until it fits. The server checks it again.
 */

/** The text an editor starts from for a stored value. */
export function draftFor(kind: EditorKind, value: LensValue): string {
  if (value === null || value === undefined) return kind === "checkbox" ? "false" : "";
  if (isRef(value)) return value.id;
  if (typeof value === "boolean") return value ? "true" : "false";
  if (kind === "date") return String(value).slice(0, 10);
  return String(value);
}

const FIELD_CLASS = "h-7! w-full rounded-(--radius-sm) border border-brand! bg-surface px-1.5! text-[13.5px]! text-ink aria-invalid:border-danger!";

type Options = { state: "idle" | "loading" | "failed" } | { state: "ready"; list: CellOption[] };

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
  const t = useLensT();
  const [draft, setDraft] = React.useState(() => draftFor(kind, value));
  const [error, setError] = React.useState<CellError | null>(null);
  const picks = kind === "person" || kind === "relation";
  const [options, setOptions] = React.useState<Options>({ state: picks ? "loading" : "idle" });
  const done = React.useRef(false);
  const fieldId = React.useId();
  const errorId = `${fieldId}-error`;

  React.useEffect(() => {
    if (!picks) return;
    let live = true;
    loadCellOptions(kind, property, people).then(
      (list) => live && setOptions({ state: "ready", list }),
      () => live && setOptions({ state: "failed" }),
    );
    return () => {
      live = false;
    };
  }, [picks, kind, property, people]);

  // The current value stays offered even when the list no longer holds it.
  const list: CellOption[] = React.useMemo(() => {
    const loaded = options.state === "ready" ? options.list : [];
    if (isRef(value) && !loaded.some((o) => o.id === value.id)) return [{ id: value.id, label: value.label ?? value.id }, ...loaded];
    return loaded;
  }, [options, value]);

  const finish = (fromBlur: boolean) => {
    if (done.current) return;
    const parsed = parseCellInput(kind, draft, {
      property: property.key,
      locale,
      choices: property.choices,
      options: picks ? list : undefined,
    });
    if (!parsed.ok) {
      // Leaving the cell with a value that does not fit saves nothing.
      if (fromBlur) {
        done.current = true;
        onCancel();
        return;
      }
      setError(parsed.error);
      return;
    }
    done.current = true;
    onCommit(parsed.value, parsed.raw);
  };
  const cancel = () => {
    if (done.current) return;
    done.current = true;
    onCancel();
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === "Enter" && !(kind === "multi_select" && e.shiftKey)) {
      e.preventDefault();
      finish(false);
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancel();
    } else if (e.key === "Tab") {
      // Like a spreadsheet: Tab saves and moves along the row.
      e.preventDefault();
      const cell = (e.currentTarget as HTMLElement).closest<HTMLElement>("[data-cell]");
      const grid = cell?.closest<HTMLElement>('[role="grid"]');
      const [row, col] = (cell?.dataset.cell ?? "").split(":").map(Number);
      finish(false);
      if (done.current && grid && Number.isInteger(row) && Number.isInteger(col)) {
        const next = `${row}:${col + (e.shiftKey ? -1 : 1)}`;
        // After the table has put focus back on the edited cell.
        requestAnimationFrame(() => requestAnimationFrame(() => grid.querySelector<HTMLElement>(`[data-cell="${next}"]`)?.focus()));
      }
    }
  };
  const change = (next: string) => {
    setDraft(next);
    setError(null);
  };
  const common = {
    id: fieldId,
    "aria-label": label,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": error ? errorId : undefined,
    autoFocus: true,
    onKeyDown,
    onBlur: () => finish(true),
    className: FIELD_CLASS,
  };
  const message = error ? <CellMessage id={errorId} anchorId={fieldId} text={t(`units.d1.invalid.${error}`)} /> : null;
  const optionLabel = (c: { label: { en: string; fr: string } }) => (locale.startsWith("fr") ? c.label.fr : c.label.en);

  if (kind === "select") {
    return (
      <>
        <Select {...common} value={draft} onChange={(e) => change(e.target.value)}>
          {draft === "" ? <option value="">{notSet}</option> : null}
          {(property.choices ?? []).map((c) => (
            <option key={c.key} value={c.key}>
              {optionLabel(c)}
            </option>
          ))}
        </Select>
        {message}
      </>
    );
  }
  if (kind === "multi_select") {
    const chosen = draft.split(",").map((k) => k.trim()).filter(Boolean);
    return (
      <>
        <select
          {...common}
          multiple
          value={chosen}
          onChange={(e) => change([...e.target.selectedOptions].map((o) => o.value).join(","))}
          className={`${FIELD_CLASS} h-auto!`}
        >
          {(property.choices ?? []).map((c) => (
            <option key={c.key} value={c.key}>
              {optionLabel(c)}
            </option>
          ))}
        </select>
        {message}
      </>
    );
  }
  if (kind === "checkbox") {
    return (
      <>
        <input
          {...common}
         
          type="checkbox"
          checked={draft === "true"}
          onChange={(e) => change(e.target.checked ? "true" : "false")}
          className="size-4 accent-brand"
        />
        <span className="ml-2">{draft === "true" ? t("units.d1.yes") : t("units.d1.no")}</span>
      </>
    );
  }
  if (picks) {
    return (
      <>
        <Select {...common} value={draft} onChange={(e) => change(e.target.value)} aria-busy={options.state === "loading" || undefined}>
          <option value="">{notSet}</option>
          {options.state === "loading" ? <option disabled>{t("units.d1.loadingOptions")}</option> : null}
          {options.state === "failed" ? <option disabled>{t("units.d1.optionsFailed")}</option> : null}
          {list.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </Select>
        {message}
      </>
    );
  }
  return (
    <>
      <input
        {...common}
       
        type={kind === "date" ? "date" : "text"}
        inputMode={kind === "number" ? "decimal" : kind === "email" ? "email" : kind === "url" ? "url" : undefined}
        maxLength={kind === "text" ? maxLengthFor(property.key) : undefined}
        value={draft}
        onChange={(e) => change(e.target.value)}
      />
      {message}
    </>
  );
}

/**
 * Why a value was refused, under the editor. Fixed to the screen so the
 * cell's clipping cannot hide it.
 */
function CellMessage({ id, anchorId, text }: { id: string; anchorId: string; text: string }) {
  const rect = typeof document === "undefined" ? undefined : document.getElementById(anchorId)?.getBoundingClientRect();
  const place = rect ? { top: rect.bottom + 4, left: Math.max(8, Math.min(rect.left, window.innerWidth - 288)) } : null;
  return (
    <span
      id={id}
      role="alert"
      style={place ? { position: "fixed", top: place.top, left: place.left } : undefined}
      className="z-(--z-overlay) w-max max-w-72 rounded-(--radius-sm) border border-danger/30 bg-surface px-2 py-1 text-[12.5px] font-medium text-danger-fg shadow-lg"
    >
      {text}
    </span>
  );
}
