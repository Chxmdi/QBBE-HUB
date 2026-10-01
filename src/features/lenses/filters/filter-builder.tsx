"use client";

import * as React from "react";
import { Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox, Input, Select } from "@/components/ui/input";
import type { CatalogProperty, CatalogType } from "@/lib/query/catalog";
import { RELATIVE_DATES, type LensOperator } from "@/lib/query/spec";
import { useLensT } from "@/features/lenses/i18n/client";
import type { LensT } from "@/features/lenses/i18n";
import {
  appendTo,
  canAddCondition,
  canAddGroup,
  canSetJoin,
  countConditions,
  defaultCondition,
  emptyGroup,
  isDateValue,
  issueOf,
  MAX_CONDITIONS,
  maxDepthFor,
  operatorsFor,
  propertyOf,
  removeNode,
  setJoin,
  updateNode,
  valueShape,
  withOperator,
  withProperty,
  type FilterCondition,
  type FilterGroup,
  type Join,
  type SummaryLabels,
} from "./filter-model";

export interface PersonChoice {
  id: string;
  label: string;
}

interface Props {
  type: CatalogType;
  value: FilterGroup;
  onChange: (next: FilterGroup) => void;
  people?: PersonChoice[];
  locale: string;
  /** Closes the panel; shown as a "Done" button when given. */
  onDone?: () => void;
}

/** The labels the model's summaries need, from the lens strings. */
export function summaryLabels(t: LensT): SummaryLabels {
  return {
    operator: (operator) => t(`filters.operators.${operator}` as "filters.operators.is"),
    relative: (key) => t(`filters.relative.${key}` as "filters.relative.today"),
    me: t("filters.me"),
    yes: t("filters.yes"),
    no: t("filters.no"),
    and: t("filters.and"),
    or: t("filters.or"),
    advanced: t("filters.advanced"),
  };
}

/**
 * Nested AND/OR filter groups for one type (U13). Every control is a native
 * field, so it works by keyboard and with a screen reader; the tree is kept
 * in the model and serialised to the engine's where clause by the caller.
 */
export function FilterBuilder({ type, value, onChange, people = [], locale, onDone }: Props) {
  const t = useLensT();
  const properties = React.useMemo(() => type.properties, [type]);
  const count = countConditions(value);
  const name = (p: CatalogProperty) => (locale.startsWith("fr") ? p.name.fr : p.name.en);

  const addCondition = (groupId: string) => {
    const first = properties[0];
    if (!first) return;
    onChange(appendTo(value, groupId, defaultCondition(first)));
  };
  const addGroup = (groupId: string) => onChange(appendTo(value, groupId, emptyGroup(value.join === "and" ? "or" : "and")));

  const renderGroup = (group: FilterGroup, depth: number): React.ReactNode => {
    const isRoot = group.id === value.id;
    return (
      <fieldset
        key={group.id}
        data-filter-group={depth}
        className={cn("min-w-0", !isRoot && "mt-2 rounded-(--radius-md) border border-line bg-surface-soft/60 p-3")}
      >
        <legend className="sr-only">{isRoot ? t("filters.rootGroup") : t("filters.group")}</legend>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-[13px] font-medium text-ink">
            {t("filters.match")}
            <Select
              value={group.join}
              onChange={(e) => onChange(setJoin(value, group.id, e.target.value as Join))}
              className="h-8! w-auto! px-2! text-[13px]!"
            >
              <option value="and">{t("filters.all")}</option>
              <option value="or" disabled={!canSetJoin(value, group.id, "or")}>
                {t("filters.any")}
              </option>
            </Select>
          </label>
          {!isRoot ? (
            <button
              type="button"
              onClick={() => onChange(removeNode(value, group.id))}
              aria-label={t("filters.removeGroup")}
              className="ml-auto inline-flex size-8 items-center justify-center rounded-(--radius-sm) text-muted hover:bg-surface hover:text-ink focus-visible:ring-2 focus-visible:ring-brand"
            >
              <X className="size-4" aria-hidden />
            </button>
          ) : null}
        </div>

        {group.items.length === 0 ? (
          <p className="mt-2 text-[13px] text-muted">{isRoot ? t("filters.empty") : t("filters.emptyGroup")}</p>
        ) : null}

        <div className="mt-2 space-y-2">
          {group.items.map((item) =>
            item.kind === "group" ? (
              renderGroup(item, depth + 1)
            ) : (
              <ConditionRow
                key={item.id}
                t={t}
                type={type}
                locale={locale}
                people={people}
                condition={item}
                name={name}
                onChange={(next) => onChange(updateNode(value, item.id, () => next))}
                onRemove={() => onChange(removeNode(value, item.id))}
              />
            ),
          )}
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" variant="secondary" disabled={!canAddCondition(value)} onClick={() => addCondition(group.id)}>
            <Plus className="size-3.5" aria-hidden />
            {t("filters.addCondition")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={!canAddGroup(value, group.id) || !canAddCondition(value)}
            title={!canAddGroup(value, group.id) ? t("filters.depthLimit", { max: maxDepthFor(value) }) : undefined}
            onClick={() => addGroup(group.id)}
          >
            <Plus className="size-3.5" aria-hidden />
            {t("filters.addGroup")}
          </Button>
        </div>
      </fieldset>
    );
  };

  return (
    <div role="group" aria-label={t("filters.title")} className="rounded-(--radius-md) border border-line bg-surface p-3">
      {renderGroup(value, 1)}
      <div className="mt-3 flex items-center justify-between gap-3 border-t border-line pt-2 text-[12.5px] text-muted">
        <span>{t("filters.count", { count, max: MAX_CONDITIONS })}</span>
        <span className="flex items-center gap-2">
          {count > 0 ? (
            <Button type="button" size="sm" variant="ghost" onClick={() => onChange({ ...emptyGroup(value.join), id: value.id })}>
              {t("filters.clear")}
            </Button>
          ) : null}
          {onDone ? (
            <Button type="button" size="sm" variant="secondary" onClick={onDone}>
              {t("filters.done")}
            </Button>
          ) : null}
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function ConditionRow({
  t,
  type,
  locale,
  people,
  condition,
  name,
  onChange,
  onRemove,
}: {
  t: LensT;
  type: CatalogType;
  locale: string;
  people: PersonChoice[];
  condition: FilterCondition;
  name: (p: CatalogProperty) => string;
  onChange: (next: FilterCondition) => void;
  onRemove: () => void;
}) {
  const errorId = React.useId();
  const property = propertyOf(type, condition.property);
  const issue = issueOf(condition, type);
  const message =
    issue === "property" ? t("filters.unknownProperty") : issue === "operator" ? t("filters.badOperator") : issue === "value" ? t("filters.needValue") : null;
  const describedBy = message ? errorId : undefined;

  return (
    <div data-filter-condition className="rounded-(--radius-sm) border border-line/70 bg-surface px-2 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          aria-label={t("filters.property")}
          aria-invalid={issue === "property" || undefined}
          aria-describedby={describedBy}
          value={property ? condition.property : ""}
          onChange={(e) => {
            const next = propertyOf(type, e.target.value);
            if (next) onChange(withProperty(condition, next));
          }}
          className="h-8! w-auto! max-w-56 px-2! text-[13px]!"
        >
          {!property ? <option value="">{condition.property}</option> : null}
          {type.properties.map((p) => (
            <option key={p.key} value={p.key}>
              {name(p)}
            </option>
          ))}
        </Select>
        {property ? (
          <Select
            aria-label={t("filters.operator")}
            aria-invalid={issue === "operator" || undefined}
            aria-describedby={describedBy}
            value={condition.operator}
            onChange={(e) => onChange(withOperator(condition, property, e.target.value as LensOperator))}
            className="h-8! w-auto! px-2! text-[13px]!"
          >
            {condition.operator === "matches" ? <option value="matches">{t("filters.operators.matches")}</option> : null}
            {operatorsFor(property).map((o) => (
              <option key={o} value={o}>
                {t(`filters.operators.${o}` as "filters.operators.is")}
              </option>
            ))}
          </Select>
        ) : null}
        {property ? (
          <ValueInput
            t={t}
            locale={locale}
            people={people}
            property={property}
            condition={condition}
            invalid={issue === "value"}
            describedBy={describedBy}
            onChange={(value) => onChange({ ...condition, value })}
          />
        ) : null}
        <button
          type="button"
          onClick={onRemove}
          aria-label={t("filters.removeCondition")}
          className="ml-auto inline-flex size-8 shrink-0 items-center justify-center rounded-(--radius-sm) text-muted hover:bg-surface-soft hover:text-ink focus-visible:ring-2 focus-visible:ring-brand"
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>
      {message ? (
        <p id={errorId} className="mt-1 text-[12.5px] text-danger-fg">
          {message}
        </p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------

const field = "h-8! w-auto! px-2! text-[13px]!";

function ValueInput({
  t,
  locale,
  people,
  property,
  condition,
  invalid,
  describedBy,
  onChange,
}: {
  t: LensT;
  locale: string;
  people: PersonChoice[];
  property: CatalogProperty;
  condition: FilterCondition;
  invalid: boolean;
  describedBy?: string;
  onChange: (value: unknown) => void;
}) {
  const shape = valueShape(property, condition.operator);
  const value = condition.value;
  const common = { "aria-invalid": invalid || undefined, "aria-describedby": describedBy };
  const choiceLabel = (c: { label: { en: string; fr: string } }) => (locale.startsWith("fr") ? c.label.fr : c.label.en);

  switch (shape) {
    case "none":
      return null;
    case "advanced":
      return <span className="text-[13px] text-muted">{t("filters.advanced")}</span>;
    case "text":
      return (
        <Input
          {...common}
          aria-label={t("filters.value")}
          value={typeof value === "string" ? value : ""}
          maxLength={500}
          onChange={(e) => onChange(e.target.value)}
          className={cn(field, "w-48!")}
        />
      );
    case "id":
      return (
        <Input
          {...common}
          aria-label={t("filters.identifier")}
          placeholder={t("filters.identifier")}
          value={typeof value === "string" ? value : ""}
          maxLength={500}
          onChange={(e) => onChange(e.target.value)}
          className={cn(field, "w-72!")}
        />
      );
    case "ids":
      return (
        <Input
          {...common}
          aria-label={t("filters.identifiers")}
          placeholder={t("filters.identifiers")}
          value={Array.isArray(value) ? value.join(", ") : ""}
          maxLength={2000}
          onChange={(e) => {
            const list = e.target.value.split(",").map((v) => v.trim()).filter(Boolean);
            onChange(list.length ? list : undefined);
          }}
          className={cn(field, "w-72!")}
        />
      );
    case "number":
      return (
        <NumberInput {...common} label={t("filters.value")} value={typeof value === "number" ? value : null} onChange={onChange} />
      );
    case "number_range": {
      const v = (value ?? {}) as { from?: number; to?: number };
      const set = (patch: Partial<typeof v>) => onChange({ ...v, ...patch });
      return (
        <>
          <NumberInput {...common} label={t("filters.from")} value={typeof v.from === "number" ? v.from : null} onChange={(from) => set({ from: from as number | undefined })} />
          <NumberInput {...common} label={t("filters.to")} value={typeof v.to === "number" ? v.to : null} onChange={(to) => set({ to: to as number | undefined })} />
        </>
      );
    }
    case "date":
      return <DateInput {...common} t={t} label={t("filters.when")} value={value} onChange={onChange} />;
    case "date_range": {
      const v = (value ?? {}) as { from?: unknown; to?: unknown };
      return (
        <>
          <DateInput {...common} t={t} label={t("filters.from")} value={v.from} onChange={(from) => onChange({ ...v, from })} />
          <DateInput {...common} t={t} label={t("filters.to")} value={v.to} onChange={(to) => onChange({ ...v, to })} />
        </>
      );
    }
    case "choice":
      return (
        <Select {...common} aria-label={t("filters.value")} value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value)} className={field}>
          {(property.choices ?? []).map((c) => (
            <option key={c.key} value={c.key}>
              {choiceLabel(c)}
            </option>
          ))}
        </Select>
      );
    case "choices": {
      const selected = new Set(Array.isArray(value) ? (value as string[]) : []);
      return (
        <fieldset aria-describedby={describedBy} className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <legend className="sr-only">{t("filters.choices")}</legend>
          {(property.choices ?? []).map((c) => (
            <label key={c.key} className="flex items-center gap-1.5 text-[13px] text-ink">
              <Checkbox
                checked={selected.has(c.key)}
                onChange={(e) => {
                  const next = new Set(selected);
                  if (e.target.checked) next.add(c.key);
                  else next.delete(c.key);
                  const list = (property.choices ?? []).map((x) => x.key).filter((k) => next.has(k));
                  onChange(list.length ? list : undefined);
                }}
              />
              {choiceLabel(c)}
            </label>
          ))}
        </fieldset>
      );
    }
    case "person": {
      const isMe = typeof value === "object" && value !== null && (value as { relative?: string }).relative === "me";
      if (people.length === 0 && !isMe && typeof value === "string") {
        return (
          <Input
            {...common}
            aria-label={t("filters.person")}
            value={value}
            maxLength={500}
            onChange={(e) => onChange(e.target.value)}
            className={cn(field, "w-72!")}
          />
        );
      }
      return (
        <Select
          {...common}
          aria-label={t("filters.person")}
          value={isMe ? "__me" : typeof value === "string" ? value : "__me"}
          onChange={(e) => onChange(e.target.value === "__me" ? { relative: "me" } : e.target.value)}
          className={field}
        >
          <option value="__me">{t("filters.me")}</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </Select>
      );
    }
    case "boolean":
      return (
        <Select {...common} aria-label={t("filters.value")} value={value === false ? "no" : "yes"} onChange={(e) => onChange(e.target.value === "yes")} className={field}>
          <option value="yes">{t("filters.yes")}</option>
          <option value="no">{t("filters.no")}</option>
        </Select>
      );
  }
}

function NumberInput({
  label,
  value,
  onChange,
  ...aria
}: {
  label: string;
  value: number | null;
  onChange: (value: unknown) => void;
  "aria-invalid"?: true;
  "aria-describedby"?: string;
}) {
  // Keep what is typed, so "1." or "-" survive until the number is complete.
  const [draft, setDraft] = React.useState(value === null ? "" : String(value));
  // When the model's value changes from outside, show it (adjusted during
  // render rather than in an effect, so there is no second pass).
  const [seen, setSeen] = React.useState(value);
  if (seen !== value) {
    setSeen(value);
    if (value !== null && Number(draft) !== value) setDraft(String(value));
  }
  return (
    <Input
      {...aria}
      type="number"
      step="any"
      inputMode="decimal"
      aria-label={label}
      value={draft}
      onChange={(e) => {
        setDraft(e.target.value);
        const n = e.target.value.trim() === "" ? NaN : Number(e.target.value);
        onChange(Number.isFinite(n) ? n : undefined);
      }}
      className={cn(field, "w-28!")}
    />
  );
}

function DateInput({
  t,
  label,
  value,
  onChange,
  ...aria
}: {
  t: LensT;
  label: string;
  value: unknown;
  onChange: (value: unknown) => void;
  "aria-invalid"?: true;
  "aria-describedby"?: string;
}) {
  const relative = isDateValue(value) && "relative" in value ? value.relative : null;
  const date = isDateValue(value) && "date" in value ? value.date : "";
  const [custom, setCustom] = React.useState(relative === null);
  const mode = custom || relative === null ? "date" : relative;
  return (
    <>
      <Select
        {...aria}
        aria-label={label}
        value={mode}
        onChange={(e) => {
          if (e.target.value === "date") {
            setCustom(true);
            onChange(date ? { date } : undefined);
          } else {
            setCustom(false);
            onChange({ relative: e.target.value });
          }
        }}
        className={field}
      >
        {RELATIVE_DATES.map((key) => (
          <option key={key} value={key}>
            {t(`filters.relative.${key}` as "filters.relative.today")}
          </option>
        ))}
        <option value="date">{t("filters.onDate")}</option>
      </Select>
      {mode === "date" ? (
        <Input
          {...aria}
          type="date"
          aria-label={t("filters.date")}
          value={date}
          onChange={(e) => onChange(e.target.value ? { date: e.target.value } : undefined)}
          className={cn(field, "w-40!")}
        />
      ) : null}
    </>
  );
}
