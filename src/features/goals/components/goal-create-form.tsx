"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { createGoal } from "../services/goal.commands";
import { useGoalsT } from "./use-goals-t";

type Option = { id: string; name: string };

export function GoalCreateForm({ programs, people }: { programs: Option[]; people: Option[] }) {
  const t = useGoalsT();
  const router = useRouter();
  const id = useId();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true);
    setError(null);
    const result = await createGoal({
      title: String(form.get("title") ?? ""),
      description: String(form.get("description") ?? ""),
      programId: String(form.get("programId") ?? ""),
      ownerId: String(form.get("ownerId") ?? ""),
      targetOn: String(form.get("targetOn") ?? ""),
    });
    setSaving(false);
    if (!result.ok || !result.id) return setError(result.error ?? t("create.error"));
    router.push(`/goals/${result.id}`);
  }

  const f = (name: string) => `${id}-${name}`;
  return (
    <form onSubmit={submit} className="card grid gap-3 p-4 sm:grid-cols-2" aria-labelledby={f("heading")}>
      <h2 id={f("heading")} className="section-heading sm:col-span-2">{t("create.heading")}</h2>
      <div className="sm:col-span-2">
        <Label htmlFor={f("title")}>{t("create.titleLabel")}</Label>
        <Input id={f("title")} name="title" required maxLength={200} />
      </div>
      <div className="sm:col-span-2">
        <Label htmlFor={f("description")}>{t("create.descriptionLabel")}</Label>
        <Textarea id={f("description")} name="description" maxLength={4000} rows={2} />
      </div>
      <div>
        <Label htmlFor={f("program")}>{t("create.programLabel")}</Label>
        <Select id={f("program")} name="programId" defaultValue="">
          <option value="">{t("create.programNone")}</option>
          {programs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
      </div>
      <div>
        <Label htmlFor={f("owner")}>{t("create.ownerLabel")}</Label>
        <Select id={f("owner")} name="ownerId" defaultValue="">
          <option value="">{t("create.ownerNone")}</option>
          {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
      </div>
      <div>
        <Label htmlFor={f("target")}>{t("create.targetLabel")}</Label>
        <Input id={f("target")} name="targetOn" type="date" />
      </div>
      <div className="flex flex-wrap items-end justify-end gap-3">
        {error ? <span role="alert" className="text-[12.5px] text-danger-fg">{error}</span> : null}
        <Button type="submit" loading={saving}>{t("create.submit")}</Button>
      </div>
    </form>
  );
}
