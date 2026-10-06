"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { useT } from "@/lib/i18n/client";
import { fieldProblem } from "./field-validity";

export interface FormField {
  name: string;
  label: string;
  type: "text" | "textarea" | "select" | "date" | "datetime-local" | "number" | "url" | "email";
  required?: boolean;
  placeholder?: string;
  options?: { value: string; label: string }[];
  defaultValue?: string;
  hint?: string;
  colSpan?: 1 | 2;
  /** Number limits, checked in the browser before sending. */
  min?: number;
  max?: number;
  step?: number | "any";
  maxLength?: number;
}

/**
 * Generic create/record dialog: collects field values and submits them to a
 * server action. Every field is checked in the browser first, and each
 * problem shows under its own field, all at once and in plain words (audit
 * M3); errors from the action render under the form. Success closes and
 * refreshes (no misleading optimistic success — Appendix B).
 */
export function EntityFormDialog({
  triggerLabel,
  triggerVariant = "primary",
  title,
  fields,
  action,
  submitLabel,
  defaultOpen = false,
  extraValues,
}: {
  triggerLabel: string;
  triggerVariant?: "primary" | "secondary";
  title: string;
  fields: FormField[];
  action: (values: Record<string, string>) => Promise<{ ok: boolean; error?: string; id?: string }>;
  submitLabel?: string;
  defaultOpen?: boolean;
  extraValues?: Record<string, string>;
}) {
  const t = useT();
  const router = useRouter();
  // Every dialog on the page is mounted at once, so a fixed `field-<name>`
  // id collided whenever two of them shared a field name — "Name", "Title",
  // "Description" — and each duplicated label then pointed at the first
  // dialog's control. Instance-scoped ids keep every label on its own input.
  const instanceId = useId();
  const [open, setOpen] = useState(defaultOpen);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  function close() {
    setOpen(false);
    setError(null);
    setFieldErrors({});
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formElement = e.currentTarget;
    const problems: Record<string, string> = {};
    let first: HTMLElement | null = null;
    for (const field of fields) {
      const control = formElement.elements.namedItem(field.name);
      if (!(control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement || control instanceof HTMLSelectElement)) continue;
      const problem = fieldProblem(control.validity, field, t);
      if (problem) {
        problems[field.name] = problem;
        first ??= control;
      }
    }
    setFieldErrors(problems);
    if (first) {
      setError(t("ui.fieldErrors.summary"));
      first.focus();
      return;
    }
    setSaving(true);
    const form = new FormData(formElement);
    const values: Record<string, string> = { ...extraValues };
    for (const field of fields) {
      const value = (form.get(field.name) as string) ?? "";
      // Omit empty optional fields so server schemas treat them as absent.
      if (value !== "") values[field.name] = value;
    }
    const result = await action(values);
    setSaving(false);
    if (!result.ok) {
      setError(result.error ?? t("ui.somethingWrong"));
      return;
    }
    // The native <dialog> stays mounted when closed, so without a reset the
    // next "Add" would silently reuse the last entry's values.
    formElement.reset();
    close();
    router.refresh();
  }

  return (
    <>
      <Button variant={triggerVariant} onClick={() => setOpen(true)}>
        <Plus className="size-4" aria-hidden />
        {triggerLabel}
      </Button>
      <Dialog open={open} onClose={close} title={title}>
        <form
          onSubmit={handleSubmit}
          noValidate
          onInput={(e) => {
            // A field's message goes once the person changes that field.
            const name = (e.target as HTMLInputElement).name;
            if (name && fieldErrors[name]) {
              setFieldErrors((current) => {
                const next = { ...current };
                delete next[name];
                return next;
              });
            }
          }}
          className="grid grid-cols-1 gap-4 sm:grid-cols-2"
        >
          {fields.map((field) => {
            const id = `${instanceId}-${field.name}`;
            const problem = fieldErrors[field.name];
            const errorId = problem ? `${id}-error` : undefined;
            const hintId = [field.hint ? `${id}-hint` : null, errorId].filter(Boolean).join(" ") || undefined;
            const invalid = problem ? true : undefined;
            const span = field.colSpan === 1 ? "" : "sm:col-span-2";
            return (
              <div key={field.name} className={span}>
                <Label htmlFor={id}>
                  {field.label}
                  {!field.required ? (
                    <span className="ml-1 font-normal text-muted">{t("shell.optional")}</span>
                  ) : null}
                </Label>
                {field.type === "textarea" ? (
                  <Textarea
                    id={id}
                    name={field.name}
                    required={field.required}
                    placeholder={field.placeholder}
                    defaultValue={field.defaultValue}
                    maxLength={field.maxLength}
                    aria-invalid={invalid}
                    aria-describedby={hintId}
                  />
                ) : field.type === "select" ? (
                  <Select
                    id={id}
                    name={field.name}
                    defaultValue={field.defaultValue ?? ""}
                    required={field.required}
                    aria-invalid={invalid}
                    aria-describedby={hintId}
                  >
                    {!field.required ? <option value="">—</option> : null}
                    {(field.options ?? []).map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <Input
                    id={id}
                    name={field.name}
                    type={field.type}
                    required={field.required}
                    placeholder={field.placeholder}
                    defaultValue={field.defaultValue}
                    min={field.min}
                    max={field.max}
                    step={field.step}
                    maxLength={field.maxLength}
                    aria-invalid={invalid}
                    aria-describedby={hintId}
                  />
                )}
                {field.hint ? (
                  <p id={`${id}-hint`} className="mt-1 text-[12.5px] text-muted">
                    {field.hint}
                  </p>
                ) : null}
                {problem ? (
                  <p id={errorId} className="mt-1 text-[12.5px] font-medium text-danger-fg">
                    {problem}
                  </p>
                ) : null}
              </div>
            );
          })}
          {error ? (
            <p role="alert" className="text-[13px] text-danger-fg sm:col-span-2">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2 pt-1 sm:col-span-2">
            <Button type="button" variant="secondary" onClick={close}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" loading={saving}>
              {submitLabel ?? title}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
