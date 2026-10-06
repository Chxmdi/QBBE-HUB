"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox, FieldHint, Input, Label, Select, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import {
  FIELD_TYPES,
  FIELD_TYPE_KEYS,
  MAX_FIELDS,
  parseOptions,
  type FieldType,
  type FormField,
} from "@/features/forms/fields";
import { createForm, updateDraftForm } from "@/features/forms/services/form.commands";
import { useT } from "@/lib/i18n/client";

interface DraftField {
  id: string;
  label: string;
  type: FieldType;
  required: boolean;
  optionsText: string;
  help: string;
}

export interface FormBuilderInitial {
  id: string;
  title: string;
  description: string | null;
  audience: "members" | "staff";
  requiresSignature: boolean;
  fields: FormField[];
}

function blankField(): DraftField {
  return { id: crypto.randomUUID(), label: "", type: "text", required: false, optionsText: "", help: "" };
}

/**
 * Admins lay out a form: a title, who it is for, whether it must be signed,
 * and its questions in order. Saved as a draft; publishing freezes it.
 */
export function FormBuilder({ initial }: { initial?: FormBuilderInitial }) {
  const router = useRouter();
  const { toast } = useToast();
  const t = useT();
  const [fields, setFields] = useState<DraftField[]>(
    initial
      ? initial.fields.map((f) => ({
          id: f.key,
          label: f.label,
          type: f.type,
          required: f.required,
          optionsText: (f.options ?? []).join("\n"),
          help: f.help ?? "",
        }))
      : [blankField()],
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function change(id: string, patch: Partial<DraftField>) {
    setFields((all) => all.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  }

  function move(index: number, by: -1 | 1) {
    setFields((all) => {
      const next = [...all];
      const [item] = next.splice(index, 1);
      next.splice(index + by, 0, item);
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = new FormData(e.currentTarget);
    const payload = {
      title: form.get("title"),
      description: (form.get("description") as string) || undefined,
      audience: form.get("audience"),
      requiresSignature: form.get("requiresSignature") === "on",
      fields: fields.map((f) => ({
        label: f.label,
        type: f.type,
        required: f.required,
        options: f.type === "choice" ? parseOptions(f.optionsText) : undefined,
        help: f.help.trim() || undefined,
      })),
    };
    setSaving(true);
    const result = initial ? await updateDraftForm(initial.id, payload) : await createForm(payload);
    setSaving(false);
    if (!result.ok || !result.id) {
      setError(result.error ?? t("forms.builder.saveFailed"));
      return;
    }
    toast(initial ? t("forms.builder.draftSaved") : t("forms.builder.savedAsDraft"));
    router.push(`/forms/${result.id}`);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6" aria-label={t("forms.builder.label")}>
      <section className="card space-y-4 p-4">
        <div>
          <Label htmlFor="fb-title">{t("forms.builder.title")}</Label>
          <Input id="fb-title" name="title" required maxLength={200} defaultValue={initial?.title} />
        </div>
        <div>
          <Label htmlFor="fb-description">
            {t("forms.builder.instructions")}{" "}
            <span className="font-normal text-muted">{t("forms.builder.optional")}</span>
          </Label>
          <Textarea
            id="fb-description"
            name="description"
            maxLength={2000}
            rows={2}
            defaultValue={initial?.description ?? ""}
          />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="fb-audience">{t("forms.builder.audience")}</Label>
            <Select id="fb-audience" name="audience" defaultValue={initial?.audience ?? "members"}>
              <option value="members">{t("forms.builder.audienceMembers")}</option>
              <option value="staff">{t("forms.builder.audienceStaff")}</option>
            </Select>
          </div>
          <label className="flex items-start gap-2 pt-6 text-[13px]">
            <Checkbox name="requiresSignature" defaultChecked={initial?.requiresSignature ?? false} />
            <span>
              <span className="font-medium">{t("forms.builder.mustBeSigned")}</span>
              <span className="block text-muted">{t("forms.builder.mustBeSignedHint")}</span>
            </span>
          </label>
        </div>
      </section>

      <section aria-labelledby="fb-fields" className="space-y-3">
        <h2 id="fb-fields" className="text-[15px] font-semibold">
          {t("forms.builder.questions")}
        </h2>
        {fields.map((field, index) => (
          <fieldset key={field.id} className="card space-y-3 p-4" aria-label={t("forms.builder.question", { n: index + 1 })}>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_14rem]">
              <div>
                <Label htmlFor={`fb-label-${field.id}`}>{t("forms.builder.question", { n: index + 1 })}</Label>
                <Input
                  id={`fb-label-${field.id}`}
                  value={field.label}
                  required
                  maxLength={200}
                  onChange={(e) => change(field.id, { label: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor={`fb-type-${field.id}`}>{t("forms.builder.answerType")}</Label>
                <Select
                  id={`fb-type-${field.id}`}
                  value={field.type}
                  onChange={(e) => change(field.id, { type: e.target.value as FieldType })}
                >
                  {FIELD_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {t(FIELD_TYPE_KEYS[type])}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            {field.type === "choice" ? (
              <div>
                <Label htmlFor={`fb-options-${field.id}`}>{t("forms.builder.options")}</Label>
                <Textarea
                  id={`fb-options-${field.id}`}
                  rows={3}
                  value={field.optionsText}
                  onChange={(e) => change(field.id, { optionsText: e.target.value })}
                />
                <FieldHint>{t("forms.builder.optionsHint")}</FieldHint>
              </div>
            ) : null}
            <div>
              <Label htmlFor={`fb-help-${field.id}`}>
                {t("forms.builder.hint")}{" "}
                <span className="font-normal text-muted">{t("forms.builder.optional")}</span>
              </Label>
              <Input
                id={`fb-help-${field.id}`}
                value={field.help}
                maxLength={500}
                onChange={(e) => change(field.id, { help: e.target.value })}
              />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="flex items-center gap-2 text-[13px]">
                <Checkbox
                  checked={field.required}
                  onChange={(e) => change(field.id, { required: e.target.checked })}
                />
                {t("forms.builder.required")}
              </label>
              <div className="flex gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                  aria-label={t("forms.builder.moveUp", { n: index + 1 })}
                >
                  <ArrowUp className="size-4" aria-hidden />
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={index === fields.length - 1}
                  onClick={() => move(index, 1)}
                  aria-label={t("forms.builder.moveDown", { n: index + 1 })}
                >
                  <ArrowDown className="size-4" aria-hidden />
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={fields.length === 1}
                  onClick={() => setFields((all) => all.filter((f) => f.id !== field.id))}
                  aria-label={t("forms.builder.remove", { n: index + 1 })}
                >
                  <Trash2 className="size-4" aria-hidden />
                </Button>
              </div>
            </div>
          </fieldset>
        ))}
        <Button
          type="button"
          variant="secondary"
          disabled={fields.length >= MAX_FIELDS}
          onClick={() => setFields((all) => [...all, blankField()])}
        >
          <Plus className="size-4" aria-hidden />
          {t("forms.builder.addQuestion")}
        </Button>
      </section>

      {error ? (
        <p role="alert" className="text-[13px] text-danger-fg">
          {error}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={() => router.back()}>
          {t("forms.builder.cancel")}
        </Button>
        <Button type="submit" loading={saving}>
          {t("forms.builder.saveDraft")}
        </Button>
      </div>
    </form>
  );
}
