"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { useLocale } from "@/lib/i18n/client";
import { fill } from "@/features/collab/i18n";
import {
  freshSectionId,
  hiddenProperties,
  move,
  type LayoutCatalog,
  type LayoutSection,
  type ObjectLayout,
  type SectionKind,
} from "../layout";
import { labelFor, layoutsText, type LayoutsText } from "../messages";
import { resetObjectLayout, saveObjectLayout } from "../services/layout.commands";

const KINDS: SectionKind[] = ["properties", "related", "content", "comments", "versions"];

/**
 * Arranges a type's page (V2-4). Every control is a button, field or list,
 * so the whole editor works by keyboard: sections and properties move with
 * "up" and "down" buttons rather than dragging.
 */
export function LayoutEditor({
  typeId,
  catalog,
  initial,
  saved,
  canEdit,
}: {
  typeId: string;
  catalog: LayoutCatalog;
  initial: ObjectLayout;
  saved: boolean;
  canEdit: boolean;
}) {
  const m = layoutsText(useLocale());
  const router = useRouter();
  const [layout, setLayout] = useState<ObjectLayout>(initial);
  const [addKind, setAddKind] = useState<SectionKind>("properties");
  const [busy, setBusy] = useState<"save" | "reset" | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const addId = useId();

  const setSections = (sections: LayoutSection[]) => setLayout({ ...layout, sections });
  const update = (index: number, section: LayoutSection) =>
    setSections(layout.sections.map((current, i) => (i === index ? section : current)));
  const hidden = hiddenProperties(layout, catalog);

  function addSection() {
    const base = addKind === "related" ? `related-${catalog.relations[0] ?? "list"}` : addKind;
    const id = freshSectionId(layout, base);
    const section: LayoutSection =
      addKind === "properties"
        ? { id, kind: "properties", properties: [] }
        : addKind === "related"
          ? { id, kind: "related", relation: catalog.relations[0] ?? "project", limit: 10 }
          : { id, kind: addKind };
    setSections([...layout.sections, section]);
  }

  const sectionName = (section: LayoutSection) =>
    section.kind === "related"
      ? `${m.kinds.related}: ${labelFor(m.relations as Record<string, string>, section.relation)}`
      : m.kinds[section.kind];

  return (
    <div>
      {!canEdit ? <p className="meta mb-4">{m.editor.readOnly}</p> : null}
      {message ? (
        <p role={message.ok ? "status" : "alert"} className={message.ok ? "meta mb-3" : "mb-3 text-sm text-danger-fg"}>
          {message.text}
        </p>
      ) : null}

      <h2 className="section-heading mb-2">{m.editor.sections}</h2>
      <ol className="space-y-3">
        {layout.sections.map((section, index) => (
          <li key={section.id} className="card p-4">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-[14px] font-semibold">{sectionName(section)}</h3>
              {canEdit ? (
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={index === 0}
                    aria-label={fill(m.editor.moveUp, { name: sectionName(section) })}
                    onClick={() => setSections(move(layout.sections, index, -1))}
                  >
                    ↑
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={index === layout.sections.length - 1}
                    aria-label={fill(m.editor.moveDown, { name: sectionName(section) })}
                    onClick={() => setSections(move(layout.sections, index, 1))}
                  >
                    ↓
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={fill(m.editor.remove, { name: sectionName(section) })}
                    onClick={() => setSections(layout.sections.filter((_, i) => i !== index))}
                  >
                    ✕
                  </Button>
                </div>
              ) : null}
            </div>
            <SectionFields
              section={section}
              catalog={catalog}
              hidden={hidden}
              canEdit={canEdit}
              m={m}
              onChange={(next) => update(index, next)}
            />
          </li>
        ))}
      </ol>

      <p className="meta mt-3">
        {hidden.length === 0
          ? m.editor.noneHidden
          : fill(m.editor.hidden, {
              list: hidden.map((key) => labelFor(m.properties as Record<string, string>, key)).join(", "),
            })}
      </p>

      {canEdit ? (
        <>
          <div className="mt-4 flex flex-wrap items-end gap-2">
            <div>
              <label htmlFor={addId} className="text-[13px] font-medium">
                {m.editor.addKind}
              </label>
              <Select id={addId} value={addKind} onChange={(event) => setAddKind(event.target.value as SectionKind)}>
                {KINDS.filter((kind) => kind !== "related" || catalog.relations.length > 0).map((kind) => (
                  <option key={kind} value={kind}>
                    {m.kinds[kind]}
                  </option>
                ))}
              </Select>
            </div>
            <Button variant="secondary" onClick={addSection}>
              {m.editor.addSection}
            </Button>
          </div>
          <div className="mt-6 flex flex-wrap gap-2">
            <Button
              loading={busy === "save"}
              onClick={async () => {
                setBusy("save");
                setMessage(null);
                const result = await saveObjectLayout({ typeId, layout });
                setBusy(null);
                setMessage(result.ok ? { ok: true, text: m.editor.saved } : { ok: false, text: result.error ?? m.errors.failed });
                if (result.ok) router.refresh();
              }}
            >
              {m.editor.save}
            </Button>
            {saved ? (
              <Button
                variant="ghost"
                loading={busy === "reset"}
                onClick={async () => {
                  if (!window.confirm(m.editor.confirmReset)) return;
                  setBusy("reset");
                  const result = await resetObjectLayout(typeId);
                  setBusy(null);
                  setMessage(result.ok ? { ok: true, text: m.editor.wasReset } : { ok: false, text: result.error ?? m.errors.failed });
                  if (result.ok) router.refresh();
                }}
              >
                {m.editor.reset}
              </Button>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}

function SectionFields({
  section,
  catalog,
  hidden,
  canEdit,
  m,
  onChange,
}: {
  section: LayoutSection;
  catalog: LayoutCatalog;
  hidden: string[];
  canEdit: boolean;
  m: LayoutsText;
  onChange: (section: LayoutSection) => void;
}) {
  const ids = useId();
  const propertyName = (key: string) => labelFor(m.properties as Record<string, string>, key);
  const titles = (
    <div className="mb-3 grid gap-2 sm:grid-cols-2">
      <div>
        <label htmlFor={`${ids}-en`} className="text-[13px] font-medium">
          {m.editor.titleEn}
        </label>
        <Input
          id={`${ids}-en`}
          value={section.title?.en ?? ""}
          maxLength={80}
          disabled={!canEdit}
          onChange={(event) => onChange({ ...section, title: { en: event.target.value, fr: section.title?.fr ?? "" } })}
        />
      </div>
      <div>
        <label htmlFor={`${ids}-fr`} className="text-[13px] font-medium">
          {m.editor.titleFr}
        </label>
        <Input
          id={`${ids}-fr`}
          value={section.title?.fr ?? ""}
          maxLength={80}
          disabled={!canEdit}
          onChange={(event) => onChange({ ...section, title: { en: section.title?.en ?? "", fr: event.target.value } })}
        />
      </div>
    </div>
  );

  if (section.kind === "properties") {
    return (
      <>
        {titles}
        <ol className="space-y-1">
          {section.properties.map((key, index) => (
            <li key={key} className="flex items-center justify-between gap-2 rounded-(--radius-sm) bg-surface-soft px-3 py-1.5 text-[13.5px]">
              <span>{propertyName(key)}</span>
              {canEdit ? (
                <span className="flex gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={index === 0}
                    aria-label={fill(m.editor.moveUp, { name: propertyName(key) })}
                    onClick={() => onChange({ ...section, properties: move(section.properties, index, -1) })}
                  >
                    ↑
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={index === section.properties.length - 1}
                    aria-label={fill(m.editor.moveDown, { name: propertyName(key) })}
                    onClick={() => onChange({ ...section, properties: move(section.properties, index, 1) })}
                  >
                    ↓
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={fill(m.editor.remove, { name: propertyName(key) })}
                    onClick={() => onChange({ ...section, properties: section.properties.filter((p) => p !== key) })}
                  >
                    ✕
                  </Button>
                </span>
              ) : null}
            </li>
          ))}
        </ol>
        {canEdit && hidden.length > 0 ? (
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <div>
              <label htmlFor={`${ids}-show`} className="text-[13px] font-medium">
                {m.editor.show}
              </label>
              <Select
                id={`${ids}-show`}
                value=""
                onChange={(event) => {
                  if (event.target.value) onChange({ ...section, properties: [...section.properties, event.target.value] });
                }}
              >
                <option value="">—</option>
                {hidden.map((key) => (
                  <option key={key} value={key}>
                    {propertyName(key)}
                  </option>
                ))}
              </Select>
            </div>
          </div>
        ) : null}
      </>
    );
  }

  if (section.kind === "related") {
    return (
      <>
        {titles}
        <div className="flex flex-wrap gap-2">
          <div>
            <label htmlFor={`${ids}-relation`} className="text-[13px] font-medium">
              {m.editor.relation}
            </label>
            <Select
              id={`${ids}-relation`}
              value={section.relation}
              disabled={!canEdit}
              onChange={(event) => onChange({ ...section, relation: event.target.value })}
            >
              {catalog.relations.map((relation) => (
                <option key={relation} value={relation}>
                  {labelFor(m.relations as Record<string, string>, relation)}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <label htmlFor={`${ids}-limit`} className="text-[13px] font-medium">
              {m.editor.limit}
            </label>
            <Input
              id={`${ids}-limit`}
              type="number"
              min={1}
              max={50}
              value={section.limit}
              disabled={!canEdit}
              onChange={(event) =>
                onChange({ ...section, limit: Math.min(50, Math.max(1, Number(event.target.value) || 1)) })
              }
            />
          </div>
        </div>
      </>
    );
  }

  return titles;
}
