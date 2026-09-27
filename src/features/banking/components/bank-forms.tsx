"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Pencil, Plus, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Checkbox, FieldHint, Input, Label, Select } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { CSV_PRESETS, readCsv, type CsvMapping, type DateOrder } from "@/features/banking/parsers";
import {
  acceptSuggestions,
  createEntryFromLine,
  deleteImport,
  deleteReconciliation,
  importStatement,
  matchLine,
  saveBankAccount,
  setReconciliationStatus,
  startReconciliation,
  unmatchLine,
  updateReconciliationBalances,
} from "@/features/banking/services/bank.commands";
import type { ActionResult } from "@/features/tasks/services/task.commands";

export interface Choice {
  id: string;
  label: string;
}

function useAction() {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run<T extends ActionResult>(action: () => Promise<T>, success: string | ((r: T) => string)) {
    setPending(true);
    setError(null);
    const result = await action();
    setPending(false);
    if (!result.ok) {
      setError(result.error ?? "Something went wrong. Try again.");
      router.refresh();
      return null;
    }
    toast(typeof success === "function" ? success(result) : success, { tone: "success" });
    router.refresh();
    return result;
  }
  return { pending, error, setError, run };
}

function FormError({ error }: { error: string | null }) {
  return error ? (
    <p role="alert" className="text-[13px] text-danger-fg">
      {error}
    </p>
  ) : null;
}

// ---------------------------------------------------------------------------
// Bank accounts
// ---------------------------------------------------------------------------

export const INSTITUTION_LABEL: Record<string, string> = {
  desjardins: "Desjardins",
  national_bank: "National Bank",
  rbc: "RBC Royal Bank",
  td: "TD Canada Trust",
  bmo: "BMO Bank of Montreal",
  other: "Other bank",
};

export interface BankAccountValue {
  id: string;
  name: string;
  institution: string;
  account_last4: string | null;
  ledger_account_id: string;
  default_fund_id: string;
  reconcile_from: string;
  is_active: boolean;
}

export function BankAccountDialog({
  account,
  cashAccounts,
  funds,
  defaultFundId,
}: {
  account?: BankAccountValue;
  cashAccounts: Choice[];
  funds: Choice[];
  defaultFundId: string;
}) {
  const [open, setOpen] = useState(false);
  const { pending, error, run } = useAction();
  return (
    <>
      {account ? (
        <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
          <Pencil className="size-4" aria-hidden />
          Edit account
        </Button>
      ) : (
        <Button onClick={() => setOpen(true)}>
          <Plus className="size-4" aria-hidden />
          Add bank account
        </Button>
      )}
      <Dialog open={open} onClose={() => setOpen(false)} title={account ? `Edit ${account.name}` : "Add a bank account"}>
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            const ok = await run(
              () =>
                saveBankAccount({
                  id: account?.id,
                  name: form.get("name"),
                  institution: form.get("institution"),
                  accountLast4: form.get("accountLast4") ?? "",
                  ledgerAccountId: form.get("ledgerAccountId"),
                  defaultFundId: form.get("defaultFundId"),
                  reconcileFrom: form.get("reconcileFrom"),
                  isActive: account ? form.get("isActive") === "on" : true,
                }),
              "Bank account saved.",
            );
            if (ok) setOpen(false);
          }}
        >
          <div>
            <Label htmlFor="bank-name">Name</Label>
            <Input id="bank-name" name="name" maxLength={120} required defaultValue={account?.name} placeholder="Chequing" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="bank-institution">Bank</Label>
              <Select id="bank-institution" name="institution" defaultValue={account?.institution ?? "desjardins"}>
                {Object.entries(INSTITUTION_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="bank-last4">Last four digits</Label>
              <Input
                id="bank-last4"
                name="accountLast4"
                inputMode="numeric"
                pattern="\d{4}"
                maxLength={4}
                defaultValue={account?.account_last4 ?? ""}
              />
              <FieldHint>Only the last four; the full number is never stored.</FieldHint>
            </div>
          </div>
          <div>
            <Label htmlFor="bank-ledger">Ledger cash account</Label>
            <Select id="bank-ledger" name="ledgerAccountId" required defaultValue={account?.ledger_account_id ?? ""}>
              <option value="">Choose…</option>
              {cashAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </Select>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="bank-fund">Fund for entries created here</Label>
              <Select id="bank-fund" name="defaultFundId" required defaultValue={account?.default_fund_id ?? defaultFundId}>
                {funds.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="bank-from">Reconcile from</Label>
              <Input
                id="bank-from"
                name="reconcileFrom"
                type="date"
                required
                defaultValue={account?.reconcile_from ?? "2026-10-01"}
              />
              <FieldHint>Ledger lines before this day made up the opening balance.</FieldHint>
            </div>
          </div>
          {account ? (
            <label className="flex items-center gap-2 text-[13.5px]">
              <Checkbox name="isActive" defaultChecked={account.is_active} />
              Active (statements can be imported)
            </label>
          ) : null}
          <FormError error={error} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={pending}>
              Save
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

/** Reads a statement as UTF-8, or Windows-1252 when it is not valid UTF-8. */
async function readStatementText(file: File): Promise<string> {
  const bytes = await file.arrayBuffer();
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

const COLUMN_NONE = "-1";

export function ImportStatementForm({ bankAccountId, institution }: { bankAccountId: string; institution: string }) {
  const { pending, error, setError, run } = useAction();
  const defaultLayout = CSV_PRESETS.some((p) => p.id === institution) ? institution : "custom";
  const [layout, setLayout] = useState(defaultLayout);
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [header, setHeader] = useState<string[]>([]);
  const isOfx = Boolean(file && /\.(ofx|qfx)$/i.test(file.name));

  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!file) {
          setError("Choose a statement file.");
          return;
        }
        const form = new FormData(e.currentTarget);
        let mapping: CsvMapping | undefined;
        if (layout === "custom" && !isOfx) {
          const n = (name: string) => Number(form.get(name) ?? COLUMN_NONE);
          const withdrawal = n("withdrawalColumn");
          const deposit = n("depositColumn");
          const signed = n("amountColumn");
          const reference = n("referenceColumn");
          mapping = {
            dateColumn: n("dateColumn"),
            dateOrder: (form.get("dateOrder") as DateOrder) ?? "ymd",
            descriptionColumns: [n("descriptionColumn")],
            amount:
              signed >= 0
                ? { kind: "signed", column: signed, negate: form.get("negate") === "on" }
                : { kind: "split", withdrawal, deposit },
            referenceColumn: reference >= 0 ? reference : null,
            skipRows: form.get("hasHeader") === "on" ? 1 : 0,
          };
          if (mapping.dateColumn < 0 || mapping.descriptionColumns[0] < 0 || (signed < 0 && (withdrawal < 0 || deposit < 0))) {
            setError("Choose the date, description and amount columns.");
            return;
          }
        }
        await run(
          () => importStatement({ bankAccountId, fileName: file.name, text: file.text, layout, mapping }),
          (r) =>
            `Imported ${r.added} new line${r.added === 1 ? "" : "s"}` +
            (r.skipped ? `; ${r.skipped} already imported were skipped.` : "."),
        );
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="statement-file">Statement file (CSV, OFX or QFX)</Label>
          <Input
            id="statement-file"
            type="file"
            accept=".csv,.txt,.ofx,.qfx,text/csv"
            className="py-1.5"
            onChange={async (e) => {
              const chosen = e.currentTarget.files?.[0];
              setError(null);
              if (!chosen) {
                setFile(null);
                return;
              }
              if (chosen.size > 900_000) {
                setFile(null);
                setError("The file is too large. Export a shorter date range.");
                return;
              }
              const text = await readStatementText(chosen);
              setFile({ name: chosen.name, text });
              setHeader(readCsv(text.split(/\r?\n/).slice(0, 12).join("\n"))[0] ?? []);
            }}
          />
          <FieldHint>Download it from online banking. Importing a file twice adds nothing twice.</FieldHint>
        </div>
        <div>
          <Label htmlFor="statement-layout">File layout</Label>
          <Select
            id="statement-layout"
            value={isOfx ? "ofx" : layout}
            disabled={isOfx}
            onChange={(e) => setLayout(e.currentTarget.value)}
          >
            {isOfx ? <option value="ofx">OFX / QFX (read automatically)</option> : null}
            {CSV_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label} CSV
              </option>
            ))}
            <option value="custom">Other CSV: choose the columns</option>
          </Select>
        </div>
      </div>

      {layout === "custom" && !isOfx ? (
        <fieldset className="space-y-3 rounded-(--radius-sm) border border-line p-3">
          <legend className="px-1 text-[13px] font-medium">Columns</legend>
          {header.length === 0 ? (
            <p className="text-[13px] text-muted">Choose a file to list its columns.</p>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-3">
                <ColumnSelect name="dateColumn" label="Date" header={header} />
                <div>
                  <Label htmlFor="col-dateOrder">Date order</Label>
                  <Select id="col-dateOrder" name="dateOrder" defaultValue="ymd">
                    <option value="ymd">Year, month, day</option>
                    <option value="mdy">Month, day, year</option>
                    <option value="dmy">Day, month, year</option>
                  </Select>
                </div>
                <ColumnSelect name="descriptionColumn" label="Description" header={header} />
                <ColumnSelect name="amountColumn" label="Signed amount" header={header} optional />
                <ColumnSelect name="withdrawalColumn" label="Or: withdrawals" header={header} optional />
                <ColumnSelect name="depositColumn" label="and deposits" header={header} optional />
                <ColumnSelect name="referenceColumn" label="Reference (optional)" header={header} optional />
              </div>
              <div className="flex flex-wrap gap-4 text-[13.5px]">
                <label className="flex items-center gap-2">
                  <Checkbox name="hasHeader" defaultChecked />
                  The first row is a header
                </label>
                <label className="flex items-center gap-2">
                  <Checkbox name="negate" />
                  Withdrawals are positive in the signed column
                </label>
              </div>
            </>
          )}
        </fieldset>
      ) : null}

      <FormError error={error} />
      <Button type="submit" loading={pending} disabled={!file}>
        <Upload className="size-4" aria-hidden />
        Import statement
      </Button>
    </form>
  );
}

function ColumnSelect({
  name,
  label,
  header,
  optional,
}: {
  name: string;
  label: string;
  header: string[];
  optional?: boolean;
}) {
  return (
    <div>
      <Label htmlFor={`col-${name}`}>{label}</Label>
      <Select id={`col-${name}`} name={name} defaultValue={COLUMN_NONE}>
        <option value={COLUMN_NONE}>{optional ? "None" : "Choose…"}</option>
        {header.map((h, i) => (
          <option key={i} value={String(i)}>
            {`Column ${i + 1}${h ? `: ${h.slice(0, 30)}` : ""}`}
          </option>
        ))}
      </Select>
    </div>
  );
}

export function DeleteImportButton({ importId, fileName }: { importId: string; fileName: string }) {
  const { pending, error, run } = useAction();
  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        size="sm"
        variant="ghost"
        loading={pending}
        aria-label={`Delete import ${fileName}`}
        onClick={() => {
          if (!window.confirm(`Delete the lines imported from ${fileName}?`)) return;
          void run(() => deleteImport(importId), "Import deleted.");
        }}
      >
        Delete
      </Button>
      <FormError error={error} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

export interface MatchOption {
  journalLineId: string;
  label: string;
}

export function AcceptSuggestionsButton({ pairs }: { pairs: { transactionId: string; journalLineId: string }[] }) {
  const { pending, error, run } = useAction();
  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        variant="secondary"
        loading={pending}
        disabled={pairs.length === 0}
        onClick={() =>
          void run(() => acceptSuggestions(pairs), (r) => `Matched ${r.matched} line${r.matched === 1 ? "" : "s"}.`)
        }
      >
        Accept all {pairs.length} suggestions
      </Button>
      <FormError error={error} />
    </div>
  );
}

export function StatementLineActions({
  transactionId,
  description,
  matched,
  locked,
  suggestion,
  options,
  accounts,
  funds,
  programs,
  defaultFundId,
}: {
  transactionId: string;
  description: string;
  matched: boolean;
  locked: boolean;
  suggestion: MatchOption | null;
  options: MatchOption[];
  accounts: Choice[];
  funds: Choice[];
  programs: Choice[];
  defaultFundId: string;
}) {
  const { pending, error, run } = useAction();
  const [choice, setChoice] = useState("");
  const [creating, setCreating] = useState(false);
  if (locked) return <span className="meta">Reconciled</span>;
  if (matched) {
    return (
      <Button
        size="sm"
        variant="ghost"
        loading={pending}
        aria-label={`Unmatch ${description}`}
        onClick={() => void run(() => unmatchLine(transactionId), "Match undone.")}
      >
        Unmatch
      </Button>
    );
  }
  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex flex-wrap items-center justify-end gap-1.5">
        {suggestion ? (
          <Button
            size="sm"
            loading={pending}
            aria-label={`Accept suggested match for ${description}`}
            onClick={() => void run(() => matchLine(transactionId, suggestion.journalLineId, "suggested"), "Matched.")}
          >
            Accept
          </Button>
        ) : null}
        {options.length > 0 ? (
          <>
            <Select
              aria-label={`Ledger line for ${description}`}
              className="h-8 w-44 text-[13px]"
              value={choice}
              onChange={(e) => setChoice(e.currentTarget.value)}
            >
              <option value="">Match to…</option>
              {options.map((o) => (
                <option key={o.journalLineId} value={o.journalLineId}>
                  {o.label}
                </option>
              ))}
            </Select>
            <Button
              size="sm"
              variant="secondary"
              disabled={!choice || pending}
              aria-label={`Match ${description}`}
              onClick={() => void run(() => matchLine(transactionId, choice, "manual"), "Matched.")}
            >
              Match
            </Button>
          </>
        ) : null}
        <Button
          size="sm"
          variant="secondary"
          aria-label={`Create entry for ${description}`}
          onClick={() => setCreating(true)}
        >
          Create entry
        </Button>
      </div>
      <FormError error={error} />
      <CreateEntryDialog
        open={creating}
        onClose={() => setCreating(false)}
        transactionId={transactionId}
        description={description}
        accounts={accounts}
        funds={funds}
        programs={programs}
        defaultFundId={defaultFundId}
      />
    </div>
  );
}

function CreateEntryDialog({
  open,
  onClose,
  transactionId,
  description,
  accounts,
  funds,
  programs,
  defaultFundId,
}: {
  open: boolean;
  onClose: () => void;
  transactionId: string;
  description: string;
  accounts: Choice[];
  funds: Choice[];
  programs: Choice[];
  defaultFundId: string;
}) {
  const { pending, error, run } = useAction();
  return (
    <Dialog open={open} onClose={onClose} title="Create a ledger entry">
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          const form = new FormData(e.currentTarget);
          const ok = await run(
            () =>
              createEntryFromLine({
                transactionId,
                accountId: form.get("accountId"),
                fundId: form.get("fundId") ?? "",
                programId: form.get("programId") ?? "",
                memo: form.get("memo") ?? "",
              }),
            "Entry posted and matched.",
          );
          if (ok) onClose();
        }}
      >
        <p className="text-[13.5px] text-muted">
          Posts a two-line entry on the statement date, against the bank&apos;s cash account, and matches it to this
          line. It is permanent; a mistake is corrected by reversing the entry in the journal.
        </p>
        <div>
          <Label htmlFor={`entry-account-${transactionId}`}>Other account</Label>
          <Select id={`entry-account-${transactionId}`} name="accountId" required defaultValue="">
            <option value="">Choose…</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor={`entry-fund-${transactionId}`}>Fund</Label>
            <Select id={`entry-fund-${transactionId}`} name="fundId" defaultValue={defaultFundId}>
              {funds.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor={`entry-program-${transactionId}`}>Program (optional)</Label>
            <Select id={`entry-program-${transactionId}`} name="programId" defaultValue="">
              <option value="">None</option>
              {programs.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </Select>
          </div>
        </div>
        <div>
          <Label htmlFor={`entry-memo-${transactionId}`}>Memo</Label>
          <Input id={`entry-memo-${transactionId}`} name="memo" maxLength={500} defaultValue={description} />
        </div>
        <FormError error={error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={pending}>
            Post and match
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Reconciliations
// ---------------------------------------------------------------------------

export function StartReconciliationForm({
  bankAccountId,
  defaultStart,
  defaultEnd,
  defaultOpening,
}: {
  bankAccountId: string;
  defaultStart: string;
  defaultEnd: string;
  defaultOpening: string;
}) {
  const router = useRouter();
  const { pending, error, run } = useAction();
  return (
    <form
      className="grid gap-3 sm:grid-cols-[repeat(4,minmax(0,1fr))_auto] sm:items-end"
      onSubmit={async (e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        const result = await run(
          () =>
            startReconciliation({
              bankAccountId,
              statementStart: form.get("statementStart"),
              statementEnd: form.get("statementEnd"),
              openingBalance: form.get("openingBalance"),
              closingBalance: form.get("closingBalance"),
            }),
          "Reconciliation started.",
        );
        if (result?.id) router.push(`/finance/bank/reconciliations/${result.id}`);
      }}
    >
      <div>
        <Label htmlFor="rec-start">Statement from</Label>
        <Input id="rec-start" name="statementStart" type="date" required defaultValue={defaultStart} />
      </div>
      <div>
        <Label htmlFor="rec-end">Statement to</Label>
        <Input id="rec-end" name="statementEnd" type="date" required defaultValue={defaultEnd} />
      </div>
      <div>
        <Label htmlFor="rec-opening">Opening balance</Label>
        <Input id="rec-opening" name="openingBalance" inputMode="decimal" required defaultValue={defaultOpening} />
      </div>
      <div>
        <Label htmlFor="rec-closing">Closing balance</Label>
        <Input id="rec-closing" name="closingBalance" inputMode="decimal" required placeholder="From the statement" />
      </div>
      <Button type="submit" loading={pending}>
        Start reconciliation
      </Button>
      <div className="sm:col-span-5">
        <FormError error={error} />
      </div>
    </form>
  );
}

export function ReconciliationBalancesForm({
  reconciliationId,
  opening,
  closing,
}: {
  reconciliationId: string;
  opening: string;
  closing: string;
}) {
  const { pending, error, run } = useAction();
  return (
    <form
      className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        void run(
          () =>
            updateReconciliationBalances({
              reconciliationId,
              openingBalance: form.get("openingBalance"),
              closingBalance: form.get("closingBalance"),
            }),
          "Balances saved.",
        );
      }}
    >
      <div>
        <Label htmlFor="bal-opening">Statement opening balance</Label>
        <Input id="bal-opening" name="openingBalance" inputMode="decimal" required defaultValue={opening} />
      </div>
      <div>
        <Label htmlFor="bal-closing">Statement closing balance</Label>
        <Input id="bal-closing" name="closingBalance" inputMode="decimal" required defaultValue={closing} />
      </div>
      <Button type="submit" variant="secondary" loading={pending}>
        Save balances
      </Button>
      <div className="sm:col-span-3">
        <FormError error={error} />
      </div>
    </form>
  );
}

export function ReconciliationStatusActions({
  reconciliationId,
  status,
  canClose,
  bankAccountId,
}: {
  reconciliationId: string;
  status: "open" | "reconciled";
  canClose: boolean;
  bankAccountId: string;
}) {
  const router = useRouter();
  const { pending, error, run } = useAction();
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap justify-end gap-2">
        {status === "open" ? (
          <>
            <Button
              variant="ghost"
              disabled={pending}
              onClick={async () => {
                if (!window.confirm("Delete this reconciliation? Matches stay as they are.")) return;
                const ok = await run(() => deleteReconciliation(reconciliationId), "Reconciliation deleted.");
                if (ok) router.push(`/finance/bank/${bankAccountId}`);
              }}
            >
              Delete
            </Button>
            <Button
              loading={pending}
              disabled={!canClose}
              onClick={() => void run(() => setReconciliationStatus(reconciliationId, "reconciled"), "Statement reconciled.")}
            >
              Mark reconciled
            </Button>
          </>
        ) : (
          <Button
            variant="secondary"
            loading={pending}
            onClick={() => {
              if (!window.confirm("Reopen this statement? Its lines can then be changed again.")) return;
              void run(() => setReconciliationStatus(reconciliationId, "open"), "Statement reopened.");
            }}
          >
            Reopen
          </Button>
        )}
      </div>
      <FormError error={error} />
    </div>
  );
}
