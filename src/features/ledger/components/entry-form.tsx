"use client";

import { useRouter } from "next/navigation";
import { useId, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FieldHint, Input, Label, Select } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { formatCents, lineTotals, parseMoneyToCents } from "@/features/ledger/money";
import { saveEntry } from "@/features/ledger/services/ledger.commands";

export interface Choice {
  id: string;
  label: string;
}

export interface EntryLineValue {
  accountId: string;
  fundId: string;
  programId: string;
  projectId: string;
  description: string;
  debit: string;
  credit: string;
}

export interface EntryFormValue {
  entryId?: string;
  entryDate: string;
  memo: string;
  kind: "standard" | "opening";
  lines: EntryLineValue[];
}

interface Line extends EntryLineValue {
  key: number;
}

/** Cents for display while typing; unreadable text counts as nothing. */
function cents(value: string): number {
  return value.trim() === "" ? 0 : (parseMoneyToCents(value) ?? 0);
}

/**
 * Writes a journal entry: date, memo and balanced lines, each with an account
 * and a fund. The totals update as you type; the database checks the balance
 * again when it saves.
 */
export function EntryForm({
  initial,
  accounts,
  funds,
  programs,
  projects,
  defaultFundId,
}: {
  initial: EntryFormValue;
  accounts: Choice[];
  funds: Choice[];
  programs: Choice[];
  projects: (Choice & { programId: string | null })[];
  defaultFundId: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const formId = useId();
  const [entryDate, setEntryDate] = useState(initial.entryDate);
  const [memo, setMemo] = useState(initial.memo);
  const [kind, setKind] = useState(initial.kind);
  const [nextKey, setNextKey] = useState(initial.lines.length + 2);
  const blank = (key: number): Line => ({
    key,
    accountId: "",
    fundId: defaultFundId,
    programId: "",
    projectId: "",
    description: "",
    debit: "",
    credit: "",
  });
  const [lines, setLines] = useState<Line[]>(
    initial.lines.length > 0 ? initial.lines.map((l, i) => ({ ...l, key: i })) : [blank(0), blank(1)],
  );
  const [saving, setSaving] = useState<null | "draft" | "post">(null);
  const [error, setError] = useState<string | null>(null);

  const totals = useMemo(
    () => lineTotals(lines.map((l) => ({ debit: cents(l.debit), credit: cents(l.credit) }))),
    [lines],
  );

  function update(key: number, patch: Partial<EntryLineValue>) {
    setLines((current) => current.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  async function submit(post: boolean) {
    setError(null);
    setSaving(post ? "post" : "draft");
    const result = await saveEntry({
      entryId: initial.entryId,
      entryDate,
      memo,
      kind,
      post,
      lines: lines.map((l) => ({
        accountId: l.accountId,
        fundId: l.fundId,
        programId: l.programId,
        projectId: l.projectId,
        description: l.description,
        debit: l.debit,
        credit: l.credit,
      })),
    });
    setSaving(null);
    if (!result.ok) {
      setError(result.error ?? "Could not save the entry.");
      if (result.id) {
        toast(result.error ?? "Saved as a draft but not posted.", { tone: "warning" });
        router.push(`/finance/ledger/journal/${result.id}`);
        router.refresh();
      }
      return;
    }
    toast(post ? "Entry posted." : "Draft saved.", { tone: "success" });
    router.push(`/finance/ledger/journal/${result.id}`);
    router.refresh();
  }

  return (
    <form
      aria-labelledby={`${formId}-title`}
      onSubmit={(e) => {
        e.preventDefault();
        void submit(false);
      }}
      className="space-y-5"
    >
      <h2 id={`${formId}-title`} className="sr-only">
        Journal entry
      </h2>
      <div className="card grid gap-4 p-4 sm:grid-cols-[11rem_1fr_13rem]">
        <div>
          <Label htmlFor={`${formId}-date`}>Date</Label>
          <Input
            id={`${formId}-date`}
            type="date"
            value={entryDate}
            onChange={(e) => setEntryDate(e.target.value)}
            required
          />
        </div>
        <div>
          <Label htmlFor={`${formId}-memo`}>Memo</Label>
          <Input
            id={`${formId}-memo`}
            value={memo}
            maxLength={500}
            onChange={(e) => setMemo(e.target.value)}
            placeholder="What this entry records"
            required
          />
        </div>
        <div>
          <Label htmlFor={`${formId}-kind`}>Kind</Label>
          <Select
            id={`${formId}-kind`}
            value={kind}
            onChange={(e) => setKind(e.target.value as EntryFormValue["kind"])}
          >
            <option value="standard">Journal entry</option>
            <option value="opening">Opening balances</option>
          </Select>
        </div>
        {kind === "opening" ? (
          <p className="text-[13px] text-muted sm:col-span-3">
            Enter each balance from the accountant&apos;s 2026-09-30 figures: assets as debits, liabilities and net
            assets as credits, each in its fund.
          </p>
        ) : null}
      </div>

      <fieldset className="space-y-3">
        <legend className="mb-2 text-[15px] font-semibold">Lines</legend>
        {lines.map((line, index) => {
          const id = `${formId}-l${line.key}`;
          const projectChoices = line.programId
            ? projects.filter((p) => p.programId === line.programId)
            : projects;
          return (
            <div key={line.key} className="card grid gap-3 p-3 md:grid-cols-6" role="group" aria-label={`Line ${index + 1}`}>
              <div className="md:col-span-2">
                <Label htmlFor={`${id}-account`}>Account</Label>
                <Select
                  id={`${id}-account`}
                  value={line.accountId}
                  onChange={(e) => update(line.key, { accountId: e.target.value })}
                  required
                >
                  <option value="">Choose an account</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.label}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor={`${id}-fund`}>Fund</Label>
                <Select
                  id={`${id}-fund`}
                  value={line.fundId}
                  onChange={(e) => update(line.key, { fundId: e.target.value })}
                  required
                >
                  {funds.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.label}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor={`${id}-program`}>Program</Label>
                <Select
                  id={`${id}-program`}
                  value={line.programId}
                  onChange={(e) => update(line.key, { programId: e.target.value, projectId: "" })}
                >
                  <option value="">None</option>
                  {programs.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="md:col-span-2">
                <Label htmlFor={`${id}-project`}>Project</Label>
                <Select
                  id={`${id}-project`}
                  value={line.projectId}
                  onChange={(e) => update(line.key, { projectId: e.target.value })}
                >
                  <option value="">None</option>
                  {projectChoices.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="md:col-span-3">
                <Label htmlFor={`${id}-description`}>Description (optional)</Label>
                <Input
                  id={`${id}-description`}
                  value={line.description}
                  maxLength={500}
                  onChange={(e) => update(line.key, { description: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor={`${id}-debit`}>Debit</Label>
                <Input
                  id={`${id}-debit`}
                  inputMode="decimal"
                  value={line.debit}
                  onChange={(e) => update(line.key, { debit: e.target.value, credit: e.target.value ? "" : line.credit })}
                  className="text-right tabular-nums"
                />
              </div>
              <div>
                <Label htmlFor={`${id}-credit`}>Credit</Label>
                <Input
                  id={`${id}-credit`}
                  inputMode="decimal"
                  value={line.credit}
                  onChange={(e) => update(line.key, { credit: e.target.value, debit: e.target.value ? "" : line.debit })}
                  className="text-right tabular-nums"
                />
              </div>
              <div className="flex items-end">
                <Button
                  type="button"
                  variant="ghost"
                  disabled={lines.length <= 2}
                  onClick={() => setLines((current) => current.filter((l) => l.key !== line.key))}
                  aria-label={`Remove line ${index + 1}`}
                >
                  <Trash2 className="size-4" aria-hidden />
                  Remove
                </Button>
              </div>
            </div>
          );
        })}
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            setLines((current) => [...current, blank(nextKey)]);
            setNextKey((k) => k + 1);
          }}
        >
          <Plus className="size-4" aria-hidden />
          Add line
        </Button>
      </fieldset>

      <div className="card flex flex-wrap items-center justify-between gap-4 p-4">
        <dl className="flex flex-wrap gap-6 text-[14px]" aria-live="polite">
          <div>
            <dt className="text-[12.5px] text-muted">Debits</dt>
            <dd className="font-semibold tabular-nums">{formatCents(totals.debit)}</dd>
          </div>
          <div>
            <dt className="text-[12.5px] text-muted">Credits</dt>
            <dd className="font-semibold tabular-nums">{formatCents(totals.credit)}</dd>
          </div>
          <div>
            <dt className="text-[12.5px] text-muted">Difference</dt>
            <dd className={totals.difference === 0 ? "font-semibold tabular-nums" : "font-semibold tabular-nums text-danger-fg"}>
              {formatCents(Math.abs(totals.difference))}
              {totals.difference === 0 ? "" : totals.difference > 0 ? " more debits" : " more credits"}
            </dd>
          </div>
        </dl>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="secondary" loading={saving === "draft"} disabled={saving !== null}>
            Save draft
          </Button>
          <Button
            type="button"
            loading={saving === "post"}
            disabled={saving !== null || !totals.balanced}
            onClick={() => void submit(true)}
          >
            Save and post
          </Button>
        </div>
        <FieldHint>
          Posting is permanent. Each fund must balance on its own, and restricted funds only pay for their programs
          and dates.
        </FieldHint>
      </div>
      {error ? (
        <p role="alert" className="text-[13.5px] text-danger-fg">
          {error}
        </p>
      ) : null}
    </form>
  );
}
