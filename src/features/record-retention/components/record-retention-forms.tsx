"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Checkbox, Input, Label, Select, Textarea } from "@/components/ui/input";
import {
  MONTHS,
  type LegalHoldRow,
  type RecordCategory,
  type RetentionRuleRow,
} from "@/features/record-retention/schemas";
import type { DocumentOption } from "@/features/record-retention/services/record-retention.queries";
import {
  classifyDocument,
  placeLegalHold,
  releaseLegalHold,
  saveFiscalYearEnd,
  saveRetentionRule,
} from "@/features/record-retention/services/record-retention.commands";
import type { ActionResult } from "@/features/tasks/services/task.commands";

/**
 * The forms on Admin → Records & holds. Each one submits to a server action
 * and shows the database's own sentence when it refuses — the floor, the hold,
 * or a change that would shorten retention.
 */

function useSubmit() {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const run = React.useCallback(
    async (action: () => Promise<ActionResult>, onDone?: () => void) => {
      setBusy(true);
      setError(null);
      const result = await action();
      setBusy(false);
      if (!result.ok) {
        setError(result.error ?? "That didn't work. Try again.");
        return;
      }
      onDone?.();
      router.refresh();
    },
    [router],
  );
  return { busy, error, run };
}

function ErrorLine({ error }: { error: string | null }) {
  return error ? (
    <p role="alert" className="text-[12.5px] text-danger-fg">
      {error}
    </p>
  ) : null;
}

export function RuleEditor({
  category,
  rule,
}: {
  category: RecordCategory;
  rule: RetentionRuleRow | null;
}) {
  const [open, setOpen] = React.useState(false);
  const { busy, error, run } = useSubmit();
  const permanent = category.retention_basis === "permanent";

  if (!open) {
    return (
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        Change or confirm
      </Button>
    );
  }

  return (
    <form
      className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        void run(
          () =>
            saveRetentionRule({
              categoryKey: category.key,
              retainYears: permanent ? null : String(form.get("years") ?? ""),
              confirmed: form.get("confirmed") === "on",
              confirmationNote: String(form.get("note") ?? "").trim() || undefined,
            }),
          () => setOpen(false),
        );
      }}
    >
      {permanent ? null : (
        <div>
          <Label htmlFor={`years-${category.key}`}>Keep for (years)</Label>
          <Input
            id={`years-${category.key}`}
            name="years"
            inputMode="numeric"
            defaultValue={String(rule?.retain_years ?? category.default_years ?? "")}
          />
          <p className="meta mt-1">At least {category.minimum_years} years.</p>
        </div>
      )}
      <div className={permanent ? "sm:col-span-2" : undefined}>
        <Label htmlFor={`note-${category.key}`}>Confirmation note (optional)</Label>
        <Textarea
          id={`note-${category.key}`}
          name="note"
          rows={2}
          defaultValue={rule?.confirmation_note ?? ""}
          placeholder={`e.g. Confirmed by the ${category.confirm_with} by email on …`}
        />
      </div>
      <label className="flex items-center gap-2 text-[13.5px] sm:col-span-2">
        <Checkbox name="confirmed" defaultChecked={Boolean(rule?.confirmed_at)} />
        The {category.confirm_with} has confirmed this period
      </label>
      <div className="flex items-center gap-2 sm:col-span-2">
        <Button type="submit" size="sm" loading={busy} disabled={busy}>
          Save
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
      <div className="sm:col-span-2">
        <ErrorLine error={error} />
      </div>
    </form>
  );
}

export function FiscalYearEndForm({
  current,
}: {
  current: { month: number; day: number } | null;
}) {
  const { busy, error, run } = useSubmit();
  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        void run(() =>
          saveFiscalYearEnd({ month: form.get("month"), day: form.get("day") }),
        );
      }}
    >
      <div>
        <Label htmlFor="fye-month">Month</Label>
        <Select id="fye-month" name="month" defaultValue={String(current?.month ?? 3)}>
          {MONTHS.map((name, index) => (
            <option key={name} value={index + 1}>
              {name}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <Label htmlFor="fye-day">Day</Label>
        <Input
          id="fye-day"
          name="day"
          inputMode="numeric"
          className="w-20"
          defaultValue={String(current?.day ?? 31)}
        />
      </div>
      <Button type="submit" size="sm" loading={busy} disabled={busy}>
        Save year end
      </Button>
      <ErrorLine error={error} />
    </form>
  );
}

export function PlaceHoldForm({
  categories,
  documents,
}: {
  categories: RecordCategory[];
  documents: DocumentOption[];
}) {
  const [scope, setScope] = React.useState<"record" | "category">("record");
  const { busy, error, run } = useSubmit();
  const formRef = React.useRef<HTMLFormElement>(null);

  return (
    <form
      ref={formRef}
      className="grid grid-cols-1 gap-3 sm:grid-cols-2"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const reason = String(form.get("reason") ?? "");
        const target = String(form.get("target") ?? "");
        void run(
          () =>
            placeLegalHold(
              scope === "category"
                ? { scope, categoryKey: target, reason }
                : { scope, recordId: target, reason },
            ),
          () => formRef.current?.reset(),
        );
      }}
    >
      <div>
        <Label htmlFor="hold-scope">Hold</Label>
        <Select
          id="hold-scope"
          value={scope}
          onChange={(event) => setScope(event.currentTarget.value as "record" | "category")}
        >
          <option value="record">One document</option>
          <option value="category">A whole record category</option>
        </Select>
      </div>
      <div>
        <Label htmlFor="hold-target">{scope === "category" ? "Category" : "Document"}</Label>
        <Select id="hold-target" name="target" key={scope} defaultValue="">
          <option value="" disabled>
            Choose…
          </option>
          {scope === "category"
            ? categories.map((category) => (
                <option key={category.key} value={category.key}>
                  {category.label}
                </option>
              ))
            : documents.map((document) => (
                <option key={document.id} value={document.id}>
                  {document.title}
                </option>
              ))}
        </Select>
      </div>
      <div className="sm:col-span-2">
        <Label htmlFor="hold-reason">Reason</Label>
        <Textarea
          id="hold-reason"
          name="reason"
          rows={2}
          placeholder="e.g. Revenu Québec audit of the 2025 fiscal year"
        />
      </div>
      <div className="flex items-center gap-2 sm:col-span-2">
        <Button type="submit" size="sm" loading={busy} disabled={busy}>
          Place hold
        </Button>
        <ErrorLine error={error} />
      </div>
    </form>
  );
}

export function ReleaseHoldForm({ hold }: { hold: LegalHoldRow }) {
  const [open, setOpen] = React.useState(false);
  const { busy, error, run } = useSubmit();

  if (!open) {
    return (
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        Release
      </Button>
    );
  }
  return (
    <form
      className="mt-2 flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        void run(
          () =>
            releaseLegalHold({ holdId: hold.id, reason: String(form.get("reason") ?? "") }),
          () => setOpen(false),
        );
      }}
    >
      <Label htmlFor={`release-${hold.id}`}>Why is the hold being released?</Label>
      <Textarea id={`release-${hold.id}`} name="reason" rows={2} />
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" loading={busy} disabled={busy}>
          Release hold
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
      <ErrorLine error={error} />
    </form>
  );
}

export function ClassifyDocumentForm({
  categories,
  documents,
}: {
  categories: RecordCategory[];
  documents: DocumentOption[];
}) {
  const { busy, error, run } = useSubmit();
  const [documentId, setDocumentId] = React.useState("");
  const selected = documents.find((document) => document.id === documentId) ?? null;

  return (
    <form
      className="grid grid-cols-1 gap-3 sm:grid-cols-3"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        void run(() =>
          classifyDocument({
            documentId,
            categoryKey: String(form.get("category") ?? ""),
            recordDate: String(form.get("recordDate") ?? ""),
          }),
        );
      }}
    >
      <div>
        <Label htmlFor="classify-document">Document</Label>
        <Select
          id="classify-document"
          value={documentId}
          onChange={(event) => setDocumentId(event.currentTarget.value)}
        >
          <option value="" disabled>
            Choose…
          </option>
          {documents.map((document) => (
            <option key={document.id} value={document.id}>
              {document.title}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <Label htmlFor="classify-category">Category</Label>
        <Select
          id="classify-category"
          name="category"
          key={`category-${documentId}`}
          defaultValue={selected?.record_category ?? ""}
        >
          <option value="">Not a business record</option>
          {categories.map((category) => (
            <option key={category.key} value={category.key}>
              {category.label}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <Label htmlFor="classify-date">Record date</Label>
        <Input
          id="classify-date"
          name="recordDate"
          type="date"
          key={`date-${documentId}`}
          defaultValue={selected?.record_date ?? ""}
        />
      </div>
      <div className="flex items-center gap-2 sm:col-span-3">
        <Button type="submit" size="sm" loading={busy} disabled={busy || !documentId}>
          Save classification
        </Button>
        <ErrorLine error={error} />
      </div>
    </form>
  );
}
