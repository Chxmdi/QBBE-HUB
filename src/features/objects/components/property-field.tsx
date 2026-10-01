"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox, Input, Select } from "@/components/ui/input";
import { useFormatters, useLocale } from "@/lib/i18n/client";
import type { PropertyValue, SelectOption } from "@/lib/objects/contracts";
import { setRecordProperty, undoRecordChange } from "@/features/objects/actions/record.commands";
import { useObjectsT } from "@/features/objects/i18n/client";
import type { ObjectsKey } from "@/features/objects/i18n/catalog";
import type { RecordPerson, RecordProperty } from "@/features/objects/services/record-page.queries";

type SaveState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved"; changeSetId: string }
  | { kind: "undoing" }
  | { kind: "undone" }
  | { kind: "error"; message: string };

/** What the field edits, as a plain string (or strings) the controls can hold. */
type Draft = string | string[] | { start: string; end: string } | boolean;

function initialDraft(property: RecordProperty): Draft {
  const value = property.value;
  switch (property.definition.kind) {
    case "checkbox":
      return value?.kind === "checkbox" ? value.value : false;
    case "multi_select":
      return value?.kind === "multi_select" ? [...value.value] : [];
    case "date_range":
      return value?.kind === "date_range"
        ? { start: value.value.start.slice(0, 10), end: (value.value.end ?? "").slice(0, 10) }
        : { start: "", end: "" };
    case "date":
      return value?.kind === "date" ? value.value.slice(0, 10) : "";
    case "person":
      return value?.kind === "person" ? (value.value[0] ?? "") : "";
    default:
      return value && "value" in value && value.value !== null && typeof value.value !== "object"
        ? String(value.value)
        : "";
  }
}

/**
 * The value to send to object.set_property: the PropertyValue's `value` for a
 * custom property, the raw column value for a native one; null clears.
 */
export function draftToValue(property: RecordProperty, draft: Draft): unknown {
  const { kind, systemColumn } = property.definition;
  switch (kind) {
    case "checkbox":
      return Boolean(draft);
    case "multi_select":
      return Array.isArray(draft) && draft.length > 0 ? draft : null;
    case "date_range": {
      const range = draft as { start: string; end: string };
      if (!range.start) return null;
      return { start: range.start, end: range.end || null };
    }
    case "number":
    case "currency":
    case "duration":
    case "progress":
    case "rating": {
      const text = String(draft).trim();
      if (text === "") return null;
      const number = Number(text.replace(",", "."));
      return Number.isFinite(number) ? number : null;
    }
    case "person": {
      const id = String(draft);
      if (!id) return null;
      return systemColumn ? id : [id];
    }
    default: {
      const text = String(draft).trim();
      return text === "" ? null : text;
    }
  }
}

function sameDraft(a: Draft, b: Draft): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function choiceLabel(choice: SelectOption, locale: string): string {
  return (locale === "fr-CA" ? choice.label.fr : choice.label.en) || choice.key;
}

/**
 * One property on the record page (U14): an editable control for the kinds a
 * person types in, a read-only value otherwise, and for derived kinds the
 * reason it cannot be edited. Saving goes through the object.set_property
 * action, so a change set is recorded and the Undo link reverses it.
 */
export function PropertyField({
  objectId,
  objectType,
  property,
  people,
  members,
}: {
  objectId: string;
  objectType: string;
  property: RecordProperty;
  people: Record<string, string>;
  members: RecordPerson[];
}) {
  const t = useObjectsT();
  const locale = useLocale();
  const router = useRouter();
  const id = useId();
  const name = locale === "fr-CA" ? property.definition.name.fr : property.definition.name.en;
  const [draft, setDraft] = useState<Draft>(() => initialDraft(property));
  const [state, setState] = useState<SaveState>({ kind: "idle" });
  const serialized = JSON.stringify(property.value);
  const [seen, setSeen] = useState(serialized);

  // A refresh after a save (or someone else's change) brings a new value in:
  // start the draft again from it.
  if (seen !== serialized) {
    setSeen(serialized);
    setDraft(initialDraft(property));
  }

  const dirty = !sameDraft(draft, initialDraft(property));

  async function save(next: Draft = draft) {
    setState({ kind: "saving" });
    const result = await setRecordProperty({
      objectId,
      objectType,
      property: property.key,
      value: draftToValue(property, next),
    });
    if (result.ok) {
      setState({ kind: "saved", changeSetId: result.changeSetId });
      router.refresh();
    } else {
      setState({ kind: "error", message: result.error });
    }
  }

  async function undo(changeSetId: string) {
    setState({ kind: "undoing" });
    const result = await undoRecordChange({ changeSetId });
    if (result.ok) {
      setState({ kind: "undone" });
      router.refresh();
    } else {
      setState({ kind: "error", message: result.error });
    }
  }

  const status =
    state.kind === "saving" ? (
      <p role="status" className="meta">{t("record.properties.saving")}</p>
    ) : state.kind === "undoing" ? (
      <p role="status" className="meta">{t("record.properties.undoing")}</p>
    ) : state.kind === "saved" ? (
      <p role="status" className="meta flex flex-wrap items-center gap-2">
        {t("record.properties.saved")}
        <button
          type="button"
          onClick={() => undo(state.changeSetId)}
          className="font-semibold text-brand-fg underline-offset-2 hover:underline"
        >
          {t("record.properties.undo")}
        </button>
      </p>
    ) : state.kind === "undone" ? (
      <p role="status" className="meta">{t("record.properties.undone")}</p>
    ) : state.kind === "error" ? (
      <p role="alert" className="text-[13px] text-danger-fg">{state.message}</p>
    ) : null;

  const busy = state.kind === "saving" || state.kind === "undoing";

  if (property.mode !== "editable") {
    return (
      <div className="flex flex-col gap-1 px-4 py-3 sm:grid sm:grid-cols-[minmax(10rem,max-content)_1fr] sm:gap-x-6">
        <dt className="meta flex items-center gap-1.5">
          {name}
          {property.mode === "derived" || property.mode === "link" || property.definition.systemColumn ? (
            <WhyReadOnly id={`${id}-why`} reason={t(reasonKey(property))} label={t("record.properties.why")} />
          ) : null}
        </dt>
        <dd className="text-[13.5px]" data-testid={`property-${property.key}`}>
          <ReadOnlyValue property={property} people={people} />
        </dd>
      </div>
    );
  }

  const { kind, options } = property.definition;
  const choices = options.choices ?? [];
  const inputType =
    kind === "url" ? "url" : kind === "email" ? "email" : kind === "phone" ? "tel" : kind === "date" ? "date" : "text";

  return (
    <form
      className="flex flex-col gap-1 px-4 py-3 sm:grid sm:grid-cols-[minmax(10rem,max-content)_1fr] sm:gap-x-6"
      onSubmit={(event) => {
        event.preventDefault();
        if (dirty && !busy) void save();
      }}
    >
      <dt className="meta pt-2">
        {kind === "multi_select" ? (
          <span id={`${id}-label`}>{name}</span>
        ) : kind === "date_range" ? (
          <span id={`${id}-label`}>{name}</span>
        ) : (
          <label htmlFor={id}>{name}</label>
        )}
      </dt>
      <dd className="flex flex-col gap-2" data-testid={`property-${property.key}`}>
        <div className="flex flex-wrap items-center gap-2">
          {kind === "checkbox" ? (
            <Checkbox
              id={id}
              checked={Boolean(draft)}
              disabled={busy}
              onChange={(event) => {
                setDraft(event.target.checked);
                void save(event.target.checked);
              }}
            />
          ) : kind === "status" || kind === "select" ? (
            <Select id={id} value={String(draft)} disabled={busy} onChange={(event) => setDraft(event.target.value)} className="max-w-xs">
              <option value="">{t("record.properties.noChoice")}</option>
              {choices.map((choice) => (
                <option key={choice.key} value={choice.key}>
                  {choiceLabel(choice, locale)}
                </option>
              ))}
            </Select>
          ) : kind === "person" ? (
            <Select id={id} value={String(draft)} disabled={busy} onChange={(event) => setDraft(event.target.value)} className="max-w-xs">
              <option value="">{t("record.properties.nobody")}</option>
              {members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
            </Select>
          ) : kind === "multi_select" ? (
            <fieldset className="flex flex-wrap gap-3" aria-labelledby={`${id}-label`}>
              <legend className="sr-only">{t("record.properties.choices", { name })}</legend>
              {choices.map((choice) => {
                const picked = Array.isArray(draft) && draft.includes(choice.key);
                return (
                  <label key={choice.key} className="flex items-center gap-1.5 text-[13.5px]">
                    <Checkbox
                      checked={picked}
                      disabled={busy}
                      onChange={(event) => {
                        const current = Array.isArray(draft) ? draft : [];
                        setDraft(
                          event.target.checked ? [...current, choice.key] : current.filter((key) => key !== choice.key),
                        );
                      }}
                    />
                    {choiceLabel(choice, locale)}
                  </label>
                );
              })}
            </fieldset>
          ) : kind === "date_range" ? (
            <div className="flex flex-wrap items-center gap-2" role="group" aria-labelledby={`${id}-label`}>
              <Input
                type="date"
                aria-label={t("record.properties.start", { name })}
                value={(draft as { start: string }).start}
                disabled={busy}
                onChange={(event) => setDraft({ ...(draft as { start: string; end: string }), start: event.target.value })}
                className="max-w-44"
              />
              <Input
                type="date"
                aria-label={t("record.properties.end", { name })}
                value={(draft as { end: string }).end}
                disabled={busy}
                onChange={(event) => setDraft({ ...(draft as { start: string; end: string }), end: event.target.value })}
                className="max-w-44"
              />
            </div>
          ) : kind === "number" || kind === "currency" || kind === "duration" || kind === "progress" || kind === "rating" ? (
            <Input
              id={id}
              type="number"
              inputMode="decimal"
              step={kind === "rating" ? 1 : "any"}
              min={kind === "progress" || kind === "rating" ? 0 : undefined}
              max={kind === "progress" ? 100 : kind === "rating" ? 5 : undefined}
              value={String(draft)}
              disabled={busy}
              onChange={(event) => setDraft(event.target.value)}
              className="max-w-44"
            />
          ) : (
            <Input
              id={id}
              type={inputType}
              value={String(draft)}
              disabled={busy}
              onChange={(event) => setDraft(event.target.value)}
              className="max-w-md"
            />
          )}
          {kind !== "checkbox" ? (
            <Button type="submit" size="sm" variant="secondary" disabled={!dirty || busy} loading={state.kind === "saving"}>
              {t("record.properties.save", { name })}
            </Button>
          ) : null}
        </div>
        {status}
      </dd>
    </form>
  );
}

function reasonKey(property: RecordProperty): ObjectsKey {
  const kind = property.definition.kind;
  switch (kind) {
    case "formula":
    case "rollup":
    case "created_by":
    case "created_time":
    case "edited_by":
    case "edited_time":
    case "relation":
    case "file":
      return `record.properties.derived.${kind}`;
    default:
      return "record.properties.derived.system";
  }
}

/** A small "why" marker whose explanation shows on hover and on keyboard focus. */
function WhyReadOnly({ id, reason, label }: { id: string; reason: string; label: string }) {
  return (
    <span className="group relative inline-flex">
      <button
        type="button"
        aria-label={label}
        aria-describedby={id}
        className="inline-flex size-4 items-center justify-center rounded-full border border-line text-[10px] font-semibold text-muted hover:text-ink focus-visible:text-ink"
      >
        ?
      </button>
      <span
        id={id}
        role="tooltip"
        className="pointer-events-none absolute top-full left-0 z-10 mt-1 hidden w-56 rounded-(--radius-sm) border border-line bg-surface px-2 py-1 text-[12px] font-normal text-ink shadow-(--shadow-raise) group-focus-within:block group-hover:block"
      >
        {reason}
      </span>
    </span>
  );
}

function ReadOnlyValue({ property, people }: { property: RecordProperty; people: Record<string, string> }) {
  const t = useObjectsT();
  const locale = useLocale();
  const format = useFormatters();
  const empty = <span className="meta">{t("record.properties.empty")}</span>;
  const { definition, value, formula, display, links } = property;

  if (definition.kind === "formula" && formula && !formula.ok) {
    return <span className="text-warning-fg">{t("record.properties.formulaError", { message: formula.message })}</span>;
  }
  if (property.mode === "link") {
    if (!links || links.length === 0) {
      return <span className="meta">{t(definition.kind === "file" ? "record.properties.filesNone" : "record.properties.linksNone")}</span>;
    }
    return (
      <ul className="flex flex-wrap gap-x-3 gap-y-1">
        {links.map((link) => (
          <li key={link.id}>
            <Link href={link.href} aria-label={t("record.properties.openLink", { title: link.title })} className="text-brand-fg underline-offset-2 hover:underline">
              {link.title}
            </Link>
          </li>
        ))}
      </ul>
    );
  }
  if (!value || ("value" in value && (value.value === null || value.value === ""))) {
    // A task's native field may still have a display form (a project link).
    if (display && display.kind === "link") {
      return <Link href={display.href} className="text-brand-fg underline-offset-2 hover:underline">{display.text}</Link>;
    }
    return empty;
  }
  return <>{formatValue(value, definition.options.choices ?? [], people, locale, format, t)}</>;
}

function formatValue(
  value: PropertyValue,
  choices: SelectOption[],
  people: Record<string, string>,
  locale: string,
  format: ReturnType<typeof useFormatters>,
  t: ReturnType<typeof useObjectsT>,
): string {
  switch (value.kind) {
    case "checkbox":
      return value.value ? t("record.properties.yes") : t("record.properties.no");
    case "number":
    case "duration":
    case "rating":
      return format.number(value.value);
    case "progress":
      return `${format.number(value.value)} %`;
    case "currency":
      return format.currency(value.value);
    case "date":
      return /^\d{4}-\d{2}-\d{2}$/.test(value.value) ? format.date(value.value) : format.dateTime(value.value);
    case "created_time":
    case "edited_time":
      return format.dateTime(value.value);
    case "date_range":
      return value.value.end ? `${format.date(value.value.start)} – ${format.date(value.value.end)}` : format.date(value.value.start);
    case "status":
    case "select": {
      const choice = choices.find((candidate) => candidate.key === value.value);
      return choice ? choiceLabel(choice, locale) : value.value;
    }
    case "multi_select":
      return value.value
        .map((key) => {
          const choice = choices.find((candidate) => candidate.key === key);
          return choice ? choiceLabel(choice, locale) : key;
        })
        .join(", ");
    case "person":
    case "created_by":
    case "edited_by":
      return value.value.map((id) => people[id] ?? t("record.properties.nobody")).join(", ");
    case "location":
      return value.value.label ?? `${value.value.lat}, ${value.value.lng}`;
    case "formula":
    case "rollup":
      if (value.value === null) return "";
      if (typeof value.value === "boolean") return value.value ? t("record.properties.yes") : t("record.properties.no");
      if (typeof value.value === "number") return format.number(value.value);
      return value.value;
    case "relation":
    case "file":
      return String(value.value.length);
    default:
      return String(value.value);
  }
}
