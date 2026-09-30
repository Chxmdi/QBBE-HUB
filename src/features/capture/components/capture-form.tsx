"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { FieldHint, Input, Label, Textarea } from "@/components/ui/input";
import { useLocale } from "@/lib/i18n/client";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { captureFile, captureItem } from "../actions";
import { captureT } from "../i18n";

const KINDS = ["text", "link", "file", "photo", "email"] as const;
type Kind = (typeof KINDS)[number];
const MAX_BYTES = 25 * 1024 * 1024;
/** Stop reading a photo after this long; it is kept without its text. */
const OCR_TIMEOUT_MS = 60_000;

/**
 * Quick capture (M18): a note, a link, a file, a photo (its words read on the
 * device with the Hub's existing text reader) or a pasted forwarded email.
 */
export function CaptureForm() {
  const locale = useLocale();
  const t = captureT(locale);
  const router = useRouter();
  const id = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const [kind, setKind] = useState<Kind>("text");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function uploadAndRecord(file: File) {
    if (file.size > MAX_BYTES) return { ok: false, error: t("errors.tooLarge") };
    let text: string | undefined;
    if (kind === "photo") {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), OCR_TIMEOUT_MS);
      try {
        const { readReceiptText } = await import("@/features/finance/receipt-ocr/read-receipt");
        text = await readReceiptText(file, {
          signal: controller.signal,
          onProgress: ({ percent }) => setProgress(t("form.reading", { percent: Math.round(percent) })),
        });
      } catch {
        setProgress(t("form.readFailed"));
      } finally {
        clearTimeout(timer);
      }
    }
    const supabase = createSupabaseBrowserClient();
    // A random prefix, as the document library does; the path is never the authorization.
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80) || "file";
    const path = `${crypto.randomUUID()}/${safeName}`;
    const { error } = await supabase.storage.from("documents").upload(path, file, { contentType: file.type || undefined });
    if (error) return { ok: false, error: t("errors.uploadFailed") };
    const result = await captureFile({
      kind,
      storagePath: path,
      fileName: file.name.slice(0, 300),
      mimeType: file.type || undefined,
      sizeBytes: file.size,
      text: text?.trim().slice(0, 20000) || undefined,
    });
    if (!result.ok) await supabase.storage.from("documents").remove([path]);
    return result;
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setMessage(null);
    let result: { ok: boolean; error?: string };
    if (kind === "file" || kind === "photo") {
      const file = form.get("file") as File | null;
      result = file && file.size > 0 ? await uploadAndRecord(file) : { ok: false, error: t("errors.fileRequired") };
    } else if (kind === "link") {
      result = await captureItem({ kind, url: String(form.get("url") ?? ""), note: String(form.get("note") ?? "") || undefined });
    } else {
      result = await captureItem({ kind, text: String(form.get("text") ?? "") });
    }
    setBusy(false);
    setProgress(null);
    setMessage(result.ok ? { ok: true, text: t("form.captured") } : { ok: false, text: result.error ?? t("errors.saveFailed") });
    if (result.ok) {
      formRef.current?.reset();
      router.refresh();
    }
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} className="rounded-(--radius-md) border border-line bg-surface p-4" noValidate>
      <fieldset>
        <legend className="text-[15px] font-semibold text-ink">{t("form.legend")}</legend>
        <div className="mt-2 flex flex-wrap gap-2" role="radiogroup" aria-label={t("form.legend")}>
          {KINDS.map((option) => (
            <label
              key={option}
              className={cn(
                "relative cursor-pointer rounded-(--radius-sm) border px-3 py-1.5 text-sm has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand",
                kind === option ? "border-brand bg-surface-soft font-medium text-ink" : "border-line text-muted hover:text-ink",
              )}
            >
              <input
                type="radio"
                name="kind"
                value={option}
                checked={kind === option}
                onChange={() => {
                  setKind(option);
                  setMessage(null);
                }}
                // Over the whole chip, invisible: the chip is what shows, the
                // native radio is what is clicked, focused and announced.
                className="absolute inset-0 cursor-pointer opacity-0"
              />
              {t(`form.kind.${option}`)}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="mt-4 space-y-3">
        {kind === "text" ? (
          <div>
            <Label htmlFor={`${id}-text`}>{t("form.text")}</Label>
            <Textarea id={`${id}-text`} name="text" required rows={3} />
          </div>
        ) : null}
        {kind === "link" ? (
          <>
            <div>
              <Label htmlFor={`${id}-url`}>{t("form.url")}</Label>
              <Input id={`${id}-url`} name="url" type="url" inputMode="url" required placeholder="https://" />
            </div>
            <div>
              <Label htmlFor={`${id}-note`}>{t("form.note")}</Label>
              <Textarea id={`${id}-note`} name="note" rows={2} />
            </div>
          </>
        ) : null}
        {kind === "file" || kind === "photo" ? (
          <div>
            <Label htmlFor={`${id}-file`}>{t(kind === "photo" ? "form.photo" : "form.file")}</Label>
            <Input
              id={`${id}-file`}
              name="file"
              type="file"
              required
              className="py-1.5"
              aria-describedby={kind === "photo" ? `${id}-photo-hint` : undefined}
              {...(kind === "photo" ? { accept: "image/*", capture: "environment" as const } : {})}
            />
            {kind === "photo" ? (
              <FieldHint>
                <span id={`${id}-photo-hint`}>{t("form.photoHint")}</span>
              </FieldHint>
            ) : null}
          </div>
        ) : null}
        {kind === "email" ? (
          <div>
            <Label htmlFor={`${id}-email`}>{t("form.email")}</Label>
            <Textarea id={`${id}-email`} name="text" required rows={6} aria-describedby={`${id}-email-hint`} />
            <FieldHint>
              <span id={`${id}-email-hint`}>{t("form.emailHint")}</span>
            </FieldHint>
          </div>
        ) : null}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button type="submit" loading={busy} disabled={busy}>
          {busy ? t("form.saving") : t("form.submit")}
        </Button>
        <p role="status" className={cn("text-sm", message?.ok === false ? "text-danger-fg" : "text-muted")}>
          {progress ?? message?.text ?? ""}
        </p>
      </div>
    </form>
  );
}
