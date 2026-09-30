"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox, Input, Label, Select, Textarea } from "@/components/ui/input";
import type { FormsV2Text } from "@/features/forms-v2/messages";
import { localized, type FormV2Property } from "@/features/forms-v2/properties";
import { submitFormV2 } from "@/features/forms-v2/services/forms-v2.commands";

/** Answers a published form; the answer becomes a task or another record. */
export function FormV2Fill({
  formId,
  properties,
  text,
  locale,
}: {
  formId: string;
  properties: FormV2Property[];
  text: FormsV2Text;
  locale: string;
}) {
  const idBase = useId();
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState<{ objectType: string; objectId: string } | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const data = new FormData(e.currentTarget);
    const raw: Record<string, string | boolean> = {};
    for (const p of properties) {
      raw[p.key] = p.kind === "checkbox" ? data.get(p.key) === "on" : String(data.get(p.key) ?? "");
    }
    setSaving(true);
    const result = await submitFormV2(formId, raw);
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setCreated(result.data ?? null);
  }

  if (created) {
    return (
      <div role="status" className="card space-y-2 p-5">
        <p className="font-medium">{text.submitted}</p>
        {created.objectType === "task" ? (
          <p className="text-sm">
            {text.createdTask}{" "}
            <Link href={`/my-work?task=${created.objectId}`} className="text-brand-fg underline">
              {text.viewTask}
            </Link>
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="card space-y-4 p-5" noValidate>
      {properties.map((p) => {
        const id = `${idBase}-${p.key}`;
        const label = localized(p.label, locale);
        if (p.kind === "checkbox") {
          return (
            <label key={p.key} className="flex items-center gap-2 text-sm">
              <Checkbox id={id} name={p.key} required={p.required} />
              {label}
              {p.required ? <span aria-hidden> *</span> : null}
            </label>
          );
        }
        return (
          <div key={p.key}>
            <Label htmlFor={id}>
              {label}
              {p.required ? <span aria-hidden> *</span> : null}
            </Label>
            {p.kind === "select" ? (
              <Select id={id} name={p.key} required={p.required} defaultValue="">
                <option value="">—</option>
                {(p.options ?? []).map((o) => (
                  <option key={o.key} value={o.key}>
                    {localized(o.label, locale)}
                  </option>
                ))}
              </Select>
            ) : p.kind === "text" && p.key === "description" ? (
              <Textarea id={id} name={p.key} required={p.required} maxLength={5000} />
            ) : (
              <Input
                id={id}
                name={p.key}
                required={p.required}
                type={
                  p.kind === "date" ? "date" : p.kind === "email" ? "email" : p.kind === "url" ? "url" : "text"
                }
                inputMode={p.kind === "number" || p.kind === "currency" ? "decimal" : undefined}
                maxLength={p.kind === "text" ? 5000 : undefined}
              />
            )}
          </div>
        );
      })}
      {error ? (
        <p role="alert" className="text-sm text-danger-fg">
          {error}
        </p>
      ) : null}
      <Button type="submit" loading={saving}>
        {text.submit}
      </Button>
    </form>
  );
}
