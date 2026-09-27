"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Camera, Plus, ScanText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FieldHint, Input, Label, Select, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { centsToDecimal, formatCents, parseMoneyToCents } from "@/features/finance/money";
import {
  extractReceiptFields,
  taxConsistency,
  type ReceiptSuggestions,
} from "@/features/finance/receipt-ocr/extract";
import {
  useReceiptReader,
  type ReaderState,
} from "@/features/finance/receipt-ocr/use-receipt-reader";
import { registerReceipt } from "@/features/finance/services/receipt.commands";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useLocale, useT } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/translate";
import type { Option } from "@/features/tasks/components/task-create-dialog";

const MAX_BYTES = 25 * 1024 * 1024;

type Field = "documentDate" | "vendor" | "total" | "gst" | "qst";
type Values = Record<Field, string>;

const FIELD_NAMES: Record<Field, MessageKey> = {
  documentDate: "finance.receipts.submit.fieldNames.documentDate",
  vendor: "finance.receipts.submit.fieldNames.vendor",
  total: "finance.receipts.submit.fieldNames.total",
  gst: "finance.receipts.submit.fieldNames.gst",
  qst: "finance.receipts.submit.fieldNames.qst",
};

function asFieldValues(s: ReceiptSuggestions): Partial<Values> {
  const out: Partial<Values> = {};
  if (s.documentDate) out.documentDate = s.documentDate;
  if (s.vendor) out.vendor = s.vendor;
  if (s.totalCents !== undefined) out.total = centsToDecimal(s.totalCents);
  if (s.gstCents !== undefined) out.gst = centsToDecimal(s.gstCents);
  if (s.qstCents !== undefined) out.qst = centsToDecimal(s.qstCents);
  return out;
}

const cents = (value: string) => (value.trim() === "" ? null : parseMoneyToCents(value));

/**
 * Photograph or upload a receipt or bill and type the figures the accountant
 * needs. The file goes into the private receipts bucket first, under the
 * submitter's own folder; the record is then saved by the server, and the
 * upload is removed again if that fails.
 *
 * When the file is a photo it is also read on the device (#142 v2, see
 * receipt-ocr/read-receipt.ts) and what could be picked out goes into the
 * fields that are still empty, marked as a suggestion to check. The date
 * counts as empty until the submitter changes it from today. Nothing is
 * submitted for them, and reading never blocks typing or submitting by hand.
 */
export function ReceiptSubmitDialog({
  organizationId,
  userId,
  programs,
  projects,
}: {
  organizationId: string;
  userId: string;
  programs: Option[];
  projects: (Option & { programId: string | null })[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const t = useT();
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [programId, setProgramId] = useState("");
  const today = new Date().toLocaleDateString("en-CA");
  const formRef = useRef<HTMLFormElement>(null);

  const blank: Values = { documentDate: today, vendor: "", total: "", gst: "", qst: "" };
  const [values, setValues] = useState<Values>(blank);
  const [dateTouched, setDateTouched] = useState(false);
  // Field -> the value the photo suggested, while the submitter has not edited it.
  const [suggested, setSuggested] = useState<Partial<Values>>({});
  const [outcome, setOutcome] = useState<string | null>(null);
  // The OCR result arrives long after the render that started it.
  const latest = useRef({ values, dateTouched, suggested });
  useEffect(() => {
    latest.current = { values, dateTouched, suggested };
  });

  const reader = useReceiptReader((text) => {
    const found = asFieldValues(extractReceiptFields(text, today));
    const { values: now, dateTouched: touched } = latest.current;
    const fill: Partial<Values> = {};
    for (const [field, value] of Object.entries(found) as [Field, string][]) {
      const empty = field === "documentDate" ? !touched : now[field].trim() === "";
      if (empty) fill[field] = value;
    }
    const filled = Object.keys(fill) as Field[];
    setValues((v) => ({ ...v, ...fill }));
    setSuggested((s) => ({ ...s, ...fill }));
    setOutcome(
      filled.length
        ? t("finance.receipts.submit.readSuggested", {
            fields: filled.map((f) => t(FIELD_NAMES[f])).join(", "),
          })
        : Object.keys(found).length
          ? t("finance.receipts.submit.readAlreadyFilled")
          : t("finance.receipts.submit.readNothing"),
    );
  });

  function setField(field: Field, value: string) {
    setValues((v) => ({ ...v, [field]: value }));
    if (field === "documentDate") setDateTouched(true);
    // Once edited, the value is the submitter's, not the photo's.
    setSuggested((s) => {
      if (!(field in s)) return s;
      const rest = { ...s };
      delete rest[field];
      return rest;
    });
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Suggestions from a previous photo that were never edited go with it.
    const stale = Object.keys(latest.current.suggested) as Field[];
    if (stale.length) {
      setValues((v) => {
        const next = { ...v };
        for (const field of stale) next[field] = field === "documentDate" ? today : "";
        return next;
      });
      setSuggested({});
    }
    setOutcome(null);
    if (file && file.type.startsWith("image/") && file.size <= MAX_BYTES) reader.read(file);
    else reader.reset();
  }

  function close() {
    // Closing stops any reading in progress; what was typed stays.
    reader.reset();
    setOutcome(null);
    setOpen(false);
  }

  const consistency = taxConsistency(cents(values.total), cents(values.gst), cents(values.qst));
  const taxWarning = consistency && !consistency.consistent ? "rc-tax-check" : undefined;

  const projectChoices = programId
    ? projects.filter((p) => p.programId === programId)
    : projects;

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = new FormData(e.currentTarget);
    const file = form.get("file") as File | null;
    if (!file || file.size === 0) {
      setError(t("finance.receipts.submit.fileRequired"));
      return;
    }
    if (file.size > MAX_BYTES) {
      setError(t("finance.receipts.submit.fileTooLarge"));
      return;
    }

    setSaving(true);
    setProgress(t("finance.receipts.submit.uploading"));
    const supabase = createSupabaseBrowserClient();
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80) || "receipt";
    // The database checks that the first two segments are this organization
    // and this person; the random segment avoids collisions.
    const path = `${organizationId}/${userId}/${crypto.randomUUID()}/${safeName}`;

    const { error: uploadError } = await supabase.storage
      .from("receipts")
      .upload(path, file, { contentType: file.type || undefined });
    if (uploadError) {
      setSaving(false);
      setProgress(null);
      setError(t("finance.receipts.submit.uploadFailed"));
      return;
    }

    setProgress(t("finance.receipts.submit.saving"));
    const result = await registerReceipt({
      kind: form.get("kind") || "receipt",
      documentDate: values.documentDate,
      vendor: values.vendor,
      total: values.total,
      gst: values.gst,
      qst: values.qst,
      programId: (form.get("programId") as string) || undefined,
      projectId: (form.get("projectId") as string) || undefined,
      note: (form.get("note") as string) || undefined,
      storagePath: path,
      fileName: file.name.slice(-200) || safeName,
      mimeType: file.type || undefined,
      sizeBytes: file.size,
    });
    setSaving(false);
    setProgress(null);

    if (!result.ok) {
      await supabase.storage.from("receipts").remove([path]);
      setError(result.error ?? t("finance.receipts.submit.saveFailed"));
      return;
    }
    toast(t("finance.receipts.submit.submitted"));
    setOpen(false);
    setProgramId("");
    // The next receipt starts from a clean form.
    reader.reset();
    formRef.current?.reset();
    setValues(blank);
    setDateTouched(false);
    setSuggested({});
    setOutcome(null);
    router.refresh();
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus className="size-4" aria-hidden />
        {t("finance.receipts.submit.trigger")}
      </Button>
      <Dialog open={open} onClose={close} title={t("finance.receipts.submit.dialogTitle")}>
        <form ref={formRef} onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="rc-file">{t("finance.receipts.submit.fileLabel")}</Label>
            <Input
              id="rc-file"
              name="file"
              type="file"
              required
              accept="image/jpeg,image/png,image/heic,image/heif,image/webp,application/pdf"
              onChange={handleFileChange}
            />
            <FieldHint>{t("finance.receipts.submit.fileHint")}</FieldHint>
            <ReadingStatus state={reader.state} outcome={outcome} onSkip={reader.skip} />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="rc-kind">{t("finance.receipts.submit.typeLabel")}</Label>
              <Select id="rc-kind" name="kind" defaultValue="receipt">
                <option value="receipt">{t("finance.receipts.submit.typeReceipt")}</option>
                <option value="bill">{t("finance.receipts.submit.typeBill")}</option>
              </Select>
            </div>
            <div>
              <Label htmlFor="rc-date">{t("finance.receipts.submit.dateLabel")}</Label>
              <Input
                id="rc-date"
                name="documentDate"
                type="date"
                required
                max={today}
                value={values.documentDate}
                onChange={(e) => setField("documentDate", e.target.value)}
                {...suggestedProps("documentDate", suggested)}
              />
              <SuggestedMark field="documentDate" suggested={suggested} />
            </div>
          </div>
          <div>
            <Label htmlFor="rc-vendor">{t("finance.receipts.submit.vendorLabel")}</Label>
            <Input
              id="rc-vendor"
              name="vendor"
              required
              maxLength={200}
              placeholder={t("finance.receipts.submit.vendorPlaceholder")}
              value={values.vendor}
              onChange={(e) => setField("vendor", e.target.value)}
              {...suggestedProps("vendor", suggested)}
            />
            <SuggestedMark field="vendor" suggested={suggested} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label htmlFor="rc-total">{t("finance.receipts.submit.totalLabel")}</Label>
              <Input
                id="rc-total"
                name="total"
                required
                inputMode="decimal"
                placeholder="42.18"
                value={values.total}
                onChange={(e) => setField("total", e.target.value)}
                {...suggestedProps("total", suggested)}
              />
              <SuggestedMark field="total" suggested={suggested} />
            </div>
            <div>
              <Label htmlFor="rc-gst">{t("finance.receipts.submit.gstLabel")}</Label>
              <Input
                id="rc-gst"
                name="gst"
                inputMode="decimal"
                placeholder="0.00"
                value={values.gst}
                onChange={(e) => setField("gst", e.target.value)}
                {...suggestedProps("gst", suggested, taxWarning)}
              />
              <SuggestedMark field="gst" suggested={suggested} />
            </div>
            <div>
              <Label htmlFor="rc-qst">{t("finance.receipts.submit.qstLabel")}</Label>
              <Input
                id="rc-qst"
                name="qst"
                inputMode="decimal"
                placeholder="0.00"
                value={values.qst}
                onChange={(e) => setField("qst", e.target.value)}
                {...suggestedProps("qst", suggested, taxWarning)}
              />
              <SuggestedMark field="qst" suggested={suggested} />
            </div>
          </div>
          <FieldHint>{t("finance.receipts.submit.taxHint")}</FieldHint>
          {consistency && !consistency.consistent ? (
            <p id="rc-tax-check" className="-mt-2 text-[12.5px] text-warning-fg">
              {t("finance.receipts.submit.taxCheck", {
                base: formatCents(consistency.beforeTaxCents, locale),
                gst: formatCents(consistency.expectedGstCents, locale),
                qst: formatCents(consistency.expectedQstCents, locale),
              })}
            </p>
          ) : null}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="rc-program">{t("finance.receipts.submit.programLabel")}</Label>
              <Select
                id="rc-program"
                name="programId"
                value={programId}
                onChange={(e) => setProgramId(e.target.value)}
              >
                <option value="">{t("finance.receipts.submit.noProgram")}</option>
                {programs.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="rc-project">{t("finance.receipts.submit.projectLabel")}</Label>
              <Select id="rc-project" name="projectId" defaultValue="" key={programId}>
                <option value="">{t("finance.receipts.submit.noProject")}</option>
                {projectChoices.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <div>
            <Label htmlFor="rc-note">
              {t("finance.receipts.submit.noteLabel")}{" "}
              <span className="font-normal text-muted">{t("finance.receipts.submit.optional")}</span>
            </Label>
            <Textarea id="rc-note" name="note" maxLength={2000} rows={2} />
          </div>
          {error ? (
            <p role="alert" className="text-[13px] text-danger-fg">
              {error}
            </p>
          ) : null}
          <div className="flex items-center justify-end gap-2 pt-1">
            {progress ? <span className="meta">{progress}</span> : null}
            <Button type="button" variant="secondary" onClick={close}>
              {t("finance.receipts.submit.cancel")}
            </Button>
            <Button type="submit" loading={saving}>
              <Camera className="size-4" aria-hidden />
              {t("finance.receipts.submit.submit")}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}

/** A suggested field looks different and says so to screen readers too. */
function suggestedProps(field: Field, suggested: Partial<Values>, alsoDescribedBy?: string) {
  const ids = [field in suggested ? `rc-${field}-suggested` : null, alsoDescribedBy].filter(Boolean);
  return {
    "aria-describedby": ids.length ? ids.join(" ") : undefined,
    className: field in suggested ? "border-accent-fg bg-brand-soft" : undefined,
  };
}

function SuggestedMark({ field, suggested }: { field: Field; suggested: Partial<Values> }) {
  const t = useT();
  if (!(field in suggested)) return null;
  return (
    <p id={`rc-${field}-suggested`} className="mt-1 text-[12px] font-medium text-accent-fg">
      {t("finance.receipts.submit.suggestedMark")}
    </p>
  );
}

/**
 * Progress of the reading, with Skip. The polite live region is always in the
 * page (a region inserted together with its text is often not read out) and
 * carries only the start and the outcome, not every percent.
 */
function ReadingStatus({
  state,
  outcome,
  onSkip,
}: {
  state: ReaderState;
  outcome: string | null;
  onSkip: () => void;
}) {
  const t = useT();
  const message =
    state.kind === "running"
      ? t("finance.receipts.submit.reading")
      : state.kind === "done"
        ? (outcome ?? "")
        : state.kind === "failed"
          ? t("finance.receipts.submit.readFailed")
          : state.kind === "timed-out"
            ? t("finance.receipts.submit.readTimedOut")
            : state.kind === "skipped"
              ? t("finance.receipts.submit.readSkipped")
              : "";

  return (
    <div className="mt-2">
      {state.kind === "running" ? (
        <div className="flex items-center gap-3">
          <ScanText className="size-4 shrink-0 text-muted" aria-hidden />
          <progress
            className="h-1.5 flex-1 accent-(--color-brand)"
            max={100}
            // Indeterminate while the engine loads; a percentage while reading.
            value={state.progress.stage === "reading" ? state.progress.percent : undefined}
            aria-label={
              state.progress.stage === "reading"
                ? t("finance.receipts.submit.progressReading")
                : t("finance.receipts.submit.progressPreparing")
            }
          />
          <Button type="button" variant="secondary" size="sm" onClick={onSkip}>
            {t("finance.receipts.submit.skip")}
          </Button>
        </div>
      ) : null}
      <p role="status" className="mt-1 text-[12.5px] text-muted">
        {message}
      </p>
    </div>
  );
}
