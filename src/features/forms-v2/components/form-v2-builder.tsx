"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox, FieldHint, Input, Label, Select, Textarea } from "@/components/ui/input";
import type { FormsV2Text } from "@/features/forms-v2/messages";
import { fill } from "@/features/forms-v2/messages";
import {
  FORM_PROPERTY_KINDS,
  TASK_FORM_PROPERTIES,
  keyFromLabel,
  optionsFromLists,
  type FormPropertyKind,
  type FormV2Property,
} from "@/features/forms-v2/properties";
import { createFormV2 } from "@/features/forms-v2/services/forms-v2.commands";

interface CustomQuestion {
  id: number;
  en: string;
  fr: string;
  kind: FormPropertyKind;
  required: boolean;
  optionsEn: string;
  optionsFr: string;
}

interface TaskChoice {
  ask: boolean;
  required: boolean;
  en: string;
  fr: string;
}

/**
 * Builds a draft form. A task form picks from the task's own properties; any
 * other type gets free questions, each with English and French wording.
 */
export function FormV2Builder({
  text,
  projects,
}: {
  text: FormsV2Text;
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
        { ask: p.key === "title" || p.key === "description", required: p.required, en: p.label.en, fr: p.label.fr },
      ]),
    ),
  );
  const [questions, setQuestions] = useState<CustomQuestion[]>([
    { id: 1, en: "", fr: "", kind: "text", required: true, optionsEn: "", optionsFr: "" },
  ]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function updateQuestion(id: number, change: Partial<CustomQuestion>) {
    setQuestions((qs) => qs.map((q) => (q.id === id ? { ...q, ...change } : q)));
  }

  function properties(): FormV2Property[] {
    if (creates === "task") {
      return TASK_FORM_PROPERTIES.filter((p) => taskChoices[p.key].ask).map((p) => ({
        ...p,
        required: p.key === "title" ? true : taskChoices[p.key].required,
        label: { en: taskChoices[p.key].en, fr: taskChoices[p.key].fr },
      }));
    }
    const taken = new Set<string>();
    return questions.map((q) => {
      const key = keyFromLabel(q.en, taken);
      taken.add(key);
      return {
        key,
        kind: q.kind,
        required: q.required,
        label: { en: q.en.trim(), fr: q.fr.trim() },
        ...(q.kind === "select" ? { options: optionsFromLists(q.optionsEn, q.optionsFr) } : {}),
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
    <form onSubmit={handleSubmit} className="space-y-8" noValidate>
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
                    { id: Math.max(0, ...qs.map((x) => x.id)) + 1, en: "", fr: "", kind: "text", required: false, optionsEn: "", optionsFr: "" },
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
  );
}
