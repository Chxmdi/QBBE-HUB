"use client";

import * as React from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox, FieldHint, Input, Label, Select, Switch } from "@/components/ui/input";
import { useLocale } from "@/lib/i18n/client";
import type { Locale } from "@/lib/i18n/config";
import { localized, operatorsFor, type CatalogProperty, type LensCatalog } from "@/lib/query/catalog";
import { EMPTINESS_OPERATORS, RELATIVE_DATES, type LensOperator } from "@/lib/query/spec";
import { useLensT } from "@/features/lenses/i18n/client";
import type { LensT } from "@/features/lenses/i18n";
import {
  VIEW_BLOCK_LIMITS,
  VIEW_BLOCK_VERSION,
  VIEW_LAYOUTS,
  viewBlockPropsSchema,
  type ParsedViewBlockProps,
  type ViewBlockProps,
  type ViewCondition,
  type ViewLayout,
} from "./schema";
import type { loadViewBlockOptions, ViewBlockLensOption } from "./view-block.actions";

/**
 * The view block's settings (U6): an inline panel under the block's header,
 * opened from its "Configure view" button. Plain form controls, so it works
 * with a keyboard and a screen reader as any form does; Escape closes it and
 * focus returns to the button. Nothing is stored until "Apply".
 */

interface Draft {
  source: ViewBlockProps["source"];
  layout: ViewLayout;
  title: string;
  where: ViewCondition[];
  sort: { path: string; direction: "asc" | "desc" }[];
  groupBy: string;
  fields: string[];
  pageFilters: { enabled: boolean; paths: string[] };
  maxRows: number;
}

function toDraft(value: ParsedViewBlockProps | null): Draft {
  return {
    source: value?.source ?? { type: "task" },
    layout: value?.layout ?? "table",
    title: value?.title ?? "",
    where: value?.where.map((c) => ({ ...c })) ?? [],
    sort: value?.sort.map((s) => ({ ...s })) ?? [],
    groupBy: value?.groupBy?.path ?? "",
    fields: [...(value?.fields ?? [])],
    pageFilters: { enabled: value?.pageFilters.enabled ?? false, paths: [...(value?.pageFilters.paths ?? [])] },
    maxRows: value?.maxRows ?? VIEW_BLOCK_LIMITS.defaultRows,
  };
}

function fromDraft(draft: Draft): ViewBlockProps {
  return {
    version: VIEW_BLOCK_VERSION,
    source: draft.source,
    layout: draft.layout,
    ...(draft.title.trim() ? { title: draft.title.trim() } : {}),
    where: draft.where,
    sort: draft.sort,
    ...(draft.groupBy ? { groupBy: { path: draft.groupBy } } : {}),
    fields: draft.fields,
    pageFilters: draft.pageFilters,
    maxRows: draft.maxRows,
  };
}

/** A value the engine accepts for this property and operator, to start from. */
function defaultValue(property: CatalogProperty, op: LensOperator): unknown {
  if (EMPTINESS_OPERATORS.includes(op)) return undefined;
  switch (property.kind) {
    case "text":
      return "";
    case "number":
      return op === "between" ? { from: 0, to: 0 } : 0;
    case "date":
      return op === "between" ? { from: { relative: "today" }, to: { relative: "today" } } : { relative: "today" };
    case "select":
      if (!property.choices?.length) return "";
      return op === "is_any_of" || op === "is_none_of" ? [property.choices[0].key] : property.choices[0].key;
    case "multi_select":
      return property.choices?.length ? [property.choices[0].key] : [];
    case "person":
      return { relative: "me" };
    case "checkbox":
      return true;
    default:
      return "";
  }
}

export function ViewConfig({
  id,
  value,
  load,
  onApply,
  onClose,
}: {
  id: string;
  value: ParsedViewBlockProps | null;
  load: typeof loadViewBlockOptions;
  onApply: (next: ViewBlockProps) => void;
  onClose: () => void;
}) {
  const t = useLensT();
  const locale = useLocale();
  const titleId = React.useId();
  const panel = React.useRef<HTMLDivElement>(null);
  const [options, setOptions] = React.useState<Awaited<ReturnType<typeof loadViewBlockOptions>> | null>(null);
  const [draft, setDraft] = React.useState<Draft>(() => toDraft(value));
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let live = true;
    load()
      .then((result) => live && setOptions(result))
      .catch(() => live && setOptions({ ok: false, reason: "failed" }));
    return () => {
      live = false;
    };
  }, [load]);

  const loaded = options?.ok === true;
  React.useEffect(() => {
    if (loaded) panel.current?.querySelector<HTMLElement>("select, input, button")?.focus();
  }, [loaded]);

  const catalog: LensCatalog = options?.ok ? options.catalog : {};
  const lenses: ViewBlockLensOption[] = options?.ok ? options.lenses : [];
  const source = draft.source;
  const sourceValue = "type" in source ? `type:${source.type}` : `lens:${source.lensId}`;
  const type = "type" in source ? source.type : (lenses.find((l) => l.id === source.lensId)?.typeKey ?? "task");
  const properties = catalog[type]?.properties ?? [];
  const shown = properties.filter((p) => !p.filterOnly && p.key !== "title");
  const filterable = shown.filter((p) => p.kind === "person" || p.kind === "date" || p.kind === "text" || p.kind === "number" || p.kind === "checkbox" || (p.kind === "select" && p.choices?.length));

  const update = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const changeSource = (raw: string) => {
    const [kind, key] = raw.split(":", 2);
    const nextSource: ViewBlockProps["source"] = kind === "lens" ? { lensId: key } : { type: key };
    const nextType = kind === "lens" ? (lenses.find((l) => l.id === key)?.typeKey ?? "task") : key;
    if (nextType === type) return update({ source: nextSource });
    // Another type has other properties: start its conditions from nothing.
    update({ source: nextSource, where: [], sort: [], groupBy: "", fields: [], pageFilters: { enabled: draft.pageFilters.enabled, paths: [] } });
  };
  const toggle = (list: string[], key: string, max: number) =>
    list.includes(key) ? list.filter((k) => k !== key) : list.length < max ? [...list, key] : list;

  const apply = () => {
    const parsed = viewBlockPropsSchema.safeParse(fromDraft(draft));
    if (!parsed.success) {
      setError(t("view.config.invalid"));
      return;
    }
    setError(null);
    onApply(parsed.data);
  };

  return (
    <div
      ref={panel}
      id={id}
      role="dialog"
      aria-labelledby={titleId}
      className="border-b border-line bg-surface px-4 py-3"
      data-view-config
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <h4 id={titleId} className="mb-3 text-[13px] font-semibold text-ink">
        {t("view.settings")}
      </h4>
      {options === null ? <p className="text-[13px] text-muted">{t("view.loading")}</p> : null}
      {options && !options.ok ? (
        <p role="alert" className="text-[13px] text-danger-fg">
          {options.reason === "off" ? t("view.off") : t("view.config.optionsFailed")}
        </p>
      ) : null}
      {options?.ok ? (
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <Label htmlFor={`${id}-source`}>{t("view.config.source")}</Label>
            <Select id={`${id}-source`} value={sourceValue} onChange={(e) => changeSource(e.target.value)}>
              <optgroup label={t("view.config.sourceTypes")}>
                {Object.values(catalog).map((entry) => (
                  <option key={entry.key} value={`type:${entry.key}`}>
                    {entry.key === "task" || entry.key === "project" ? t(`types.${entry.key}`) : localized(entry.name, locale)}
                  </option>
                ))}
              </optgroup>
              {lenses.length ? (
                <optgroup label={t("view.config.sourceLenses")}>
                  {lenses.map((lens) => (
                    <option key={lens.id} value={`lens:${lens.id}`}>
                      {lens.visibility === "shared" ? t("view.config.sharedLens", { name: lens.name }) : lens.name}
                    </option>
                  ))}
                </optgroup>
              ) : null}
            </Select>
          </div>
          <div>
            <Label htmlFor={`${id}-layout`}>{t("view.config.layout")}</Label>
            <Select id={`${id}-layout`} value={draft.layout} onChange={(e) => update({ layout: e.target.value as ViewLayout })}>
              {VIEW_LAYOUTS.map((layout) => (
                <option key={layout} value={layout}>{t(`view.layouts.${layout}`)}</option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor={`${id}-title`}>{t("view.config.title")}</Label>
            <Input id={`${id}-title`} value={draft.title} maxLength={120} onChange={(e) => update({ title: e.target.value })} />
            <FieldHint>{t("view.config.titleHint")}</FieldHint>
          </div>
          <div>
            <Label htmlFor={`${id}-rows`}>{t("view.config.maxRows")}</Label>
            <Input
              id={`${id}-rows`}
              type="number"
              min={1}
              max={VIEW_BLOCK_LIMITS.maxRows}
              value={draft.maxRows}
              onChange={(e) => update({ maxRows: Math.min(VIEW_BLOCK_LIMITS.maxRows, Math.max(1, Number.parseInt(e.target.value, 10) || 1)) })}
            />
          </div>

          <fieldset className="md:col-span-2">
            <legend className="mb-1.5 text-[13px] font-medium text-ink">{t("view.config.conditions")}</legend>
            <FieldHint>{t("view.config.conditionsHint")}</FieldHint>
            {draft.where.length === 0 ? <p className="mt-1 text-[12.5px] text-muted">{t("view.config.noConditions")}</p> : null}
            <ul className="mt-2 space-y-2">
              {draft.where.map((condition, index) => (
                <ConditionRow
                  key={index}
                  index={index + 1}
                  condition={condition}
                  properties={properties}
                  locale={locale}
                  t={t}
                  onChange={(next) => update({ where: draft.where.map((c, i) => (i === index ? next : c)) })}
                  onRemove={() => update({ where: draft.where.filter((_, i) => i !== index) })}
                />
              ))}
            </ul>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="mt-2"
              disabled={properties.length === 0 || draft.where.length >= VIEW_BLOCK_LIMITS.maxConditions}
              onClick={() => {
                const first = properties[0];
                const op = operatorsFor(first)[0];
                update({ where: [...draft.where, { path: first.key, op, value: defaultValue(first, op) }] });
              }}
            >
              <Plus className="size-3.5" aria-hidden />
              {t("view.config.addCondition")}
            </Button>
          </fieldset>

          <fieldset>
            <legend className="mb-1.5 text-[13px] font-medium text-ink">{t("view.config.sort")}</legend>
            <ul className="space-y-2">
              {draft.sort.map((sort, index) => (
                <li key={index} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-2">
                  <Select
                    aria-label={t("view.config.sortProperty", { index: index + 1 })}
                    className="h-8 text-[12.5px]"
                    value={sort.path}
                    onChange={(e) => update({ sort: draft.sort.map((s, i) => (i === index ? { ...s, path: e.target.value } : s)) })}
                  >
                    {properties.filter((p) => p.sortable).map((p) => (
                      <option key={p.key} value={p.key}>{localized(p.name, locale)}</option>
                    ))}
                  </Select>
                  <Select
                    aria-label={t("view.config.direction", { index: index + 1 })}
                    className="h-8 text-[12.5px]"
                    value={sort.direction}
                    onChange={(e) => update({ sort: draft.sort.map((s, i) => (i === index ? { ...s, direction: e.target.value as "asc" | "desc" } : s)) })}
                  >
                    <option value="asc">{t("view.config.asc")}</option>
                    <option value="desc">{t("view.config.desc")}</option>
                  </Select>
                  <Button type="button" size="sm" variant="ghost" aria-label={t("view.config.removeSort", { index: index + 1 })} onClick={() => update({ sort: draft.sort.filter((_, i) => i !== index) })}>
                    <X className="size-4" aria-hidden />
                  </Button>
                </li>
              ))}
            </ul>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="mt-2"
              disabled={draft.sort.length >= VIEW_BLOCK_LIMITS.maxSorts || !properties.some((p) => p.sortable)}
              onClick={() => update({ sort: [...draft.sort, { path: properties.find((p) => p.sortable)!.key, direction: "asc" }] })}
            >
              <Plus className="size-3.5" aria-hidden />
              {t("view.config.addSort")}
            </Button>
          </fieldset>

          <div>
            <Label htmlFor={`${id}-group`}>{t("view.config.groupBy")}</Label>
            <Select id={`${id}-group`} value={draft.groupBy} onChange={(e) => update({ groupBy: e.target.value })}>
              <option value="">{t("view.config.noGroup")}</option>
              {properties.filter((p) => p.groupable).map((p) => (
                <option key={p.key} value={p.key}>{localized(p.name, locale)}</option>
              ))}
            </Select>
          </div>

          <fieldset>
            <legend className="mb-1.5 text-[13px] font-medium text-ink">{t("view.config.fields")}</legend>
            <FieldHint>{t("view.config.fieldsHint", { count: VIEW_BLOCK_LIMITS.maxFields })}</FieldHint>
            <ul className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1">
              {shown.map((p) => (
                <li key={p.key}>
                  <label className="flex min-h-6 items-center gap-2 text-[12.5px] text-ink">
                    <Checkbox
                      checked={draft.fields.includes(p.key)}
                      disabled={!draft.fields.includes(p.key) && draft.fields.length >= VIEW_BLOCK_LIMITS.maxFields}
                      onChange={() => update({ fields: toggle(draft.fields, p.key, VIEW_BLOCK_LIMITS.maxFields) })}
                    />
                    {localized(p.name, locale)}
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>

          <fieldset>
            <legend className="sr-only">{t("view.localFilters")}</legend>
            <label htmlFor={`${id}-page-filters`} className="flex min-h-6 items-center gap-2 text-[13px] font-medium text-ink">
              <Switch
                id={`${id}-page-filters`}
                checked={draft.pageFilters.enabled}
                onChange={(e) => update({ pageFilters: { ...draft.pageFilters, enabled: e.target.checked } })}
              />
              {t("view.config.pageFilters")}
            </label>
            {draft.pageFilters.enabled ? (
              <>
                <p className="mt-2 mb-1 text-[12.5px] text-muted">{t("view.config.pageFilterPaths")}</p>
                <ul className="grid grid-cols-2 gap-x-3 gap-y-1">
                  {filterable.map((p) => (
                    <li key={p.key}>
                      <label className="flex min-h-6 items-center gap-2 text-[12.5px] text-ink">
                        <Checkbox
                          checked={draft.pageFilters.paths.includes(p.key)}
                          disabled={!draft.pageFilters.paths.includes(p.key) && draft.pageFilters.paths.length >= VIEW_BLOCK_LIMITS.maxPageFilters}
                          onChange={() => update({ pageFilters: { ...draft.pageFilters, paths: toggle(draft.pageFilters.paths, p.key, VIEW_BLOCK_LIMITS.maxPageFilters) } })}
                        />
                        {localized(p.name, locale)}
                      </label>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </fieldset>

          <div className="flex flex-wrap items-center justify-end gap-2 md:col-span-2">
            {error ? (
              <p role="alert" className="mr-auto text-[12.5px] text-danger-fg">
                {error}
              </p>
            ) : null}
            <Button type="button" size="sm" variant="secondary" onClick={onClose}>
              {t("view.config.cancel")}
            </Button>
            <Button type="button" size="sm" onClick={apply}>
              {t("view.config.apply")}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ConditionRow({
  index,
  condition,
  properties,
  locale,
  t,
  onChange,
  onRemove,
}: {
  index: number;
  condition: ViewCondition;
  properties: CatalogProperty[];
  locale: Locale;
  t: LensT;
  onChange: (next: ViewCondition) => void;
  onRemove: () => void;
}) {
  const property = properties.find((p) => p.key === condition.path) ?? properties[0];
  const operators = property ? operatorsFor(property).filter((op) => op !== "matches") : [];
  const field = "h-8 text-[12.5px]";
  return (
    <li className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.5fr)_auto]" data-view-condition={index}>
      <Select
        aria-label={t("view.config.property", { index })}
        className={field}
        value={condition.path}
        onChange={(e) => {
          const next = properties.find((p) => p.key === e.target.value);
          if (!next) return;
          const op = operatorsFor(next).filter((o) => o !== "matches")[0];
          onChange({ path: next.key, op, value: defaultValue(next, op) });
        }}
      >
        {properties.map((p) => (
          <option key={p.key} value={p.key}>{localized(p.name, locale)}</option>
        ))}
      </Select>
      <Select
        aria-label={t("view.config.operator", { index })}
        className={field}
        value={condition.op}
        onChange={(e) => {
          const op = e.target.value as LensOperator;
          onChange({ path: condition.path, op, value: property ? defaultValue(property, op) : undefined });
        }}
      >
        {operators.map((op) => (
          <option key={op} value={op}>{t(`view.config.operators.${op}`)}</option>
        ))}
      </Select>
      <div className="flex min-w-0 items-center gap-1">
        {property && !EMPTINESS_OPERATORS.includes(condition.op) ? (
          <ValueEditor index={index} property={property} op={condition.op} value={condition.value} locale={locale} t={t} onChange={(value) => onChange({ ...condition, value })} />
        ) : null}
      </div>
      <Button type="button" size="sm" variant="ghost" aria-label={t("view.config.removeCondition", { index })} onClick={onRemove}>
        <X className="size-4" aria-hidden />
      </Button>
    </li>
  );
}

type DateValue = { date: string } | { relative: string };
const asDate = (v: unknown): DateValue => (v && typeof v === "object" && ("date" in v || "relative" in v) ? (v as DateValue) : { relative: "today" });

function DateInput({ label, value, t, onChange }: { label: string; value: DateValue; t: LensT; onChange: (next: DateValue) => void }) {
  const exact = "date" in value;
  return (
    <span className="flex min-w-0 flex-1 items-center gap-1">
      <Select aria-label={label} className="h-8 min-w-0 text-[12.5px]" value={exact ? "__exact" : value.relative} onChange={(e) => onChange(e.target.value === "__exact" ? { date: new Date().toISOString().slice(0, 10) } : { relative: e.target.value })}>
        {RELATIVE_DATES.map((r) => (
          <option key={r} value={r}>{t(`dashboard.relative.${r}`)}</option>
        ))}
        <option value="__exact">{t("view.config.exactDate")}</option>
      </Select>
      {exact ? <Input aria-label={label} type="date" className="h-8 min-w-0 text-[12.5px]" value={value.date} onChange={(e) => onChange({ date: e.target.value })} /> : null}
    </span>
  );
}

function ValueEditor({
  index,
  property,
  op,
  value,
  locale,
  t,
  onChange,
}: {
  index: number;
  property: CatalogProperty;
  op: LensOperator;
  value: unknown;
  locale: Locale;
  t: LensT;
  onChange: (value: unknown) => void;
}) {
  const label = t("view.config.value", { index });
  const field = "h-8 min-w-0 text-[12.5px]";
  const between = op === "between";
  const range = (value && typeof value === "object" && "from" in value && "to" in value ? value : null) as { from: unknown; to: unknown } | null;

  if (property.kind === "person") {
    return (
      <Select aria-label={label} className={field} value="me" onChange={() => onChange({ relative: "me" })}>
        <option value="me">{t("view.config.meOption")}</option>
      </Select>
    );
  }
  if (property.kind === "checkbox") {
    return (
      <Select aria-label={label} className={field} value={String(value === true)} onChange={(e) => onChange(e.target.value === "true")}>
        <option value="true">{t("view.yes")}</option>
        <option value="false">{t("view.no")}</option>
      </Select>
    );
  }
  if (property.kind === "date") {
    if (between) {
      return (
        <>
          <DateInput label={t("view.config.valueFrom", { index })} value={asDate(range?.from)} t={t} onChange={(from) => onChange({ from, to: asDate(range?.to) })} />
          <DateInput label={t("view.config.valueTo", { index })} value={asDate(range?.to)} t={t} onChange={(to) => onChange({ from: asDate(range?.from), to })} />
        </>
      );
    }
    return <DateInput label={label} value={asDate(value)} t={t} onChange={onChange} />;
  }
  if (property.kind === "number") {
    const num = (v: unknown) => (typeof v === "number" ? v : 0);
    if (between) {
      return (
        <>
          <Input aria-label={t("view.config.valueFrom", { index })} type="number" className={field} value={num(range?.from)} onChange={(e) => onChange({ from: Number(e.target.value), to: num(range?.to) })} />
          <Input aria-label={t("view.config.valueTo", { index })} type="number" className={field} value={num(range?.to)} onChange={(e) => onChange({ from: num(range?.from), to: Number(e.target.value) })} />
        </>
      );
    }
    return <Input aria-label={label} type="number" className={field} value={num(value)} onChange={(e) => onChange(Number(e.target.value))} />;
  }
  if ((property.kind === "select" || property.kind === "multi_select") && property.choices?.length) {
    const many = op === "is_any_of" || op === "is_none_of" || op === "has_any" || op === "has_all" || op === "has_none";
    if (many) {
      const selected = Array.isArray(value) ? (value as string[]) : [];
      return (
        <Select
          aria-label={label}
          multiple
          size={Math.min(4, property.choices.length)}
          className="h-auto py-1 text-[12.5px]"
          value={selected}
          onChange={(e) => onChange([...e.target.selectedOptions].map((o) => o.value))}
        >
          {property.choices.map((choice) => (
            <option key={choice.key} value={choice.key}>{localized(choice.label, locale)}</option>
          ))}
        </Select>
      );
    }
    return (
      <Select aria-label={label} className={field} value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value)}>
        {property.choices.map((choice) => (
          <option key={choice.key} value={choice.key}>{localized(choice.label, locale)}</option>
        ))}
      </Select>
    );
  }
  return <Input aria-label={label} className={field} value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value)} />;
}
