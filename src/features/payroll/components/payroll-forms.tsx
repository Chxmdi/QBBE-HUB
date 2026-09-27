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
  PROVIDER_LABEL,
  categoryLabel,
  employeeDeductions,
  employerContributions,
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
      setError(result.error ?? "Something went wrong. Try again.");
      return false;
    }
    toast(typeof success === "string" ? success : success(result), { tone: "success" });
    if (then) then(result);
    else router.refresh();
    return true;
  }
  return { pending, error, setError, run, router };
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

const PROVIDERS = Object.keys(PROVIDER_LABEL) as PayrollProvider[];
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
  const { pending, error, setError, run, router } = useAction();
  const [provider, setProvider] = useState<PayrollProvider>("nethris");
  const [file, setFile] = useState<{ name: string; text: string; sha256: string | null } | null>(null);
  const [headerRow, setHeaderRow] = useState(0);
  const [dateOrder, setDateOrder] = useState<DateOrder>("ymd");
  const [columns, setColumns] = useState<Partial<Record<PayrollField, number[]>>>({});

  const rows = useMemo(() => (file ? readCsv(file.text) : []), [file]);
  const header = rows[headerRow] ?? [];
  const mapping: PayrollMapping = { headerRow, dateOrder, columns };
  const result = useMemo(
    () => (file ? parsePayrollFile(file.text, provider, provider === "other" ? mapping : undefined) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [file, provider, headerRow, dateOrder, columns],
  );

  function chooseHeaderRow(index: number, from: string[][] = rows) {
    setHeaderRow(index);
    setColumns(guessMapping(from[index] ?? []));
  }

  return (
    <form
      className="space-y-4"
      aria-label="Import payroll"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!file || !result) {
          setError("Choose a payroll file.");
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
          (r) =>
            r.added === 0
              ? "Already imported: nothing was added."
              : `Imported ${r.added} pay run${r.added === 1 ? "" : "s"} as draft${r.added === 1 ? "" : "s"}` +
                (r.skipped ? `; ${r.skipped} already imported were skipped.` : "."),
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
          <Label htmlFor="payroll-provider">Payroll provider</Label>
          <Select
            id="payroll-provider"
            value={provider}
            onChange={(e) => setProvider(e.currentTarget.value as PayrollProvider)}
          >
            {PROVIDERS.map((p) => (
              <option key={p} value={p}>
                {PROVIDER_LABEL[p]}
                {p === "other" ? "" : " (not yet checked against a real export)"}
              </option>
            ))}
          </Select>
          <FieldHint>
            Presets follow each provider&rsquo;s published export layout and have not yet been checked against a real
            export. If yours is refused, choose &ldquo;Other CSV&rdquo;.
          </FieldHint>
        </div>
        <div>
          <Label htmlFor="payroll-file">Payroll journal or register (CSV)</Label>
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
                setError("The file is too large. Export fewer pay runs at a time.");
                return;
              }
              const text = await readFileText(chosen);
              setFile({ name: chosen.name, text, sha256: await sha256Hex(text) });
              const read = readCsv(text);
              chooseHeaderRow(guessHeaderRow(read), read);
            }}
          />
          <FieldHint>Read on this computer. Only the totals of each pay run are sent and kept.</FieldHint>
        </div>
      </div>

      {provider === "other" && file ? (
        <fieldset className="space-y-3 rounded-(--radius-sm) border border-line p-3">
          <legend className="px-1 text-[13px] font-medium">Columns</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="payroll-header-row">Header row</Label>
              <Select
                id="payroll-header-row"
                value={String(headerRow)}
                onChange={(e) => chooseHeaderRow(Number(e.currentTarget.value))}
              >
                {rows.slice(0, 15).map((r, i) => (
                  <option key={i} value={i}>
                    Row {i + 1}: {r.filter(Boolean).slice(0, 3).join(", ").slice(0, 60)}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="payroll-date-order">Dates not written YYYY-MM-DD are</Label>
              <Select
                id="payroll-date-order"
                value={dateOrder}
                onChange={(e) => setDateOrder(e.currentTarget.value as DateOrder)}
              >
                <option value="ymd">Year, month, day</option>
                <option value="dmy">Day, month, year</option>
                <option value="mdy">Month, day, year</option>
              </Select>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {MAPPABLE.map((field) => (
              <div key={field}>
                <Label htmlFor={`payroll-col-${field}`}>
                  {fieldLabel(field)}
                  {REQUIRED_FIELDS.includes(field) ? "" : field === "runReference" ? "" : " (if any)"}
                </Label>
                <Select
                  id={`payroll-col-${field}`}
                  value={String(columns[field]?.[0] ?? NONE)}
                  onChange={(e) => {
                    const value = Number(e.currentTarget.value);
                    setColumns((c) => ({ ...c, [field]: value >= 0 ? [value] : [] }));
                  }}
                >
                  <option value={NONE}>Not in the file</option>
                  {header.map((h, i) => (
                    <option key={i} value={i}>
                      {h || `Column ${i + 1}`}
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
            {result.payroll.runs.length} pay run{result.payroll.runs.length === 1 ? "" : "s"} found
          </h3>
          <DataTable minWidth="720px">
            <TableHead>
              <TableHeader>Pay date</TableHeader>
              <TableHeader>Period</TableHeader>
              <TableHeader className="text-right">Gross wages</TableHeader>
              <TableHeader className="text-right">Employee deductions</TableHeader>
              <TableHeader className="text-right">Employer contributions</TableHeader>
              <TableHeader className="text-right">Net pay</TableHeader>
            </TableHead>
            <tbody>
              {result.payroll.runs.map((r) => (
                <TableRow key={`${r.payDate}-${r.periodStart}-${r.runReference ?? ""}`}>
                  <TableCell>
                    {r.payDate}
                    {r.runReference ? <span className="block text-[12.5px] text-muted">Run {r.runReference}</span> : null}
                  </TableCell>
                  <TableCell className="text-[13px]">
                    {r.periodStart} to {r.periodEnd}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatCents(r.cents.gross_wages)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCents(employeeDeductions(r.cents))}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCents(employerContributions(r.cents))}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCents(r.cents.net_pay)}</TableCell>
                </TableRow>
              ))}
            </tbody>
          </DataTable>
          <ul className="list-disc space-y-1 pl-5 text-[13px] text-muted">
            <li>
              {result.payroll.runs.reduce((s, r) => s + r.rowsRead, 0)} lines were added into these totals and then
              discarded. Names, social insurance numbers and per-employee amounts are not sent or stored.
            </li>
            {result.payroll.totalRowsChecked > 0 ? (
              <li>The file&rsquo;s own total row matches the sum of its lines.</li>
            ) : null}
            {result.payroll.missing.length > 0 ? (
              <li>
                Not in the file, imported as zero: {result.payroll.missing.map(categoryLabel).join(", ")}.
              </li>
            ) : null}
          </ul>
        </section>
      ) : null}

      <FormError error={error} />
      <Button type="submit" loading={pending === "import"} disabled={!result?.ok}>
        <Upload className="size-4" aria-hidden />
        Import pay runs
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
  const { pending, error, run } = useAction();
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
        Edit account mapping
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Payroll account mapping"
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
              "Account mapping saved.",
            );
            if (ok) setOpen(false);
          }}
        >
          <p className="text-[13px] text-muted">
            Applies to every run posted from now on; posted runs keep their entries. Net pay can come out of the bank
            account directly or go to a net pay payable account that the bank payment later clears.
          </p>
          <div className="space-y-3">
            {PAYROLL_CATEGORIES.map((c) => {
              const current = byCategory.get(c.key);
              return (
                <div key={c.key} className="grid gap-2 sm:grid-cols-[14rem_1fr_1fr] sm:items-end">
                  <p className="text-[13.5px] font-medium sm:pb-2">{categoryLabel(c.key)}</p>
                  {c.debit ? (
                    <div>
                      <Label htmlFor={`debit-${c.key}`}>Debit (expense)</Label>
                      <Select id={`debit-${c.key}`} name={`debit-${c.key}`} defaultValue={current?.debit_account_id ?? ""}>
                        <option value="">Not mapped</option>
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
                        {c.key === "net_pay" ? "Credit (bank or net pay payable)" : "Credit (payable)"}
                      </Label>
                      <Select
                        id={`credit-${c.key}`}
                        name={`credit-${c.key}`}
                        defaultValue={current?.credit_account_id ?? ""}
                      >
                        <option value="">Not mapped</option>
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
              Cancel
            </Button>
            <Button type="submit" loading={pending === "map"}>
              Save mapping
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
  const { pending, error, run } = useAction();
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
      aria-label="Allocation"
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
          "Allocation saved.",
        );
      }}
    >
      <fieldset>
        <legend className="mb-1.5 text-[13px] font-medium">Split by</legend>
        <div className="flex flex-wrap gap-4 text-[13.5px]">
          <label className="flex items-center gap-2">
            <input type="radio" name="mode" value="percent" checked={mode === "percent"} onChange={() => setMode("percent")} />
            Percentage of the run
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="mode" value="amount" checked={mode === "amount"} onChange={() => setMode("amount")} />
            Amount of gross wages ({formatCents(grossCents)} in all)
          </label>
        </div>
      </fieldset>
      {shares.length === 0 ? (
        <p className="text-[13px] text-muted">
          No shares: the whole run goes to the general fund (GEN) with no program.
        </p>
      ) : null}
      {shares.map((s, i) => (
        <div key={s.key} className="grid gap-2 sm:grid-cols-[1fr_1fr_9rem_auto] sm:items-end">
          <div>
            <Label htmlFor={`share-fund-${s.key}`}>Share {i + 1} fund</Label>
            <Select
              id={`share-fund-${s.key}`}
              value={s.fundId}
              required
              onChange={(e) => update(s.key, { fundId: e.currentTarget.value })}
            >
              <option value="" disabled>
                Choose a fund
              </option>
              {funds.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.code} {f.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor={`share-program-${s.key}`}>Share {i + 1} program</Label>
            <Select
              id={`share-program-${s.key}`}
              value={s.programId}
              onChange={(e) => update(s.key, { programId: e.currentTarget.value })}
            >
              <option value="">No program</option>
              {options.programs.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor={`share-value-${s.key}`}>{mode === "percent" ? `Share ${i + 1} %` : `Share ${i + 1} amount`}</Label>
            <Input
              id={`share-value-${s.key}`}
              inputMode="decimal"
              required
              value={s.value}
              placeholder={mode === "percent" ? "50" : "1250.00"}
              onChange={(e) => update(s.key, { value: e.currentTarget.value })}
            />
          </div>
          <Button
            type="button"
            variant="ghost"
            aria-label={`Remove share ${i + 1}`}
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
          Add share
        </Button>
        <Button type="submit" loading={pending === "allocate"}>
          Save allocation
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
  const { pending, error, run, router } = useAction();
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
                if (!window.confirm("Delete this draft pay run? You can import it again later.")) return;
                void run("delete", () => deletePayrollDraft(runId), "Draft deleted.", () => {
                  router.push("/finance/payroll");
                  router.refresh();
                });
              }}
            >
              Delete draft
            </Button>
            <Button
              loading={pending === "post"}
              disabled={pending !== null || !canPost}
              onClick={() => {
                if (!window.confirm("Post this pay run to the ledger? A posted entry can only be corrected by reversing it.")) {
                  return;
                }
                void run("post", () => postPayrollRun(runId), (r) => `Posted as journal entry ${r.entryNumber}.`);
              }}
            >
              Post to ledger
            </Button>
          </>
        ) : (
          <>
            <div>
              <Label htmlFor="reverse-date">Reversal date</Label>
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
                if (!window.confirm("Reverse this pay run? A mirror entry is posted; the run can then be imported again.")) {
                  return;
                }
                void run("reverse", () => reversePayrollRun({ runId, entryDate: reverseOn }), "Pay run reversed.");
              }}
            >
              Reverse
            </Button>
          </>
        )}
      </div>
      <FormError error={error} />
    </div>
  );
}

