"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox, FieldHint, Input, Label, Select, Textarea } from "@/components/ui/input";
import type { FormsV2Text } from "@/features/forms-v2/messages";
import { fill } from "@/features/forms-v2/messages";
import { MAX_UPLOAD_BYTES, storagePathFor } from "@/features/editor/adapter/files";
import { localized, typedAnswers, visibleFields, type FormV2Property } from "@/features/forms-v2/properties";
import { registerFormFile, type FormFileScan } from "@/features/forms-v2/services/form-file.commands";
import { submitFormV2 } from "@/features/forms-v2/services/forms-v2.commands";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type Answer = string | boolean;

interface UploadedFile {
  documentId: string;
  title: string;
  scanStatus: FormFileScan;
}

/**
 * Answers a published form; the answer becomes a task or another record.
 * Questions appear and disappear as earlier answers change (visibleFields).
 * In preview (the builder's toggle) nothing is uploaded and nothing is sent.
 */
export function FormV2Fill({
  formId,
  properties,
  text,
  locale,
  preview = false,
}: {
  formId: string;
  properties: FormV2Property[];
  text: FormsV2Text;
  locale: string;
  preview?: boolean;
}) {
  const idBase = useId();
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [files, setFiles] = useState<Record<string, UploadedFile>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [previewSent, setPreviewSent] = useState(false);
  const [created, setCreated] = useState<{ objectType: string; objectId: string } | null>(null);

  const shown = visibleFields(properties, typedAnswers(properties, answers));
  const setAnswer = (key: string, value: Answer) => setAnswers((a) => ({ ...a, [key]: value }));

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (preview) {
      setPreviewSent(true);
      return;
    }
    const raw: Record<string, Answer> = {};
    for (const p of shown) {
      raw[p.key] = p.kind === "checkbox" ? answers[p.key] === true : String(answers[p.key] ?? "");
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
    const task = created.objectType === "task";
    return (
      <div role="status" className="card space-y-2 p-5">
        <p className="font-medium">{text.submitted}</p>
        <p className="text-sm">
          {task ? text.createdTask : text.createdRecord}{" "}
          <Link
            href={task ? `/my-work?task=${created.objectId}` : `/objects/${created.objectId}`}
            className="text-brand-fg underline"
          >
            {task ? text.viewTask : text.viewRecord}
          </Link>
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="card space-y-4 p-5" noValidate aria-label={preview ? text.preview : undefined}>
      {preview ? <p className="meta">{text.previewNotice}</p> : null}
      {shown.map((p) => {
        const id = `${idBase}-${p.key}`;
        const label = localized(p.label, locale);
        const star = p.required ? <span aria-hidden> *</span> : null;
        if (p.kind === "checkbox") {
          return (
            <label key={p.key} className="flex items-center gap-2 text-sm">
              <Checkbox
                id={id}
                name={p.key}
                required={p.required}
                checked={answers[p.key] === true}
                onChange={(e) => setAnswer(p.key, e.target.checked)}
              />
              {label}
              {star}
            </label>
          );
        }
        if (p.kind === "file") {
          return (
            <FileField
              key={p.key}
              id={id}
              property={p}
              label={label}
              text={text}
              preview={preview}
              uploaded={files[p.key]}
              onUploaded={(file) => {
                setFiles((f) => {
                  const next = { ...f };
                  if (file) next[p.key] = file;
                  else delete next[p.key];
                  return next;
                });
                setAnswer(p.key, file ? file.documentId : "");
              }}
              onError={setError}
            />
          );
        }
        const value = typeof answers[p.key] === "string" ? (answers[p.key] as string) : "";
        return (
          <div key={p.key}>
            <Label htmlFor={id}>
              {label}
              {star}
            </Label>
            {p.kind === "select" ? (
              <Select id={id} name={p.key} required={p.required} value={value} onChange={(e) => setAnswer(p.key, e.target.value)}>
                <option value="">—</option>
                {(p.options ?? []).map((o) => (
                  <option key={o.key} value={o.key}>
                    {localized(o.label, locale)}
                  </option>
                ))}
              </Select>
            ) : p.kind === "text" && p.key === "description" ? (
              <Textarea
                id={id}
                name={p.key}
                required={p.required}
                maxLength={5000}
                value={value}
                onChange={(e) => setAnswer(p.key, e.target.value)}
              />
            ) : (
              <Input
                id={id}
                name={p.key}
                required={p.required}
                type={p.kind === "date" ? "date" : p.kind === "email" ? "email" : p.kind === "url" ? "url" : "text"}
                inputMode={p.kind === "number" || p.kind === "currency" ? "decimal" : undefined}
                maxLength={p.kind === "text" ? 5000 : undefined}
                value={value}
                onChange={(e) => setAnswer(p.key, e.target.value)}
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
      {preview && previewSent ? (
        <p role="status" className="text-sm text-success-fg">
          {text.previewSubmitted}
        </p>
      ) : null}
      <Button type="submit" loading={saving}>
        {text.submit}
      </Button>
    </form>
  );
}

/**
 * One file answer. The file goes straight from the browser to the
 * `documents` bucket, then registerFormFile records it as a library document
 * (which queues its virus scan) and the form keeps the document id.
 */
function FileField({
  id,
  property,
  label,
  text,
  preview,
  uploaded,
  onUploaded,
  onError,
}: {
  id: string;
  property: FormV2Property;
  label: string;
  text: FormsV2Text;
  preview: boolean;
  uploaded: UploadedFile | undefined;
  onUploaded: (file: UploadedFile | null) => void;
  onError: (message: string | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  // Remounting the input is the one reliable way to clear a chosen file.
  const [generation, setGeneration] = useState(0);

  async function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    onError(null);
    if (file.size > MAX_UPLOAD_BYTES) {
      onError(text.errors.fileTooLarge);
      e.target.value = "";
      return;
    }
    if (preview) {
      // Nothing leaves the browser in a preview; the name stands in for the id.
      onUploaded({ documentId: file.name, title: file.name, scanStatus: "pending" });
      return;
    }
    setBusy(true);
    const supabase = createSupabaseBrowserClient();
    const path = storagePathFor(file.name, `forms-v2/${crypto.randomUUID()}`);
    const { error } = await supabase.storage.from("documents").upload(path, file, { contentType: file.type || undefined });
    if (error) {
      setBusy(false);
      onError(text.errors.fileUploadFailed);
      e.target.value = "";
      return;
    }
    const result = await registerFormFile({
      storagePath: path,
      fileName: file.name.slice(0, 200) || "file",
      mimeType: file.type || undefined,
      sizeBytes: file.size,
    });
    setBusy(false);
    if (!result.ok || !result.data) {
      await supabase.storage.from("documents").remove([path]);
      onError(result.ok ? text.errors.fileUploadFailed : result.error);
      e.target.value = "";
      return;
    }
    onUploaded(result.data);
  }

  return (
    <div>
      <Label htmlFor={id}>
        {label}
        {property.required ? <span aria-hidden> *</span> : null}
      </Label>
      {uploaded ? (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span role="status">
            {fill(text.fileUploaded, { name: uploaded.title })} · {text.scan[uploaded.scanStatus]}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              onUploaded(null);
              setGeneration((g) => g + 1);
            }}
          >
            {text.removeFile}
          </Button>
        </div>
      ) : null}
      <Input
        key={generation}
        id={id}
        type="file"
        required={property.required && !uploaded}
        disabled={busy}
        aria-describedby={`${id}-hint`}
        className={uploaded ? "sr-only" : "h-auto py-1.5"}
        onChange={handleChange}
      />
      <span id={`${id}-hint`}>
        <FieldHint>{busy ? text.fileUploading : text.fileHint}</FieldHint>
      </span>
    </div>
  );
}
