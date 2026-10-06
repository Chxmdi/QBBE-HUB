"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { Eye, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox, FieldHint, Input, Label, Select, Textarea } from "@/components/ui/input";
import { FormV2Fill } from "@/features/forms-v2/components/form-v2-fill";
import type { FormsV2Text } from "@/features/forms-v2/messages";
import { fill } from "@/features/forms-v2/messages";
import {
  FORM_PROPERTY_KINDS,
  SHOW_IF_OPS,
  TASK_FORM_PROPERTIES,
  keyFromLabel,
  optionsFromLists,
  type FormOption,
  type FormPropertyKind,
  type FormV2Property,
  type ShowIf,
  type ShowIfOp,
  typedAnswers,
} from "@/features/forms-v2/properties";
import { createFormV2 } from "@/features/forms-v2/services/forms-v2.commands";

/** A condition as edited: which earlier question (by its id), how, and the typed value. */
interface ShowIfDraft {
  ref: string;
  op: ShowIfOp;
  value: string;
}

const ALWAYS: ShowIfDraft = { ref: "", op: "eq", value: "" };

interface CustomQuestion {
  id: number;
  en: string;
  fr: string;
  kind: FormPropertyKind;
  required: boolean;
  optionsEn: string;
  optionsFr: string;
  showIf: ShowIfDraft;
}

interface TaskChoice {
  ask: boolean;
  required: boolean;
  en: string;
  fr: string;
  showIf: ShowIfDraft;
}

/** An earlier question a condition may depend on. */
interface Candidate {
  id: string;
  label: string;
  kind: FormPropertyKind;
  options: FormOption[];
}

/** The conditions that make sense for the kind of the question depended on. */
function opsFor(kind: FormPropertyKind): readonly ShowIfOp[] {
  if (kind === "file") return ["is_not_empty", "is_empty"];
  if (kind === "checkbox") return ["eq"];
  if (kind === "select") return ["eq", "neq", "is_not_empty", "is_empty"];
  return SHOW_IF_OPS;
}

function needsValue(op: ShowIfOp): boolean {
  return op !== "is_empty" && op !== "is_not_empty";
}

/**
 * The stored condition for a draft, or undefined when the question is always
 * asked. A condition whose question was removed is kept as a broken one
 * (empty key), so saving refuses it instead of quietly asking everyone.
 * Numbers are stored as numbers and amounts in whole cents, as answers are.
 */
function toShowIf(draft: ShowIfDraft, candidates: Candidate[], keyOf: (id: string) => string | undefined): ShowIf | undefined {
  if (!draft.ref) return undefined;
  const ref = candidates.find((c) => c.id === draft.ref);
  const key = ref && keyOf(ref.id);
  if (!ref || !key) return { key: "", op: draft.op };
  const op = opsFor(ref.kind).includes(draft.op) ? draft.op : opsFor(ref.kind)[0];
  if (!needsValue(op)) return { key, op };
  if (ref.kind === "checkbox") return { key, op, value: draft.value !== "false" };
  const typed = typedAnswers([{ key: "v", kind: ref.kind, required: false, label: { en: "v", fr: "v" } }], { v: draft.value });
  const value = typed.v;
  if (op !== "contains" && typeof value === "number") return { key, op, value };
  return { key, op, value: draft.value.trim() };
}

/** Whether a draft names a question that no longer comes before it. */
function isBroken(draft: ShowIfDraft, candidates: Candidate[]): boolean {
  return Boolean(draft.ref) && !candidates.some((c) => c.id === draft.ref);
}

function ShowIfEditor({
  idPrefix,
  text,
  candidates,
  value,
  onChange,
}: {
  idPrefix: string;
  text: FormsV2Text;
  candidates: Candidate[];
  value: ShowIfDraft;
  onChange: (next: ShowIfDraft) => void;
}) {
  const ref = candidates.find((c) => c.id === value.ref);
  const ops = ref ? opsFor(ref.kind) : SHOW_IF_OPS;
  const op = ref && ops.includes(value.op) ? value.op : ops[0];
  return (
    <div className="grid gap-3 md:grid-cols-3">
      {isBroken(value, candidates) ? (
        <p role="alert" className="text-sm text-danger-fg md:col-span-3">
          {text.errors.badCondition}
        </p>
      ) : null}
      <div>
        <Label htmlFor={`${idPrefix}-ref`}>{text.showIf}</Label>
        <Select
          id={`${idPrefix}-ref`}
          value={ref ? ref.id : ""}
          onChange={(e) => {
            const next = candidates.find((c) => c.id === e.target.value);
            onChange(next ? { ref: next.id, op: opsFor(next.kind)[0], value: next.kind === "checkbox" ? "true" : "" } : ALWAYS);
          }}
        >
          <option value="">{text.showIfAlways}</option>
          {candidates.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </Select>
      </div>
      {ref ? (
        <div>
          <Label htmlFor={`${idPrefix}-op`}>{text.showIfOp}</Label>
          <Select id={`${idPrefix}-op`} value={op} onChange={(e) => onChange({ ...value, op: e.target.value as ShowIfOp })}>
            {ops.map((candidate) => (
              <option key={candidate} value={candidate}>
                {text.ops[candidate]}
              </option>
            ))}
          </Select>
        </div>
      ) : null}
      {ref && needsValue(op) ? (
        <div>
          <Label htmlFor={`${idPrefix}-value`}>{text.showIfValue}</Label>
          {ref.kind === "checkbox" ? (
            <Select id={`${idPrefix}-value`} value={value.value === "false" ? "false" : "true"} onChange={(e) => onChange({ ...value, value: e.target.value })}>
              <option value="true">{text.showIfTicked}</option>
              <option value="false">{text.showIfUnticked}</option>
            </Select>
          ) : ref.kind === "select" && op !== "contains" ? (
            <Select id={`${idPrefix}-value`} value={value.value} onChange={(e) => onChange({ ...value, value: e.target.value })}>
              <option value="">—</option>
              {ref.options.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.label.en}
                </option>
              ))}
            </Select>
          ) : (
            <Input
              id={`${idPrefix}-value`}
              value={value.value}
              maxLength={200}
              inputMode={ref.kind === "number" || ref.kind === "currency" ? "decimal" : undefined}
              onChange={(e) => onChange({ ...value, value: e.target.value })}
            />
          )}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Builds a draft form. A task form picks from the task's own properties; any
 * other type gets free questions, each with English and French wording. Any
 * question can depend on an earlier one, and the preview shows the form as
 * it will be answered, without sending anything.
 */
export function FormV2Builder({
  text,
  locale,
  projects,
}: {
  text: FormsV2Text;
  locale: string;
  projects: { id: string; name: string }[];
}) {
  const router = useRouter();
  const idBase = useId();
  const [creates, setCreates] = useState<"task" | "custom">("task");
  const [typeKey, setTypeKey] = useState("");
  const [taskChoices, setTaskChoices] = useState<Record<string, TaskChoice>>(() =>
    Object.fromEntries(
      TASK_FORM_PROPERTIES.map((p) => [
        p.key,
        {
          ask: p.key === "title" || p.key === "description",
          required: p.required,
          en: p.label.en,
          fr: p.label.fr,
          showIf: ALWAYS,
        },
      ]),
    ),
  );
  const [questions, setQuestions] = useState<CustomQuestion[]>([
    { id: 1, en: "", fr: "", kind: "text", required: true, optionsEn: "", optionsFr: "", showIf: ALWAYS },
  ]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState(false);

  function updateQuestion(id: number, change: Partial<CustomQuestion>) {
    setQuestions((qs) => qs.map((q) => (q.id === id ? { ...q, ...change } : q)));
  }

  /** The keys the custom questions will be saved with, by question id. */
  function customKeys(): Map<number, string> {
    const taken = new Set<string>();
    const keys = new Map<number, string>();
    for (const q of questions) {
      const key = keyFromLabel(q.en, taken);
      taken.add(key);
      keys.set(q.id, key);
    }
    return keys;
  }

  function taskCandidates(before: string): Candidate[] {
    const out: Candidate[] = [];
    for (const p of TASK_FORM_PROPERTIES) {
      if (p.key === before) break;
      if (taskChoices[p.key].ask) {
        out.push({ id: p.key, label: taskChoices[p.key].en || p.label.en, kind: p.kind, options: p.options ?? [] });
      }
    }
    return out;
  }

  function customCandidates(beforeIndex: number): Candidate[] {
    return questions.slice(0, beforeIndex).map((q, i) => ({
      id: String(q.id),
      label: q.en.trim() || `${i + 1}`,
      kind: q.kind,
      options: q.kind === "select" ? optionsFromLists(q.optionsEn, q.optionsFr) : [],
    }));
  }

  function properties(): FormV2Property[] {
    if (creates === "task") {
      return TASK_FORM_PROPERTIES.filter((p) => taskChoices[p.key].ask).map((p) => {
        const showIf = p.key === "title" ? undefined : toShowIf(taskChoices[p.key].showIf, taskCandidates(p.key), (id) => id);
        return {
          ...p,
          required: p.key === "title" ? true : taskChoices[p.key].required,
          label: { en: taskChoices[p.key].en, fr: taskChoices[p.key].fr },
          ...(showIf ? { showIf } : {}),
        };
      });
    }
    const keys = customKeys();
    return questions.map((q, index) => {
      const showIf = toShowIf(q.showIf, customCandidates(index), (id) => keys.get(Number(id)));
      return {
        key: keys.get(q.id) ?? "field",
        kind: q.kind,
        required: q.required,
        label: { en: q.en.trim(), fr: q.fr.trim() },
        ...(q.kind === "select" ? { options: optionsFromLists(q.optionsEn, q.optionsFr) } : {}),
        ...(showIf ? { showIf } : {}),
      };
    });
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const data = new FormData(e.currentTarget);
    const value = (name: string) => String(data.get(name) ?? "").trim();
    setSaving(true);
    const result = await createFormV2({
      typeKey: creates === "task" ? "task" : typeKey.trim(),
      targetProjectId: creates === "task" && value("project") ? value("project") : null,
      title: { en: value("titleEn"), fr: value("titleFr") },
      description: { en: value("descriptionEn"), fr: value("descriptionFr") },
      audience: value("audience") === "staff" ? "staff" : "members",
      properties: properties() as never,
    });
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    router.push(`/forms-v2/${result.data?.id}`);
  }

  const field = (name: string) => `${idBase}-${name}`;

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button type="button" variant="secondary" size="sm" aria-pressed={preview} onClick={() => setPreview((p) => !p)}>
          {preview ? <Pencil className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
          {preview ? text.previewOff : text.preview}
        </Button>
      </div>

      {preview ? (
        <section aria-label={text.preview}>
          <FormV2Fill formId="preview" properties={properties()} text={text} locale={locale} preview />
        </section>
      ) : null}

      {/* Hidden, not unmounted, while previewing: the typed titles live in the fields. */}
      <form onSubmit={handleSubmit} className="space-y-8" noValidate hidden={preview}>
      <fieldset className="card space-y-4 p-5">
        <legend className="px-1 text-[15px] font-semibold">{text.sectionBasics}</legend>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <Label htmlFor={field("titleEn")}>{text.titleEn}</Label>
            <Input id={field("titleEn")} name="titleEn" required maxLength={200} lang="en" />
          </div>
          <div>
            <Label htmlFor={field("titleFr")}>{text.titleFr}</Label>
            <Input id={field("titleFr")} name="titleFr" required maxLength={200} lang="fr" />
          </div>
          <div>
            <Label htmlFor={field("descriptionEn")}>{text.descriptionEn}</Label>
            <Textarea id={field("descriptionEn")} name="descriptionEn" maxLength={2000} lang="en" />
          </div>
          <div>
            <Label htmlFor={field("descriptionFr")}>{text.descriptionFr}</Label>
            <Textarea id={field("descriptionFr")} name="descriptionFr" maxLength={2000} lang="fr" />
          </div>
          <div>
            <Label htmlFor={field("audience")}>{text.audience}</Label>
            <Select id={field("audience")} name="audience" defaultValue="members">
              <option value="members">{text.audienceMembers}</option>
              <option value="staff">{text.audienceStaff}</option>
            </Select>
          </div>
        </div>
      </fieldset>

      <fieldset className="card space-y-4 p-5">
        <legend className="px-1 text-[15px] font-semibold">{text.creates}</legend>
        <div className="flex flex-wrap gap-6">
          {(["task", "custom"] as const).map((option) => (
            <label key={option} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="creates"
                value={option}
                checked={creates === option}
                onChange={() => setCreates(option)}
                className="size-4 accent-(--color-brand)"
              />
              {option === "task" ? text.createsTask : text.createsCustom}
            </label>
          ))}
        </div>
        {creates === "task" ? (
          <div className="max-w-md">
            <Label htmlFor={field("project")}>{text.project}</Label>
            <Select id={field("project")} name="project" defaultValue="">
              <option value="">{text.noProject}</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </div>
        ) : (
          <div className="max-w-md">
            <Label htmlFor={field("typeKey")}>{text.typeKey}</Label>
            <Input
              id={field("typeKey")}
              value={typeKey}
              onChange={(e) => setTypeKey(e.target.value)}
              aria-describedby={field("typeKeyHint")}
              pattern="[a-z][a-z0-9_]{0,39}"
            />
            <p id={field("typeKeyHint")} className="mt-1 text-[12.5px] text-muted">
              {text.typeKeyHint}
            </p>
          </div>
        )}
      </fieldset>

      <fieldset className="card space-y-4 p-5">
        <legend className="px-1 text-[15px] font-semibold">{text.sectionQuestions}</legend>
        {creates === "task" ? (
          <ul className="space-y-4">
            {TASK_FORM_PROPERTIES.map((p) => {
              const choice = taskChoices[p.key];
              const set = (change: Partial<TaskChoice>) =>
                setTaskChoices((c) => ({ ...c, [p.key]: { ...c[p.key], ...change } }));
              return (
                <li key={p.key} className="space-y-2 border-b border-line pb-4 last:border-b-0">
                  <div className="flex flex-wrap items-center gap-6 text-sm">
                    <label className="flex items-center gap-2 font-medium">
                      <Checkbox
                        checked={choice.ask}
                        disabled={p.key === "title"}
                        onChange={(e) => set({ ask: e.target.checked })}
                      />
                      {text.askThis}: {p.label.en} / {p.label.fr}
                    </label>
                    {p.key !== "title" && choice.ask ? (
                      <label className="flex items-center gap-2">
                        <Checkbox checked={choice.required} onChange={(e) => set({ required: e.target.checked })} />
                        {text.required}
                      </label>
                    ) : null}
                  </div>
                  {choice.ask ? (
                    <div className="space-y-3">
                      <div className="grid gap-3 md:grid-cols-2">
                        <div>
                          <Label htmlFor={field(`task-${p.key}-en`)}>{text.labelEn}</Label>
                          <Input id={field(`task-${p.key}-en`)} value={choice.en} onChange={(e) => set({ en: e.target.value })} lang="en" />
                        </div>
                        <div>
                          <Label htmlFor={field(`task-${p.key}-fr`)}>{text.labelFr}</Label>
                          <Input id={field(`task-${p.key}-fr`)} value={choice.fr} onChange={(e) => set({ fr: e.target.value })} lang="fr" />
                        </div>
                      </div>
                      {p.key !== "title" ? (
                        <ShowIfEditor
                          idPrefix={field(`task-${p.key}-showif`)}
                          text={text}
                          candidates={taskCandidates(p.key)}
                          value={choice.showIf}
                          onChange={(showIf) => set({ showIf })}
                        />
                      ) : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <ol className="space-y-4">
            {questions.map((q, index) => (
              <li key={q.id} className="space-y-3 border-b border-line pb-4 last:border-b-0">
                <div className="grid gap-3 md:grid-cols-2">
                  <div>
                    <Label htmlFor={field(`q${q.id}-en`)}>{text.labelEn}</Label>
                    <Input id={field(`q${q.id}-en`)} value={q.en} onChange={(e) => updateQuestion(q.id, { en: e.target.value })} lang="en" />
                  </div>
                  <div>
                    <Label htmlFor={field(`q${q.id}-fr`)}>{text.labelFr}</Label>
                    <Input id={field(`q${q.id}-fr`)} value={q.fr} onChange={(e) => updateQuestion(q.id, { fr: e.target.value })} lang="fr" />
                  </div>
                  <div>
                    <Label htmlFor={field(`q${q.id}-kind`)}>{text.kind}</Label>
                    <Select
                      id={field(`q${q.id}-kind`)}
                      value={q.kind}
                      onChange={(e) => updateQuestion(q.id, { kind: e.target.value as FormPropertyKind })}
                    >
                      {FORM_PROPERTY_KINDS.map((kind) => (
                        <option key={kind} value={kind}>
                          {text.kinds[kind]}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <label className="flex items-center gap-2 self-end pb-2 text-sm">
                    <Checkbox checked={q.required} onChange={(e) => updateQuestion(q.id, { required: e.target.checked })} />
                    {text.required}
                  </label>
                  {q.kind === "select" ? (
                    <>
                      <div>
                        <Label htmlFor={field(`q${q.id}-oen`)}>{text.optionsEn}</Label>
                        <Input id={field(`q${q.id}-oen`)} value={q.optionsEn} onChange={(e) => updateQuestion(q.id, { optionsEn: e.target.value })} lang="en" />
                      </div>
                      <div>
                        <Label htmlFor={field(`q${q.id}-ofr`)}>{text.optionsFr}</Label>
                        <Input id={field(`q${q.id}-ofr`)} value={q.optionsFr} onChange={(e) => updateQuestion(q.id, { optionsFr: e.target.value })} lang="fr" />
                      </div>
                    </>
                  ) : null}
                </div>
                {index > 0 ? (
                  <ShowIfEditor
                    idPrefix={field(`q${q.id}-showif`)}
                    text={text}
                    candidates={customCandidates(index)}
                    value={q.showIf}
                    onChange={(showIf) => updateQuestion(q.id, { showIf })}
                  />
                ) : null}
                {questions.length > 1 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setQuestions((qs) => qs.filter((x) => x.id !== q.id))}
                  >
                    <Trash2 className="size-4" aria-hidden />
                    {fill(text.removeQuestion, { n: index + 1 })}
                  </Button>
                ) : null}
              </li>
            ))}
            <li>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() =>
                  setQuestions((qs) => [
                    ...qs,
                    {
                      id: Math.max(0, ...qs.map((x) => x.id)) + 1,
                      en: "",
                      fr: "",
                      kind: "text",
                      required: false,
                      optionsEn: "",
                      optionsFr: "",
                      showIf: ALWAYS,
                    },
                  ])
                }
              >
                <Plus className="size-4" aria-hidden />
                {text.addQuestion}
              </Button>
            </li>
          </ol>
        )}
      </fieldset>

      {error ? (
        <p role="alert" className="text-sm text-danger-fg">
          {error}
        </p>
      ) : null}
      <FieldHint>{text.builderDescription}</FieldHint>
      <Button type="submit" loading={saving}>
        {text.saveDraft}
      </Button>
      </form>
    </div>
  );
}
