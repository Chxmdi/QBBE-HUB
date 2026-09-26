"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox, FieldHint, Input, Label, Select, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { parseAnswers, type FileAnswer, type FormField } from "@/features/forms/fields";
import { SignatureFields } from "@/features/forms/components/signature-fields";
import { submitForm } from "@/features/forms/services/form.commands";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

const MAX_BYTES = 25 * 1024 * 1024;

/**
 * Fill in and submit a published form. Attached files go into the private
 * form-files bucket, under the person's own folder, before the answers are
 * sent; if saving fails the uploads are removed again.
 */
export function FormFill({
  formId,
  fields,
  requiresSignature,
  organizationId,
  userId,
}: {
  formId: string;
  fields: FormField[];
  requiresSignature: boolean;
  organizationId: string;
  userId: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = new FormData(e.currentTarget);
    const answers: Record<string, unknown> = {};
    const files: { key: string; file: File }[] = [];
    for (const field of fields) {
      if (field.type === "file") {
        const file = form.get(field.key) as File | null;
        if (file && file.size > 0) {
          if (file.size > MAX_BYTES) {
            setError(`“${field.label}”: files must be 25 MB or smaller.`);
            return;
          }
          files.push({ key: field.key, file });
        }
      } else if (field.type === "checkbox") {
        answers[field.key] = form.get(field.key) === "on";
      } else {
        answers[field.key] = form.get(field.key) ?? "";
      }
    }

    // Check the typed answers before uploading anything, so a typo never
    // costs an upload. The server and the database check them again.
    const typed = parseAnswers(
      fields.filter((f) => f.type !== "file"),
      answers,
    );
    if (!typed.ok) {
      setError(typed.error);
      return;
    }

    setSaving(true);
    const supabase = createSupabaseBrowserClient();
    const uploaded: string[] = [];
    for (const { key, file } of files) {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80) || "file";
      // The database checks the first two segments are this organization and
      // this person; the random segment avoids collisions.
      const path = `${organizationId}/${userId}/${crypto.randomUUID()}/${safeName}`;
      const { error: uploadError } = await supabase.storage
        .from("form-files")
        .upload(path, file, { contentType: file.type || undefined });
      if (uploadError) {
        if (uploaded.length) await supabase.storage.from("form-files").remove(uploaded);
        setSaving(false);
        setError("Upload failed. Attach a photo (JPEG, PNG, HEIC, WebP) or a PDF, and check your connection.");
        return;
      }
      uploaded.push(path);
      answers[key] = { path, name: file.name.slice(-200) || safeName } satisfies FileAnswer;
    }

    const result = await submitForm({
      formId,
      answers,
      signerName: requiresSignature ? String(form.get("signerName") ?? "") : undefined,
      consent: requiresSignature ? form.get("consent") === "on" : false,
    });
    setSaving(false);
    if (!result.ok || !result.id) {
      if (uploaded.length) await supabase.storage.from("form-files").remove(uploaded);
      setError(result.error ?? "Could not submit the form.");
      return;
    }
    toast(requiresSignature ? "Submitted and signed." : "Submitted.");
    router.push(`/forms/submissions/${result.id}`);
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-2xl space-y-5" aria-label="Fill in the form">
      {fields.map((field) => {
        const id = `ff-${field.key}`;
        const label = (
          <>
            {field.label}
            {field.required ? null : <span className="font-normal text-muted"> (optional)</span>}
          </>
        );
        const hint = field.help ? <FieldHint>{field.help}</FieldHint> : null;
        switch (field.type) {
          case "checkbox":
            return (
              <div key={field.key}>
                <label className="flex items-start gap-2 text-[13px]" htmlFor={id}>
                  <Checkbox id={id} name={field.key} required={field.required} className="mt-0.5" />
                  <span className="font-medium">{label}</span>
                </label>
                {hint}
              </div>
            );
          case "choice":
            return (
              <div key={field.key}>
                <Label htmlFor={id}>{label}</Label>
                <Select id={id} name={field.key} required={field.required} defaultValue="">
                  <option value="">Choose…</option>
                  {(field.options ?? []).map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </Select>
                {hint}
              </div>
            );
          case "text":
            return (
              <div key={field.key}>
                <Label htmlFor={id}>{label}</Label>
                <Textarea id={id} name={field.key} required={field.required} maxLength={5000} rows={2} />
                {hint}
              </div>
            );
          case "file":
            return (
              <div key={field.key}>
                <Label htmlFor={id}>{label}</Label>
                <Input
                  id={id}
                  name={field.key}
                  type="file"
                  required={field.required}
                  accept="image/jpeg,image/png,image/heic,image/heif,image/webp,application/pdf"
                />
                {hint ?? <FieldHint>A photo or PDF, up to 25 MB.</FieldHint>}
              </div>
            );
          default:
            return (
              <div key={field.key}>
                <Label htmlFor={id}>{label}</Label>
                <Input
                  id={id}
                  name={field.key}
                  required={field.required}
                  type={field.type === "date" ? "date" : "text"}
                  inputMode={field.type === "money" || field.type === "number" ? "decimal" : undefined}
                  placeholder={field.type === "money" ? "0.00" : undefined}
                />
                {hint}
              </div>
            );
        }
      })}
      {requiresSignature ? <SignatureFields idPrefix="ff" /> : null}
      {error ? (
        <p role="alert" className="text-[13px] text-danger-fg">
          {error}
        </p>
      ) : null}
      <div className="flex justify-end">
        <Button type="submit" loading={saving}>
          <Send className="size-4" aria-hidden />
          {requiresSignature ? "Sign and submit" : "Submit"}
        </Button>
      </div>
    </form>
  );
}
