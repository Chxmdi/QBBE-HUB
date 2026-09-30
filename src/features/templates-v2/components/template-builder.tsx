"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox, Input, Label, Textarea } from "@/components/ui/input";
import { fill, type TemplatesV2Text } from "@/features/templates-v2/messages";
import { createTemplateV2 } from "@/features/templates-v2/services/templates-v2.commands";
import type { DraftTask, TemplateTypeKey } from "@/features/templates-v2/template";

/** Staff write a project template (with tasks) or a single-task template. */
export function TemplateBuilder({ text }: { text: TemplatesV2Text }) {
  const router = useRouter();
  const id = useId();
  const [typeKey, setTypeKey] = useState<TemplateTypeKey>("project");
  const [tasks, setTasks] = useState<DraftTask[]>([{ en: "", fr: "", due: "" }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      publish: data.get("publish") === "on",
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    router.push(`/templates-v2/${result.data?.id}`);
  }

  return (
    <form onSubmit={handleSubmit} className="card space-y-5 p-5" noValidate>
      <fieldset>
        <legend className="mb-1.5 text-[13px] font-medium text-ink">{text.makes}</legend>
        <div className="flex flex-wrap gap-6 text-sm">
          {(["project", "task"] as const).map((value) => (
            <label key={value} className="flex items-center gap-2">
              <input
                type="radio"
                name="typeKey"
                checked={typeKey === value}
                onChange={() => setTypeKey(value)}
                className="size-4 accent-(--color-brand)"
              />
              {value === "project" ? text.typeProject : text.typeTask}
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
        <div>
          <Label htmlFor={`${id}-duration`}>{text.duration}</Label>
          <Input id={`${id}-duration`} name="duration" inputMode="numeric" pattern="[0-9]*" />
        </div>
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
