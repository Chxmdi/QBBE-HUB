"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import type { CatalogProperty, CatalogType } from "@/lib/query/catalog";
import type { LensValue } from "@/lib/query/run";
import { useLensT } from "@/features/lenses/i18n/client";
import { EDITABLE, type EditorKind } from "./editable";

export interface PersonOption {
  id: string;
  label: string;
}

/** The bulk-edit route's ceiling (BULK_EDIT_LIMIT); repeated here so the bar can say so before asking. */
export const BULK_LIMIT = 500;

export interface AppliedChange {
  property: string;
  /** The value as the table shows it (a person as id and label). */
  value: LensValue;
  /** The raw value sent to the action, for the record. */
  raw: string | null;
  ids: string[];
  changeSetId: string;
  changed: number;
}

interface Props {
  type: CatalogType;
  people: PersonOption[];
  locale: string;
  /** False while the wos_objects switch is off: the bar shows but cannot apply. */
  enabled: boolean;
  selectedIds: string[];
  onClear: () => void;
  onApplied: (change: AppliedChange) => void;
  onUndone: (changeSetId: string) => void;
}

type Status =
  | { kind: "idle" }
  | { kind: "working" }
  | { kind: "done"; changeSetId: string; changed: number; undone: boolean }
  | { kind: "error"; message: string };

/** Properties the bar can set: the table's editable ones, except the title. */
export function bulkProperties(type: CatalogType): CatalogProperty[] {
  const editable = (EDITABLE as Record<string, Record<string, EditorKind>>)[type.key] ?? {};
  return type.properties.filter((p) => p.key !== "title" && editable[p.key] && !p.filterOnly);
}

/**
 * Sets one property on every selected row through the action layer
 * (POST /api/objects/bulk-edit): one change set, undoable from the bar.
 * The action checks the viewer's right to edit every row, so a selection
 * that reaches past it is refused as a whole and nothing changes.
 */
export function BulkEditBar({ type, people, locale, enabled, selectedIds, onClear, onApplied, onUndone }: Props) {
  const t = useLensT();
  const properties = React.useMemo(() => bulkProperties(type), [type]);
  const editable = (EDITABLE as Record<string, Record<string, EditorKind>>)[type.key] ?? {};
  const startDraft = (p: CatalogProperty | undefined) => (p && editable[p.key] === "select" ? p.choices?.[0]?.key ?? "" : "");
  const [propertyKey, setPropertyKey] = React.useState(properties[0]?.key ?? "");
  const [draft, setDraft] = React.useState(() => startDraft(properties[0]));
  const [status, setStatus] = React.useState<Status>({ kind: "idle" });
  const property = properties.find((p) => p.key === propertyKey) ?? properties[0];
  const kind = property ? editable[property.key] : undefined;
  const count = selectedIds.length;
  const name = (p: CatalogProperty) => (locale.startsWith("fr") ? p.name.fr : p.name.en);

  if (!property || !kind) return null;
  if (count === 0 && status.kind !== "done") return null;

  const tooMany = count > BULK_LIMIT;
  const raw = draft.trim() === "" ? null : draft.trim();
  const canApply = enabled && !tooMany && count > 0 && status.kind !== "working" && (kind !== "select" || raw !== null);

  const apply = async () => {
    if (!canApply) return;
    setStatus({ kind: "working" });
    const ids = [...selectedIds];
    let response: Response;
    try {
      response = await fetch("/api/objects/bulk-edit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ objectIds: ids, objectType: type.key, property: property.key, value: raw }),
      });
    } catch {
      setStatus({ kind: "error", message: t("bulk.failed", { reason: t("common.loadFailed") }) });
      return;
    }
    const body = (await response.json().catch(() => null)) as { changeSetId?: string; changed?: number; error?: string; message?: string | null } | null;
    if (!response.ok || !body?.changeSetId) {
      const message =
        response.status === 403
          ? t("bulk.forbidden")
          : response.status === 404
            ? t("bulk.off")
            : t("bulk.failed", { reason: body?.message || body?.error || String(response.status) });
      setStatus({ kind: "error", message });
      return;
    }
    const changed = body.changed ?? 0;
    setStatus({ kind: "done", changeSetId: body.changeSetId, changed, undone: false });
    const person = kind === "person" ? people.find((p) => p.id === raw) : undefined;
    const value: LensValue = kind === "person" ? (person ? { id: person.id, label: person.label } : null) : raw;
    onApplied({ property: property.key, value, raw, ids, changeSetId: body.changeSetId, changed });
  };

  const undo = async (changeSetId: string) => {
    setStatus({ kind: "working" });
    let response: Response;
    try {
      response = await fetch(`/api/objects/change-sets/${encodeURIComponent(changeSetId)}/undo`, { method: "POST" });
    } catch {
      setStatus({ kind: "error", message: t("bulk.undoFailed", { reason: t("common.loadFailed") }) });
      return;
    }
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string; message?: string | null } | null;
      setStatus({ kind: "error", message: t("bulk.undoFailed", { reason: body?.message || body?.error || String(response.status) }) });
      return;
    }
    setStatus({ kind: "done", changeSetId, changed: 0, undone: true });
    onUndone(changeSetId);
  };

  const field = "h-8! w-auto! px-2! text-[13px]!";
  const valueLabel = t("bulk.value");

  return (
    <section
      role="region"
      aria-label={t("bulk.region")}
      className="mb-3 flex flex-wrap items-center gap-3 rounded-(--radius-md) border border-brand/30 bg-brand/5 px-3 py-2 text-[13px] text-ink"
    >
      <span className="font-semibold">{count === 1 ? t("bulk.selectedOne") : t("bulk.selected", { count })}</span>
      {count > 0 ? (
        <>
          <label className="flex items-center gap-1.5">
            {t("bulk.property")}
            <Select
              aria-label={t("bulk.property")}
              value={property.key}
              onChange={(e) => {
                // A fresh property starts from its first choice, or from "not set".
                setPropertyKey(e.target.value);
                setDraft(startDraft(properties.find((p) => p.key === e.target.value)));
              }}
              className={field}
            >
              {properties.map((p) => (
                <option key={p.key} value={p.key}>
                  {name(p)}
                </option>
              ))}
            </Select>
          </label>
          <label className="flex items-center gap-1.5">
            {valueLabel}
            {kind === "select" ? (
              <Select aria-label={valueLabel} value={draft} onChange={(e) => setDraft(e.target.value)} className={field}>
                {(property.choices ?? []).map((c) => (
                  <option key={c.key} value={c.key}>
                    {locale.startsWith("fr") ? c.label.fr : c.label.en}
                  </option>
                ))}
              </Select>
            ) : kind === "person" ? (
              <Select aria-label={valueLabel} value={draft} onChange={(e) => setDraft(e.target.value)} className={field}>
                <option value="">{t("common.notSet")}</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </Select>
            ) : (
              <Input
                aria-label={valueLabel}
                type={kind === "date" ? "date" : "text"}
                value={draft}
                maxLength={kind === "text" ? 300 : undefined}
                onChange={(e) => setDraft(e.target.value)}
                className={`${field} w-40!`}
              />
            )}
          </label>
          <Button type="button" size="sm" disabled={!canApply} loading={status.kind === "working"} onClick={() => void apply()}>
            {t("bulk.apply", { count })}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={onClear}>
            {t("bulk.clear")}
          </Button>
        </>
      ) : null}
      <p role="status" aria-live="polite" className="flex items-center gap-2 text-muted">
        {!enabled ? t("bulk.off") : null}
        {enabled && tooMany ? t("bulk.tooMany", { max: BULK_LIMIT }) : null}
        {status.kind === "working" ? t("bulk.working") : null}
        {status.kind === "error" ? <span className="text-danger-fg">{status.message}</span> : null}
        {status.kind === "done" && status.undone ? t("bulk.undone") : null}
        {status.kind === "done" && !status.undone ? (
          <>
            <span>{status.changed === 0 ? t("bulk.nothing") : status.changed === 1 ? t("bulk.appliedOne") : t("bulk.applied", { count: status.changed })}</span>
            {status.changed > 0 ? (
              <button type="button" onClick={() => void undo(status.changeSetId)} className="font-medium text-brand-fg underline-offset-2 hover:underline">
                {t("bulk.undo")}
              </button>
            ) : null}
          </>
        ) : null}
      </p>
    </section>
  );
}
