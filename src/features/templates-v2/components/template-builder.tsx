"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox, Input, Label, Select, Textarea } from "@/components/ui/input";
import { fill, type TemplatesV2Text } from "@/features/templates-v2/messages";
import { createTemplateV2 } from "@/features/templates-v2/services/templates-v2.commands";
import { PAGE_VARIABLES, type DraftBlock, type DraftTask, type TemplateTypeKey } from "@/features/templates-v2/template";

type BuilderKind = TemplateTypeKey | "page";
const BLOCK_KINDS = ["heading", "paragraph", "todo"] as const;

/**
 * Staff write a project template (with tasks), a single-task template, or a
 * page template (U8): headings, text and to-dos in both languages, with
 * variable chips that put `{{program}}`, `{{owner}}`, `{{period}}` or
 * `{{due}}` where the cursor is, for people to fill in when they use it.
 */
export function TemplateBuilder({ text }: { text: TemplatesV2Text }) {
  const router = useRouter();
  const id = useId();
  const [typeKey, setTypeKey] = useState<BuilderKind>("project");
  const [tasks, setTasks] = useState<DraftTask[]>([{ en: "", fr: "", due: "" }]);
  const [blocks, setBlocks] = useState<DraftBlock[]>([{ kind: "heading", en: "", fr: "", due: "" }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The block text field last focused, so a chip knows where to insert. */
  const focused = useRef<{ index: number; lang: "en" | "fr"; element: HTMLInputElement } | null>(null);

  function insertVariable(name: string) {
    const target = focused.current;
    if (!target) return;
    const { element, index, lang } = target;
    const token = `{{${name}}}`;
    const value = blocks[index]?.[lang] ?? "";
    const at = element.selectionStart ?? value.length;
    const end = element.selectionEnd ?? at;
    const next = `${value.slice(0, at)}${token}${value.slice(end)}`;
    setBlocks((all) => all.map((b, i) => (i === index ? { ...b, [lang]: next } : b)));
    requestAnimationFrame(() => {
      element.focus();
      element.setSelectionRange(at + token.length, at + token.length);
    });
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const data = new FormData(e.currentTarget);
    const value = (name: string) => String(data.get(name) ?? "");
    setBusy(true);
    const result = await createTemplateV2({
      typeKey,
      name: { en: value("nameEn"), fr: value("nameFr") },
      description: { en: value("descriptionEn"), fr: value("descriptionFr") },
      title: { en: value("titleEn") || value("nameEn"), fr: value("titleFr") || value("nameFr") },
      duration: value("duration"),
      tasks: typeKey === "project" ? tasks : [],
      blocks: typeKey === "page" ? blocks : [],
      publish: data.get("publish") === "on",
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    router.push(`/templates-v2/${result.data?.id}`);
  }

  const kindLabel = (kind: DraftBlock["kind"]) => text.kindLabels[kind];

  return (
    <form onSubmit={handleSubmit} className="card space-y-5 p-5" noValidate>
      <fieldset>
        <legend className="mb-1.5 text-[13px] font-medium text-ink">{text.makes}</legend>
        <div className="flex flex-wrap gap-6 text-sm">
          {(["project", "task", "page"] as const).map((value) => (
            <label key={value} className="flex items-center gap-2">
              <input
                type="radio"
                name="typeKey"
                checked={typeKey === value}
                onChange={() => setTypeKey(value)}
                className="size-4 accent-(--color-brand)"
              />
              {value === "project" ? text.typeProject : value === "task" ? text.typeTask : text.typePage}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <Label htmlFor={`${id}-nameEn`}>{text.nameEn}</Label>
          <Input id={`${id}-nameEn`} name="nameEn" maxLength={200} lang="en" required />
        </div>
        <div>
          <Label htmlFor={`${id}-nameFr`}>{text.nameFr}</Label>
          <Input id={`${id}-nameFr`} name="nameFr" maxLength={200} lang="fr" required />
        </div>
        <div>
          <Label htmlFor={`${id}-descriptionEn`}>{text.descriptionEn}</Label>
          <Textarea id={`${id}-descriptionEn`} name="descriptionEn" maxLength={2000} lang="en" />
        </div>
        <div>
          <Label htmlFor={`${id}-descriptionFr`}>{text.descriptionFr}</Label>
          <Textarea id={`${id}-descriptionFr`} name="descriptionFr" maxLength={2000} lang="fr" />
        </div>
        {typeKey === "page" ? null : (
          <div>
            <Label htmlFor={`${id}-duration`}>{text.duration}</Label>
            <Input id={`${id}-duration`} name="duration" inputMode="numeric" pattern="[0-9]*" />
          </div>
        )}
      </div>
      {typeKey === "project" ? (
        <fieldset className="space-y-3">
          <legend className="text-[15px] font-semibold">{text.tasks}</legend>
          {tasks.map((task, index) => {
            const set = (change: Partial<DraftTask>) =>
              setTasks((all) => all.map((t, i) => (i === index ? { ...t, ...change } : t)));
            const n = index + 1;
            return (
              <div key={index} className="grid gap-3 border-b border-line pb-3 md:grid-cols-[2fr_2fr_1fr]">
                <div>
                  <Label htmlFor={`${id}-t${n}-en`}>{fill(text.taskN, { n })} · {text.titleEn}</Label>
                  <Input id={`${id}-t${n}-en`} value={task.en} onChange={(e) => set({ en: e.target.value })} lang="en" />
                </div>
                <div>
                  <Label htmlFor={`${id}-t${n}-fr`}>{fill(text.taskN, { n })} · {text.titleFr}</Label>
                  <Input id={`${id}-t${n}-fr`} value={task.fr} onChange={(e) => set({ fr: e.target.value })} lang="fr" />
                </div>
                <div>
                  <Label htmlFor={`${id}-t${n}-due`}>{fill(text.taskN, { n })} · {text.duration}</Label>
                  <Input id={`${id}-t${n}-due`} value={task.due} onChange={(e) => set({ due: e.target.value })} inputMode="numeric" />
                </div>
              </div>
            );
          })}
          <Button type="button" variant="secondary" size="sm" onClick={() => setTasks((all) => [...all, { en: "", fr: "", due: "" }])}>
            <Plus className="size-4" aria-hidden />
            {text.addTask}
          </Button>
        </fieldset>
      ) : null}
      {typeKey === "page" ? (
        <fieldset className="space-y-3">
          <legend className="text-[15px] font-semibold">{text.blocks}</legend>
          <div role="group" aria-labelledby={`${id}-chips`} className="space-y-1.5">
            <p id={`${id}-chips`} className="text-[13px] font-medium text-ink">
              {text.insertVariable}
            </p>
            <div className="flex flex-wrap gap-2">
              {PAGE_VARIABLES.map((name) => (
                <button
                  key={name}
                  type="button"
                  // Keep the text field's focus and caret: inserting needs both.
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => insertVariable(name)}
                  aria-label={fill(text.insertInto, { name: `{{${name}}}` })}
                  className="inline-flex h-7 items-center rounded-full border border-line bg-surface-soft px-2.5 font-mono text-[12px] text-ink hover:border-brand"
                >
                  {`{{${name}}}`}
                </button>
              ))}
            </div>
            <p className="text-[12.5px] text-muted">{text.insertVariableHint}</p>
          </div>
          {blocks.map((block, index) => {
            const set = (change: Partial<DraftBlock>) =>
              setBlocks((all) => all.map((b, i) => (i === index ? { ...b, ...change } : b)));
            const n = index + 1;
            return (
              <div key={index} className="grid gap-3 border-b border-line pb-3 md:grid-cols-[1fr_2fr_2fr_1fr]">
                <div>
                  <Label htmlFor={`${id}-b${n}-kind`}>{fill(text.blockN, { n })} · {text.blockKind}</Label>
                  <Select id={`${id}-b${n}-kind`} value={block.kind} onChange={(e) => set({ kind: e.target.value as DraftBlock["kind"] })}>
                    {BLOCK_KINDS.map((kind) => (
                      <option key={kind} value={kind}>
                        {kindLabel(kind)}
                      </option>
                    ))}
                  </Select>
                </div>
                <div>
                  <Label htmlFor={`${id}-b${n}-en`}>{fill(text.blockN, { n })} · {text.textEn}</Label>
                  <Input id={`${id}-b${n}-en`} value={block.en} onChange={(e) => set({ en: e.target.value })} onFocus={(e) => { focused.current = { index, lang: "en", element: e.currentTarget }; }} lang="en" />
                </div>
                <div>
                  <Label htmlFor={`${id}-b${n}-fr`}>{fill(text.blockN, { n })} · {text.textFr}</Label>
                  <Input id={`${id}-b${n}-fr`} value={block.fr} onChange={(e) => set({ fr: e.target.value })} onFocus={(e) => { focused.current = { index, lang: "fr", element: e.currentTarget }; }} lang="fr" />
                </div>
                <div>
                  <Label htmlFor={`${id}-b${n}-due`}>{fill(text.blockN, { n })} · {text.duration}</Label>
                  <Input id={`${id}-b${n}-due`} value={block.due} onChange={(e) => set({ due: e.target.value })} inputMode="numeric" />
                </div>
              </div>
            );
          })}
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => setBlocks((all) => [...all, { kind: "paragraph", en: "", fr: "", due: "" }])}
          >
            <Plus className="size-4" aria-hidden />
            {text.addBlock}
          </Button>
        </fieldset>
      ) : null}
      <label className="flex items-center gap-2 text-sm">
        <Checkbox name="publish" defaultChecked />
        {text.publishNow}
      </label>
      {error ? (
        <p role="alert" className="text-sm text-danger-fg">
          {error}
        </p>
      ) : null}
      <Button type="submit" loading={busy}>
        {text.save}
      </Button>
    </form>
  );
}
