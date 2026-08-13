"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input, Label, Select, Textarea } from "@/components/ui/input";

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
}

/**
 * Generic create/record dialog: collects field values and submits them to a
 * server action. Errors from the action render inline; success closes and
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
  const router = useRouter();
  const [open, setOpen] = useState(defaultOpen);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    const form = new FormData(e.currentTarget);
    const values: Record<string, string> = { ...extraValues };
    for (const field of fields) {
      const value = (form.get(field.name) as string) ?? "";
      // Omit empty optional fields so server schemas treat them as absent.
      if (value !== "") values[field.name] = value;
    }
    const result = await action(values);
    setSaving(false);
    if (!result.ok) {
      setError(result.error ?? "Something went wrong. Try again.");
      return;
    }
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <Button variant={triggerVariant} onClick={() => setOpen(true)}>
        <Plus className="size-4" aria-hidden />
        {triggerLabel}
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={title}>
        <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {fields.map((field) => {
            const id = `field-${field.name}`;
            const span = field.colSpan === 1 ? "" : "sm:col-span-2";
            return (
              <div key={field.name} className={span}>
                <Label htmlFor={id}>
                  {field.label}
                  {!field.required ? (
                    <span className="ml-1 font-normal text-muted">(optional)</span>
                  ) : null}
                </Label>
                {field.type === "textarea" ? (
                  <Textarea
                    id={id}
                    name={field.name}
                    required={field.required}
                    placeholder={field.placeholder}
                    defaultValue={field.defaultValue}
                  />
                ) : field.type === "select" ? (
                  <Select id={id} name={field.name} defaultValue={field.defaultValue ?? ""} required={field.required}>
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
                  />
                )}
                {field.hint ? (
                  <p className="mt-1 text-[12.5px] text-muted">{field.hint}</p>
                ) : null}
              </div>
            );
          })}
          {error ? (
            <p role="alert" className="text-[13px] text-danger sm:col-span-2">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2 pt-1 sm:col-span-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancel
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
