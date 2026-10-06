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
import { INSTITUTION_KEY } from "@/features/banking/labels";
import { useT } from "@/lib/i18n/client";

export interface Choice {
  id: string;
  label: string;
}

function useAction() {
  const t = useT();
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
      setError(result.error ?? t("ui.somethingWrong"));
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
  const t = useT();
  const [open, setOpen] = useState(false);
  const { pending, error, run } = useAction();
  return (
    <>
      {account ? (
        <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
          <Pencil className="size-4" aria-hidden />
          {t("finance.bank.forms.accountDialog.edit")}
        </Button>
      ) : (
        <Button onClick={() => setOpen(true)}>
          <Plus className="size-4" aria-hidden />
          {t("finance.bank.forms.accountDialog.add")}
        </Button>
      )}
      <Dialog open={open} onClose={() => setOpen(false)} title={account ? t("finance.bank.forms.accountDialog.editTitle", { name: account.name }) : t("finance.bank.forms.accountDialog.addTitle")}>
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
              t("finance.bank.forms.accountDialog.saved"),
            );
            if (ok) setOpen(false);
          }}
        >
          <div>
            <Label htmlFor="bank-name">{t("finance.bank.forms.accountDialog.name")}</Label>
            <Input id="bank-name" name="name" maxLength={120} required defaultValue={account?.name} placeholder={t("finance.bank.forms.accountDialog.namePlaceholder")} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="bank-institution">{t("finance.bank.forms.accountDialog.bank")}</Label>
              <Select id="bank-institution" name="institution" defaultValue={account?.institution ?? "desjardins"}>
                {Object.entries(INSTITUTION_KEY).map(([value, key]) => (
                  <option key={value} value={value}>
                    {t(key)}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="bank-last4">{t("finance.bank.forms.accountDialog.last4")}</Label>
              <Input
                id="bank-last4"
                name="accountLast4"
                inputMode="numeric"
                pattern="\d{4}"
                maxLength={4}
                defaultValue={account?.account_last4 ?? ""}
              />
              <FieldHint>{t("finance.bank.forms.accountDialog.last4Hint")}</FieldHint>
            </div>
          </div>
          <div>
            <Label htmlFor="bank-ledger">{t("finance.bank.forms.accountDialog.ledgerAccount")}</Label>
            <Select id="bank-ledger" name="ledgerAccountId" required defaultValue={account?.ledger_account_id ?? ""}>
              <option value="">{t("finance.bank.choose")}</option>
              {cashAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </Select>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="bank-fund">{t("finance.bank.forms.accountDialog.fund")}</Label>
              <Select id="bank-fund" name="defaultFundId" required defaultValue={account?.default_fund_id ?? defaultFundId}>
                {funds.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="bank-from">{t("finance.bank.forms.accountDialog.reconcileFrom")}</Label>
              <Input
                id="bank-from"
                name="reconcileFrom"
                type="date"
                required
                defaultValue={account?.reconcile_from ?? "2026-10-01"}
              />
              <FieldHint>{t("finance.bank.forms.accountDialog.reconcileFromHint")}</FieldHint>
            </div>
          </div>
          {account ? (
            <label className="flex items-center gap-2 text-[13.5px]">
              <Checkbox name="isActive" defaultChecked={account.is_active} />
              {t("finance.bank.forms.accountDialog.active")}
            </label>
          ) : null}
          <FormError error={error} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              {t("finance.common.cancel")}
            </Button>
            <Button type="submit" loading={pending}>
              {t("finance.common.save")}
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
  const t = useT();
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
          setError(t("finance.bank.forms.import.chooseFile"));
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
            setError(t("finance.bank.forms.import.chooseColumns"));
            return;
          }
        }
        await run(
          () => importStatement({ bankAccountId, fileName: file.name, text: file.text, layout, mapping }),
          (r) =>
            t(
              r.skipped
                ? r.added === 1
                  ? "finance.bank.forms.import.importedOneSkipped"
                  : "finance.bank.forms.import.importedOtherSkipped"
                : r.added === 1
                  ? "finance.bank.forms.import.importedOne"
                  : "finance.bank.forms.import.importedOther",
              { added: String(r.added), skipped: String(r.skipped) },
            ),
        );
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="statement-file">{t("finance.bank.forms.import.file")}</Label>
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
                setError(t("finance.bank.forms.import.tooLarge"));
                return;
              }
              const text = await readStatementText(chosen);
              setFile({ name: chosen.name, text });
              setHeader(readCsv(text.split(/\r?\n/).slice(0, 12).join("\n"))[0] ?? []);
            }}
          />
          <FieldHint>{t("finance.bank.forms.import.fileHint")}</FieldHint>
        </div>
        <div>
          <Label htmlFor="statement-layout">{t("finance.bank.forms.import.layout")}</Label>
          <Select
            id="statement-layout"
            value={isOfx ? "ofx" : layout}
            disabled={isOfx}
            onChange={(e) => setLayout(e.currentTarget.value)}
          >
            {isOfx ? <option value="ofx">{t("finance.bank.forms.import.ofx")}</option> : null}
            {CSV_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {t("finance.bank.forms.import.presetCsv", { bank: t(`finance.bank.presets.${p.institution}`) })}
              </option>
            ))}
            <option value="custom">{t("finance.bank.forms.import.custom")}</option>
          </Select>
        </div>
      </div>

      {layout === "custom" && !isOfx ? (
        <fieldset className="space-y-3 rounded-(--radius-sm) border border-line p-3">
          <legend className="px-1 text-[13px] font-medium">{t("finance.bank.forms.import.columns")}</legend>
          {header.length === 0 ? (
            <p className="text-[13px] text-muted">{t("finance.bank.forms.import.chooseFileForColumns")}</p>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-3">
                <ColumnSelect name="dateColumn" label={t("finance.bank.forms.import.date")} header={header} />
                <div>
                  <Label htmlFor="col-dateOrder">{t("finance.bank.forms.import.dateOrder")}</Label>
                  <Select id="col-dateOrder" name="dateOrder" defaultValue="ymd">
                    <option value="ymd">{t("finance.bank.forms.import.ymd")}</option>
                    <option value="mdy">{t("finance.bank.forms.import.mdy")}</option>
                    <option value="dmy">{t("finance.bank.forms.import.dmy")}</option>
                  </Select>
                </div>
                <ColumnSelect name="descriptionColumn" label={t("finance.bank.forms.import.description")} header={header} />
                <ColumnSelect name="amountColumn" label={t("finance.bank.forms.import.signedAmount")} header={header} optional />
                <ColumnSelect name="withdrawalColumn" label={t("finance.bank.forms.import.withdrawals")} header={header} optional />
                <ColumnSelect name="depositColumn" label={t("finance.bank.forms.import.deposits")} header={header} optional />
                <ColumnSelect name="referenceColumn" label={t("finance.bank.forms.import.reference")} header={header} optional />
              </div>
              <div className="flex flex-wrap gap-4 text-[13.5px]">
                <label className="flex items-center gap-2">
                  <Checkbox name="hasHeader" defaultChecked />
                  {t("finance.bank.forms.import.hasHeader")}
                </label>
                <label className="flex items-center gap-2">
                  <Checkbox name="negate" />
                  {t("finance.bank.forms.import.negate")}
                </label>
              </div>
            </>
          )}
        </fieldset>
      ) : null}

      <FormError error={error} />
      <Button type="submit" loading={pending} disabled={!file}>
        <Upload className="size-4" aria-hidden />
        {t("finance.bank.forms.import.submit")}
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
  const t = useT();
  return (
    <div>
      <Label htmlFor={`col-${name}`}>{label}</Label>
      <Select id={`col-${name}`} name={name} defaultValue={COLUMN_NONE}>
        <option value={COLUMN_NONE}>{optional ? t("finance.common.none") : t("finance.bank.choose")}</option>
        {header.map((h, i) => (
          <option key={i} value={String(i)}>
            {h
              ? t("finance.bank.forms.import.columnWithHeader", { number: i + 1, header: h.slice(0, 30) })
              : t("finance.bank.forms.import.column", { number: i + 1 })}
          </option>
        ))}
      </Select>
    </div>
  );
}

export function DeleteImportButton({ importId, fileName }: { importId: string; fileName: string }) {
  const t = useT();
  const { pending, error, run } = useAction();
  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        size="sm"
        variant="ghost"
        loading={pending}
        aria-label={t("finance.bank.forms.import.deleteLabel", { file: fileName })}
        onClick={() => {
          if (!window.confirm(t("finance.bank.forms.import.deleteConfirm", { file: fileName }))) return;
          void run(() => deleteImport(importId), t("finance.bank.forms.import.deleted"));
        }}
      >
        {t("finance.bank.delete")}
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
  const t = useT();
  const { pending, error, run } = useAction();
  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        variant="secondary"
        loading={pending}
        disabled={pairs.length === 0}
        onClick={() =>
          void run(
            () => acceptSuggestions(pairs),
            (r) =>
              t(r.matched === 1 ? "finance.bank.forms.matching.matchedOne" : "finance.bank.forms.matching.matchedOther", {
                count: String(r.matched),
              }),
          )
        }
      >
        {t("finance.bank.forms.matching.acceptAll", { count: pairs.length })}
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
  const t = useT();
  const { pending, error, run } = useAction();
  const [choice, setChoice] = useState("");
  const [creating, setCreating] = useState(false);
  if (locked) return <span className="meta">{t("finance.bank.reconciled")}</span>;
  if (matched) {
    return (
      <Button
        size="sm"
        variant="ghost"
        loading={pending}
        aria-label={t("finance.bank.forms.matching.unmatchLabel", { description })}
        onClick={() => void run(() => unmatchLine(transactionId), t("finance.bank.forms.matching.unmatched"))}
      >
        {t("finance.bank.forms.matching.unmatch")}
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
            aria-label={t("finance.bank.forms.matching.acceptLabel", { description })}
            onClick={() =>
              void run(
                () => matchLine(transactionId, suggestion.journalLineId, "suggested"),
                t("finance.bank.forms.matching.matched"),
              )
            }
          >
            {t("finance.bank.forms.matching.accept")}
          </Button>
        ) : null}
        {options.length > 0 ? (
          <>
            <Select
              aria-label={t("finance.bank.forms.matching.lineLabel", { description })}
              className="h-8 w-44 text-[13px]"
              value={choice}
              onChange={(e) => setChoice(e.currentTarget.value)}
            >
              <option value="">{t("finance.bank.forms.matching.matchTo")}</option>
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
              aria-label={t("finance.bank.forms.matching.matchLabel", { description })}
              onClick={() => void run(() => matchLine(transactionId, choice, "manual"), t("finance.bank.forms.matching.matched"))}
            >
              {t("finance.bank.forms.matching.match")}
            </Button>
          </>
        ) : null}
        <Button
          size="sm"
          variant="secondary"
          aria-label={t("finance.bank.forms.matching.createLabel", { description })}
          onClick={() => setCreating(true)}
        >
          {t("finance.bank.forms.matching.create")}
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
  const t = useT();
  const { pending, error, run } = useAction();
  return (
    <Dialog open={open} onClose={onClose} title={t("finance.bank.forms.entry.title")}>
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
            t("finance.bank.forms.entry.posted"),
          );
          if (ok) onClose();
        }}
      >
        <p className="text-[13.5px] text-muted">{t("finance.bank.forms.entry.explanation")}</p>
        <div>
          <Label htmlFor={`entry-account-${transactionId}`}>{t("finance.bank.forms.entry.otherAccount")}</Label>
          <Select id={`entry-account-${transactionId}`} name="accountId" required defaultValue="">
            <option value="">{t("finance.bank.choose")}</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor={`entry-fund-${transactionId}`}>{t("finance.common.fund")}</Label>
            <Select id={`entry-fund-${transactionId}`} name="fundId" defaultValue={defaultFundId}>
              {funds.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor={`entry-program-${transactionId}`}>{t("finance.bank.forms.entry.program")}</Label>
            <Select id={`entry-program-${transactionId}`} name="programId" defaultValue="">
              <option value="">{t("finance.common.none")}</option>
              {programs.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </Select>
          </div>
        </div>
        <div>
          <Label htmlFor={`entry-memo-${transactionId}`}>{t("finance.common.memo")}</Label>
          <Input id={`entry-memo-${transactionId}`} name="memo" maxLength={500} defaultValue={description} />
        </div>
        <FormError error={error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t("finance.common.cancel")}
          </Button>
          <Button type="submit" loading={pending}>
            {t("finance.bank.forms.entry.submit")}
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
  const t = useT();
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
          t("finance.bank.forms.reconcile.started"),
        );
        if (result?.id) router.push(`/finance/bank/reconciliations/${result.id}`);
      }}
    >
      <div>
        <Label htmlFor="rec-start">{t("finance.bank.forms.reconcile.from")}</Label>
        <Input id="rec-start" name="statementStart" type="date" required defaultValue={defaultStart} />
      </div>
      <div>
        <Label htmlFor="rec-end">{t("finance.bank.forms.reconcile.to")}</Label>
        <Input id="rec-end" name="statementEnd" type="date" required defaultValue={defaultEnd} />
      </div>
      <div>
        <Label htmlFor="rec-opening">{t("finance.bank.forms.reconcile.opening")}</Label>
        <Input id="rec-opening" name="openingBalance" inputMode="decimal" required defaultValue={defaultOpening} />
      </div>
      <div>
        <Label htmlFor="rec-closing">{t("finance.bank.forms.reconcile.closing")}</Label>
        <Input id="rec-closing" name="closingBalance" inputMode="decimal" required placeholder={t("finance.bank.forms.reconcile.closingPlaceholder")} />
      </div>
      <Button type="submit" loading={pending}>
        {t("finance.bank.forms.reconcile.start")}
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
  const t = useT();
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
          t("finance.bank.forms.reconcile.balancesSaved"),
        );
      }}
    >
      <div>
        <Label htmlFor="bal-opening">{t("finance.bank.reconciliation.figures.opening")}</Label>
        <Input id="bal-opening" name="openingBalance" inputMode="decimal" required defaultValue={opening} />
      </div>
      <div>
        <Label htmlFor="bal-closing">{t("finance.bank.reconciliation.figures.closing")}</Label>
        <Input id="bal-closing" name="closingBalance" inputMode="decimal" required defaultValue={closing} />
      </div>
      <Button type="submit" variant="secondary" loading={pending}>
        {t("finance.bank.forms.reconcile.saveBalances")}
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
  const t = useT();
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
                if (!window.confirm(t("finance.bank.forms.reconcile.deleteConfirm"))) return;
                const ok = await run(() => deleteReconciliation(reconciliationId), t("finance.bank.forms.reconcile.deleted"));
                if (ok) router.push(`/finance/bank/${bankAccountId}`);
              }}
            >
              {t("finance.bank.delete")}
            </Button>
            <Button
              loading={pending}
              disabled={!canClose}
              onClick={() =>
                void run(
                  () => setReconciliationStatus(reconciliationId, "reconciled"),
                  t("finance.bank.forms.reconcile.reconciled"),
                )
              }
            >
              {t("finance.bank.forms.reconcile.markReconciled")}
            </Button>
          </>
        ) : (
          <Button
            variant="secondary"
            loading={pending}
            onClick={() => {
              if (!window.confirm(t("finance.bank.forms.reconcile.reopenConfirm"))) return;
              void run(() => setReconciliationStatus(reconciliationId, "open"), t("finance.bank.forms.reconcile.reopened"));
            }}
          >
            {t("finance.bank.forms.reconcile.reopen")}
          </Button>
        )}
      </div>
      <FormError error={error} />
    </div>
  );
}
