"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Plus, Settings2, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FieldHint, Input, Label, Select } from "@/components/ui/input";
import { DataTable, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import type { ActionResult } from "@/features/tasks/services/task.commands";
import type { DateOrder } from "@/features/banking/parsers";
import { centsToDecimal, formatCents } from "@/features/finance/money";
import {
  PAYROLL_CATEGORIES,
  PAYROLL_PROVIDERS,
  categoryLabel,
  employeeDeductions,
  employerContributions,
  providerLabel,
  type PayrollProvider,
} from "@/features/payroll/categories";
import {
  REQUIRED_FIELDS,
  fieldLabel,
  guessHeaderRow,
  guessMapping,
  parsePayrollFile,
  readCsv,
  type PayrollField,
  type PayrollMapping,
} from "@/features/payroll/parsers";
import {
  deletePayrollDraft,
  importPayrollRuns,
  postPayrollRun,
  reversePayrollRun,
  savePayrollAccountMap,
  savePayrollAllocation,
} from "@/features/payroll/services/payroll.commands";
import type { AccountMapRow, Allocation, PayrollOptions } from "@/features/payroll/services/payroll.queries";
import { useLocale, useT } from "@/lib/i18n/client";

function FormError({ error }: { error: string | null }) {
  return error ? (
    <p role="alert" className="text-[13px] text-danger-fg">
      {error}
    </p>
  ) : null;
}

/** Runs an action, reports its error, and refreshes or moves on when it works. */
function useAction() {
  const router = useRouter();
  const { toast } = useToast();
  const t = useT();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function run<T extends ActionResult>(
    key: string,
    action: () => Promise<T>,
    success: string | ((result: T) => string),
    then?: (result: T) => void,
  ) {
    setPending(key);
    setError(null);
    const result = await action();
    setPending(null);
    if (!result.ok) {
      setError(result.error ?? t("finance.payroll.errors.generic"));
      return false;
    }
    toast(typeof success === "string" ? success : success(result), { tone: "success" });
    if (then) then(result);
    else router.refresh();
    return true;
  }
  return { pending, error, setError, run, router, t };
}

async function readFileText(file: File): Promise<string> {
  const bytes = await file.arrayBuffer();
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

async function sha256Hex(text: string): Promise<string | null> {
  try {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return null;
  }
}

const MAPPABLE: PayrollField[] = [
  "payDate",
  "periodStart",
  "periodEnd",
  "runReference",
  ...PAYROLL_CATEGORIES.map((c) => c.key),
];
const NONE = "-1";

/**
 * Reads a payroll export in the browser and imports its run totals. The file
 * itself never leaves this page: only the totals are sent.
 */
export function PayrollImportForm() {
  const { pending, error, setError, run, router, t } = useAction();
  const locale = useLocale();
  const money = (cents: number) => formatCents(cents, locale);
  const [provider, setProvider] = useState<PayrollProvider>("nethris");
  const [file, setFile] = useState<{ name: string; text: string; sha256: string | null } | null>(null);
  const [headerRow, setHeaderRow] = useState(0);
  const [dateOrder, setDateOrder] = useState<DateOrder>("ymd");
  const [columns, setColumns] = useState<Partial<Record<PayrollField, number[]>>>({});

  const rows = useMemo(() => (file ? readCsv(file.text) : []), [file]);
  const header = rows[headerRow] ?? [];
  const mapping: PayrollMapping = { headerRow, dateOrder, columns };
  const result = useMemo(
    () => (file ? parsePayrollFile(file.text, provider, provider === "other" ? mapping : undefined, locale) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [file, provider, headerRow, dateOrder, columns, locale],
  );

  function chooseHeaderRow(index: number, from: string[][] = rows) {
    setHeaderRow(index);
    setColumns(guessMapping(from[index] ?? []));
  }

  return (
    <form
      className="space-y-4"
      aria-label={t("finance.payroll.import.formLabel")}
      onSubmit={async (e) => {
        e.preventDefault();
        if (!file || !result) {
          setError(t("finance.payroll.import.chooseFile"));
          return;
        }
        if (!result.ok) {
          setError(result.error);
          return;
        }
        await run(
          "import",
          () =>
            importPayrollRuns({
              provider,
              fileName: file.name,
              fileSha256: file.sha256,
              runs: result.payroll.runs.map((r) => ({
                runReference: r.runReference,
                payDate: r.payDate,
                periodStart: r.periodStart,
                periodEnd: r.periodEnd,
                cents: r.cents,
              })),
            }),
          (r) => {
            const added = r.added ?? 0;
            if (added === 0) return t("finance.payroll.import.alreadyImported");
            const vars = { count: added, skipped: r.skipped ?? 0 };
            if (r.skipped) {
              return added === 1
                ? t("finance.payroll.import.importedOneSkipped", vars)
                : t("finance.payroll.import.importedOtherSkipped", vars);
            }
            return added === 1 ? t("finance.payroll.import.importedOne") : t("finance.payroll.import.importedOther", vars);
          },
          (r) => {
            setFile(null);
            const form = e.target as HTMLFormElement;
            form.reset();
            if (r.ids?.length === 1) router.push(`/finance/payroll/${r.ids[0]}`);
            else router.refresh();
          },
        );
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="payroll-provider">{t("finance.payroll.import.provider")}</Label>
          <Select
            id="payroll-provider"
            value={provider}
            onChange={(e) => setProvider(e.currentTarget.value as PayrollProvider)}
          >
            {PAYROLL_PROVIDERS.map((p) => (
              <option key={p} value={p}>
                {p === "other"
                  ? providerLabel(p, t)
                  : t("finance.payroll.import.providerUnchecked", { provider: providerLabel(p, t) })}
              </option>
            ))}
          </Select>
          <FieldHint>{t("finance.payroll.import.providerHint")}</FieldHint>
        </div>
        <div>
          <Label htmlFor="payroll-file">{t("finance.payroll.import.file")}</Label>
          <Input
            id="payroll-file"
            type="file"
            accept=".csv,.txt,text/csv"
            className="py-1.5"
            onChange={async (e) => {
              const chosen = e.currentTarget.files?.[0];
              setError(null);
              if (!chosen) {
                setFile(null);
                return;
              }
              if (chosen.size > 5_000_000) {
                setFile(null);
                setError(t("finance.payroll.import.fileTooLarge"));
                return;
              }
              const text = await readFileText(chosen);
              setFile({ name: chosen.name, text, sha256: await sha256Hex(text) });
              const read = readCsv(text);
              chooseHeaderRow(guessHeaderRow(read), read);
            }}
          />
          <FieldHint>{t("finance.payroll.import.fileHint")}</FieldHint>
        </div>
      </div>

      {provider === "other" && file ? (
        <fieldset className="space-y-3 rounded-(--radius-sm) border border-line p-3">
          <legend className="px-1 text-[13px] font-medium">{t("finance.payroll.import.columns")}</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="payroll-header-row">{t("finance.payroll.import.headerRow")}</Label>
              <Select
                id="payroll-header-row"
                value={String(headerRow)}
                onChange={(e) => chooseHeaderRow(Number(e.currentTarget.value))}
              >
                {rows.slice(0, 15).map((r, i) => (
                  <option key={i} value={i}>
                    {t("finance.payroll.import.headerRowOption", {
                      number: i + 1,
                      preview: r.filter(Boolean).slice(0, 3).join(", ").slice(0, 60),
                    })}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="payroll-date-order">{t("finance.payroll.import.dateOrder")}</Label>
              <Select
                id="payroll-date-order"
                value={dateOrder}
                onChange={(e) => setDateOrder(e.currentTarget.value as DateOrder)}
              >
                <option value="ymd">{t("finance.payroll.import.ymd")}</option>
                <option value="dmy">{t("finance.payroll.import.dmy")}</option>
                <option value="mdy">{t("finance.payroll.import.mdy")}</option>
              </Select>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {MAPPABLE.map((field) => (
              <div key={field}>
                <Label htmlFor={`payroll-col-${field}`}>
                  {REQUIRED_FIELDS.includes(field) || field === "runReference"
                    ? fieldLabel(field, t)
                    : t("finance.payroll.import.ifAny", { label: fieldLabel(field, t) })}
                </Label>
                <Select
                  id={`payroll-col-${field}`}
                  value={String(columns[field]?.[0] ?? NONE)}
                  onChange={(e) => {
                    const value = Number(e.currentTarget.value);
                    setColumns((c) => ({ ...c, [field]: value >= 0 ? [value] : [] }));
                  }}
                >
                  <option value={NONE}>{t("finance.payroll.import.notInFile")}</option>
                  {header.map((h, i) => (
                    <option key={i} value={i}>
                      {h || t("finance.payroll.import.column", { number: i + 1 })}
                    </option>
                  ))}
                </Select>
              </div>
            ))}
          </div>
        </fieldset>
      ) : null}

      {result && !result.ok ? <FormError error={result.error} /> : null}
      {result && result.ok ? (
        <section aria-labelledby="payroll-preview" className="space-y-2">
          <h3 id="payroll-preview" className="text-[14px] font-semibold">
            {result.payroll.runs.length === 1
              ? t("finance.payroll.import.foundOne")
              : t("finance.payroll.import.foundOther", { count: result.payroll.runs.length })}
          </h3>
          <DataTable minWidth="720px">
            <TableHead>
              <TableHeader>{t("finance.payroll.list.payDate")}</TableHeader>
              <TableHeader>{t("finance.payroll.list.period")}</TableHeader>
              <TableHeader className="text-right">{t("finance.payroll.list.grossWages")}</TableHeader>
              <TableHeader className="text-right">{t("finance.payroll.import.employeeDeductions")}</TableHeader>
              <TableHeader className="text-right">{t("finance.payroll.list.employerContributions")}</TableHeader>
              <TableHeader className="text-right">{t("finance.payroll.list.netPay")}</TableHeader>
            </TableHead>
            <tbody>
              {result.payroll.runs.map((r) => (
                <TableRow key={`${r.payDate}-${r.periodStart}-${r.runReference ?? ""}`}>
                  <TableCell>
                    {r.payDate}
                    {r.runReference ? (
                      <span className="block text-[12.5px] text-muted">
                        {t("finance.payroll.list.runReference", { reference: r.runReference })}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-[13px]">
                    {t("finance.payroll.list.periodRange", { start: r.periodStart, end: r.periodEnd })}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{money(r.cents.gross_wages)}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(employeeDeductions(r.cents))}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(employerContributions(r.cents))}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(r.cents.net_pay)}</TableCell>
                </TableRow>
              ))}
            </tbody>
          </DataTable>
          <ul className="list-disc space-y-1 pl-5 text-[13px] text-muted">
            <li>
              {t("finance.payroll.import.linesDiscarded", {
                count: result.payroll.runs.reduce((s, r) => s + r.rowsRead, 0),
              })}
            </li>
            {result.payroll.totalRowsChecked > 0 ? (
              <li>{t("finance.payroll.import.totalRowMatches")}</li>
            ) : null}
            {result.payroll.missing.length > 0 ? (
              <li>
                {t("finance.payroll.import.missing", {
                  categories: result.payroll.missing.map((k) => categoryLabel(k, t)).join(", "),
                })}
              </li>
            ) : null}
          </ul>
        </section>
      ) : null}

      <FormError error={error} />
      <Button type="submit" loading={pending === "import"} disabled={!result?.ok}>
        <Upload className="size-4" aria-hidden />
        {t("finance.payroll.import.submit")}
      </Button>
    </form>
  );
}

function accountChoices(options: PayrollOptions, types: readonly string[] | null, current: string | null) {
  if (!types) return [];
  return options.accounts.filter((a) => types.includes(a.account_type) && (a.is_active || a.id === current));
}

/** The account each category posts to, for the whole organization. */
export function AccountMapDialog({ map, options }: { map: AccountMapRow[]; options: PayrollOptions }) {
  const { pending, error, run, t } = useAction();
  const [open, setOpen] = useState(false);
  const [opened, setOpened] = useState(0);
  const byCategory = new Map(map.map((m) => [m.category, m]));
  return (
    <>
      <Button
        variant="secondary"
        onClick={() => {
          setOpened((n) => n + 1);
          setOpen(true);
        }}
      >
        <Settings2 className="size-4" aria-hidden />
        {t("finance.payroll.mapping.open")}
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={t("finance.payroll.mapping.title")}
        className="w-[min(820px,calc(100vw-2rem))]"
      >
        <form
          key={opened}
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            const value = (name: string) => (form.get(name) as string | null) || null;
            const ok = await run(
              "map",
              () =>
                savePayrollAccountMap(
                  PAYROLL_CATEGORIES.map((c) => ({
                    category: c.key,
                    debitAccountId: c.debit ? value(`debit-${c.key}`) : null,
                    creditAccountId: c.credit ? value(`credit-${c.key}`) : null,
                  })),
                ),
              t("finance.payroll.mapping.saved"),
            );
            if (ok) setOpen(false);
          }}
        >
          <p className="text-[13px] text-muted">{t("finance.payroll.mapping.intro")}</p>
          <div className="space-y-3">
            {PAYROLL_CATEGORIES.map((c) => {
              const current = byCategory.get(c.key);
              return (
                <div key={c.key} className="grid gap-2 sm:grid-cols-[14rem_1fr_1fr] sm:items-end">
                  <p className="text-[13.5px] font-medium sm:pb-2">{categoryLabel(c.key, t)}</p>
                  {c.debit ? (
                    <div>
                      <Label htmlFor={`debit-${c.key}`}>{t("finance.payroll.mapping.debit")}</Label>
                      <Select id={`debit-${c.key}`} name={`debit-${c.key}`} defaultValue={current?.debit_account_id ?? ""}>
                        <option value="">{t("finance.payroll.run.notMapped")}</option>
                        {accountChoices(options, c.debit, current?.debit_account_id ?? null).map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.code} {a.name}
                          </option>
                        ))}
                      </Select>
                    </div>
                  ) : (
                    <span className="hidden sm:block" />
                  )}
                  {c.credit ? (
                    <div>
                      <Label htmlFor={`credit-${c.key}`}>
                        {c.key === "net_pay"
                          ? t("finance.payroll.mapping.creditNetPay")
                          : t("finance.payroll.mapping.credit")}
                      </Label>
                      <Select
                        id={`credit-${c.key}`}
                        name={`credit-${c.key}`}
                        defaultValue={current?.credit_account_id ?? ""}
                      >
                        <option value="">{t("finance.payroll.run.notMapped")}</option>
                        {accountChoices(options, c.credit, current?.credit_account_id ?? null).map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.code} {a.name}
                          </option>
                        ))}
                      </Select>
                    </div>
                  ) : (
                    <span className="hidden sm:block" />
                  )}
                </div>
              );
            })}
          </div>
          <FormError error={error} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              {t("finance.common.cancel")}
            </Button>
            <Button type="submit" loading={pending === "map"}>
              {t("finance.payroll.mapping.save")}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}

interface ShareDraft {
  key: number;
  fundId: string;
  programId: string;
  value: string;
}

/** How a draft run is shared across funds and programs. */
export function AllocationForm({
  runId,
  grossCents,
  allocation,
  options,
}: {
  runId: string;
  grossCents: number;
  allocation: Allocation[];
  options: PayrollOptions;
}) {
  const { pending, error, run, t } = useAction();
  const locale = useLocale();
  const initialMode = allocation.some((a) => a.share_cents !== null) ? "amount" : "percent";
  const [mode, setMode] = useState<"percent" | "amount">(initialMode);
  const [next, setNext] = useState(allocation.length + 1);
  const [shares, setShares] = useState<ShareDraft[]>(
    allocation.map((a, i) => ({
      key: i,
      fundId: a.fund_id,
      programId: a.program_id ?? "",
      value:
        a.share_cents !== null
          ? centsToDecimal(a.share_cents)
          : String((a.share_basis_points ?? 0) / 100),
    })),
  );
  const update = (key: number, patch: Partial<ShareDraft>) =>
    setShares((s) => s.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  const funds = options.funds.filter((f) => f.is_active || shares.some((s) => s.fundId === f.id));

  return (
    <form
      className="space-y-3"
      aria-label={t("finance.payroll.allocation.formLabel")}
      onSubmit={(e) => {
        e.preventDefault();
        void run(
          "allocate",
          () =>
            savePayrollAllocation({
              runId,
              mode,
              shares: shares.map((s) => ({ fundId: s.fundId, programId: s.programId, value: s.value })),
            }),
          t("finance.payroll.allocation.saved"),
        );
      }}
    >
      <fieldset>
        <legend className="mb-1.5 text-[13px] font-medium">{t("finance.payroll.allocation.splitBy")}</legend>
        <div className="flex flex-wrap gap-4 text-[13.5px]">
          <label className="flex items-center gap-2">
            <input type="radio" name="mode" value="percent" checked={mode === "percent"} onChange={() => setMode("percent")} />
            {t("finance.payroll.allocation.percent")}
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="mode" value="amount" checked={mode === "amount"} onChange={() => setMode("amount")} />
            {t("finance.payroll.allocation.amount", { total: formatCents(grossCents, locale) })}
          </label>
        </div>
      </fieldset>
      {shares.length === 0 ? (
        <p className="text-[13px] text-muted">{t("finance.payroll.allocation.none")}</p>
      ) : null}
      {shares.map((s, i) => (
        <div key={s.key} className="grid gap-2 sm:grid-cols-[1fr_1fr_9rem_auto] sm:items-end">
          <div>
            <Label htmlFor={`share-fund-${s.key}`}>{t("finance.payroll.allocation.fund", { number: i + 1 })}</Label>
            <Select
              id={`share-fund-${s.key}`}
              value={s.fundId}
              required
              onChange={(e) => update(s.key, { fundId: e.currentTarget.value })}
            >
              <option value="" disabled>
                {t("finance.payroll.allocation.chooseFund")}
              </option>
              {funds.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.code} {f.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor={`share-program-${s.key}`}>
              {t("finance.payroll.allocation.program", { number: i + 1 })}
            </Label>
            <Select
              id={`share-program-${s.key}`}
              value={s.programId}
              onChange={(e) => update(s.key, { programId: e.currentTarget.value })}
            >
              <option value="">{t("finance.payroll.allocation.noProgram")}</option>
              {options.programs.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor={`share-value-${s.key}`}>
              {mode === "percent"
                ? t("finance.payroll.allocation.valuePercent", { number: i + 1 })
                : t("finance.payroll.allocation.valueAmount", { number: i + 1 })}
            </Label>
            <Input
              id={`share-value-${s.key}`}
              inputMode="decimal"
              required
              value={s.value}
              placeholder={
                mode === "percent"
                  ? t("finance.payroll.allocation.placeholderPercent")
                  : t("finance.payroll.allocation.placeholderAmount")
              }
              onChange={(e) => update(s.key, { value: e.currentTarget.value })}
            />
          </div>
          <Button
            type="button"
            variant="ghost"
            aria-label={t("finance.payroll.allocation.remove", { number: i + 1 })}
            onClick={() => setShares((list) => list.filter((x) => x.key !== s.key))}
          >
            <Trash2 className="size-4" aria-hidden />
          </Button>
        </div>
      ))}
      <FormError error={error} />
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="secondary"
          disabled={shares.length >= 20}
          onClick={() => {
            setShares((list) => [...list, { key: next, fundId: "", programId: "", value: "" }]);
            setNext((n) => n + 1);
          }}
        >
          <Plus className="size-4" aria-hidden />
          {t("finance.payroll.allocation.add")}
        </Button>
        <Button type="submit" loading={pending === "allocate"}>
          {t("finance.payroll.allocation.save")}
        </Button>
      </div>
    </form>
  );
}

/** Post or delete a draft; reverse a posted run. */
export function RunActions({
  runId,
  status,
  payDate,
  canPost,
}: {
  runId: string;
  status: "draft" | "posted" | "reversed";
  payDate: string;
  canPost: boolean;
}) {
  const { pending, error, run, router, t } = useAction();
  const [reverseOn, setReverseOn] = useState(payDate);
  if (status === "reversed") return null;
  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap items-end justify-end gap-2">
        {status === "draft" ? (
          <>
            <Button
              variant="danger"
              loading={pending === "delete"}
              disabled={pending !== null}
              onClick={() => {
                if (!window.confirm(t("finance.payroll.actions.confirmDelete"))) return;
                void run("delete", () => deletePayrollDraft(runId), t("finance.payroll.actions.deleted"), () => {
                  router.push("/finance/payroll");
                  router.refresh();
                });
              }}
            >
              {t("finance.payroll.actions.delete")}
            </Button>
            <Button
              loading={pending === "post"}
              disabled={pending !== null || !canPost}
              onClick={() => {
                if (!window.confirm(t("finance.payroll.actions.confirmPost"))) {
                  return;
                }
                void run("post", () => postPayrollRun(runId), (r) =>
                  t("finance.payroll.actions.posted", { number: r.entryNumber ?? "" }),);
              }}
            >
              {t("finance.payroll.actions.post")}
            </Button>
          </>
        ) : (
          <>
            <div>
              <Label htmlFor="reverse-date">{t("finance.payroll.actions.reversalDate")}</Label>
              <Input
                id="reverse-date"
                type="date"
                value={reverseOn}
                min={payDate}
                onChange={(e) => setReverseOn(e.currentTarget.value)}
              />
            </div>
            <Button
              variant="danger"
              loading={pending === "reverse"}
              onClick={() => {
                if (!window.confirm(t("finance.payroll.actions.confirmReverse"))) {
                  return;
                }
                void run(
                  "reverse",
                  () => reversePayrollRun({ runId, entryDate: reverseOn }),
                  t("finance.payroll.actions.reversed"),
                );
              }}
            >
              {t("finance.payroll.actions.reverse")}
            </Button>
          </>
        )}
      </div>
      <FormError error={error} />
    </div>
  );
}

