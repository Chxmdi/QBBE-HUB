"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FieldHint, Input, Label, Select, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import type { ActionResult } from "@/features/tasks/services/task.commands";
import { centsToDecimal } from "@/features/ledger/money";
import { evenSplit, fiscalMonths, monthLabel } from "@/features/budgets/budget";
import {
  approveBudget,
  createBudget,
  deleteBudgetDraft,
  deleteBudgetLine,
  reviseBudget,
  saveBudgetLine,
} from "@/features/budgets/services/budget.commands";
import type { BudgetLine, BudgetOptions } from "@/features/budgets/services/budget.queries";

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
    success: string,
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
    toast(success, { tone: "success" });
    if (then) then(result);
    else router.refresh();
    return true;
  }
  return { pending, error, run, router };
}

/** Starts the budget of a fiscal year. */
export function CreateBudgetForm({ defaultMonth }: { defaultMonth: string }) {
  const { pending, error, run, router } = useAction();
  return (
    <form
      className="card grid gap-4 p-4 sm:grid-cols-[12rem_1fr_auto] sm:items-end"
      aria-label="New budget"
      onSubmit={(e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        void run(
          "create",
          () =>
            createBudget({
              startMonth: form.get("startMonth"),
              name: form.get("name"),
              notes: form.get("notes") ?? undefined,
            }),
          "Budget created as a draft.",
          (result) => {
            if (result.id) router.push(`/finance/budgets/${result.id}`);
          },
        );
      }}
    >
      <div>
        <Label htmlFor="budget-start">First month of the fiscal year</Label>
        <Input id="budget-start" name="startMonth" type="month" defaultValue={defaultMonth} required />
      </div>
      <div>
        <Label htmlFor="budget-name">Name</Label>
        <Input id="budget-name" name="name" maxLength={200} required placeholder="Operating budget" />
      </div>
      <Button type="submit" loading={pending === "create"}>
        <Plus className="size-4" aria-hidden />
        Create budget
      </Button>
      <div className="sm:col-span-3">
        <Label htmlFor="budget-notes">Notes (optional)</Label>
        <Textarea id="budget-notes" name="notes" maxLength={2000} rows={2} />
        <FormError error={error} />
      </div>
    </form>
  );
}

function sameMonths(months: number[]): boolean {
  const even = evenSplit(months.reduce((a, b) => a + b, 0));
  return months.every((m, i) => m === even[i]);
}

/** Add a budget line to a draft, or change one. */
export function BudgetLineDialog({
  budgetId,
  fiscalYearStart,
  options,
  line,
}: {
  budgetId: string;
  fiscalYearStart: string;
  options: BudgetOptions;
  line?: BudgetLine;
}) {
  const { pending, error, run } = useAction();
  const [open, setOpen] = useState(false);
  const initialPhasing = line && !sameMonths(line.month_cents) ? "custom" : "even";
  const [phasing, setPhasing] = useState<"even" | "custom">(initialPhasing);
  const [programId, setProgramId] = useState(line?.program_id ?? "");
  // Each opening starts from the saved line (or a blank one), never from what
  // was typed the last time the dialog was open.
  const [opened, setOpened] = useState(0);
  const show = () => {
    setPhasing(initialPhasing);
    setProgramId(line?.program_id ?? "");
    setOpened((n) => n + 1);
    setOpen(true);
  };
  const months = fiscalMonths(fiscalYearStart);
  const projects = options.projects.filter((p) => !programId || p.program_id === programId);
  const account = line ? options.accounts.find((a) => a.id === line.account_id) : undefined;

  return (
    <>
      {line ? (
        <Button
          size="sm"
          variant="ghost"
          onClick={show}
          aria-label={`Edit line ${account ? `${account.code} ${account.name}` : ""}`.trim()}
        >
          <Pencil className="size-4" aria-hidden />
        </Button>
      ) : (
        <Button onClick={show}>
          <Plus className="size-4" aria-hidden />
          Add line
        </Button>
      )}
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={line ? "Edit budget line" : "Add a budget line"}
        className="w-[min(720px,calc(100vw-2rem))]"
      >
        <form
          key={opened}
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            const ok = await run(
              "save",
              () =>
                saveBudgetLine({
                  budgetId,
                  lineId: line?.id,
                  accountId: form.get("accountId"),
                  fundId: form.get("fundId"),
                  programId: form.get("programId"),
                  projectId: form.get("projectId"),
                  phasing,
                  annual: form.get("annual") ?? undefined,
                  months: phasing === "custom" ? months.map((_, i) => String(form.get(`month-${i}`) ?? "")) : undefined,
                  note: form.get("note") ?? undefined,
                }),
              line ? "Line saved." : "Line added.",
            );
            if (ok) setOpen(false);
          }}
        >
          <div>
            <Label htmlFor="line-account">Account</Label>
            <Select id="line-account" name="accountId" defaultValue={line?.account_id ?? ""} required>
              <option value="" disabled>
                Choose a revenue or expense account
              </option>
              {(["revenue", "expense"] as const).map((type) => (
                <optgroup key={type} label={type === "revenue" ? "Revenue" : "Expense"}>
                  {options.accounts
                    .filter((a) => a.account_type === type && (a.is_active || a.id === line?.account_id))
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.code} {a.name}
                      </option>
                    ))}
                </optgroup>
              ))}
            </Select>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <Label htmlFor="line-fund">Fund</Label>
              <Select id="line-fund" name="fundId" defaultValue={line?.fund_id ?? ""}>
                <option value="">Any fund</option>
                {options.funds.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.code} {f.name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="line-program">Program</Label>
              <Select
                id="line-program"
                name="programId"
                value={programId}
                onChange={(e) => setProgramId(e.target.value)}
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
              <Label htmlFor="line-project">Project</Label>
              <Select id="line-project" name="projectId" defaultValue={line?.project_id ?? ""} key={programId}>
                <option value="">No project</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <fieldset>
            <legend className="mb-1.5 text-[13px] font-medium">Monthly phasing</legend>
            <div className="flex flex-wrap gap-4 text-[13.5px]">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="phasing"
                  value="even"
                  checked={phasing === "even"}
                  onChange={() => setPhasing("even")}
                />
                Even split over 12 months
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="phasing"
                  value="custom"
                  checked={phasing === "custom"}
                  onChange={() => setPhasing("custom")}
                />
                Custom amount per month
              </label>
            </div>
          </fieldset>
          {phasing === "even" ? (
            <div className="max-w-56">
              <Label htmlFor="line-annual">Annual amount</Label>
              <Input
                id="line-annual"
                name="annual"
                inputMode="decimal"
                required
                defaultValue={line ? centsToDecimal(line.annual_cents) : ""}
                placeholder="12000.00"
              />
              <FieldHint>Split evenly; leftover cents go to the first months.</FieldHint>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {months.map((m, i) => (
                <div key={m}>
                  <Label htmlFor={`line-month-${i}`}>{monthLabel(m)}</Label>
                  <Input
                    id={`line-month-${i}`}
                    name={`month-${i}`}
                    inputMode="decimal"
                    defaultValue={line ? centsToDecimal(line.month_cents[i] ?? 0) : ""}
                    placeholder="0.00"
                  />
                </div>
              ))}
            </div>
          )}
          <div>
            <Label htmlFor="line-note">Note (optional)</Label>
            <Input id="line-note" name="note" maxLength={500} defaultValue={line?.note ?? ""} />
          </div>
          <FormError error={error} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={pending === "save"}>
              Save line
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}

export function DeleteLineButton({ lineId, label }: { lineId: string; label: string }) {
  const { pending, error, run } = useAction();
  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        loading={pending === "delete"}
        aria-label={`Remove line ${label}`}
        onClick={() => {
          if (!window.confirm(`Remove the line for ${label}?`)) return;
          void run("delete", () => deleteBudgetLine(lineId), "Line removed.");
        }}
      >
        <Trash2 className="size-4" aria-hidden />
      </Button>
      <FormError error={error} />
    </>
  );
}

/** Approve or delete a draft; revise the approved version. */
export function BudgetActions({ budgetId, status }: { budgetId: string; status: "draft" | "approved" | "superseded" }) {
  const { pending, error, run, router } = useAction();
  if (status === "superseded") return null;
  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap gap-2">
        {status === "draft" ? (
          <>
            <Button
              variant="danger"
              loading={pending === "delete"}
              disabled={pending !== null}
              onClick={() => {
                if (!window.confirm("Delete this draft and its lines? Approved versions are not affected.")) return;
                void run("delete", () => deleteBudgetDraft(budgetId), "Draft deleted.", () => {
                  router.push("/finance/budgets");
                  router.refresh();
                });
              }}
            >
              Delete draft
            </Button>
            <Button
              loading={pending === "approve"}
              disabled={pending !== null}
              onClick={() => {
                if (
                  !window.confirm(
                    "Approve this budget? It will be locked; later changes need a new version. Any earlier approved version is superseded.",
                  )
                ) {
                  return;
                }
                void run("approve", () => approveBudget(budgetId), "Budget approved and locked.");
              }}
            >
              Approve budget
            </Button>
          </>
        ) : (
          <Button
            variant="secondary"
            loading={pending === "revise"}
            onClick={() =>
              void run("revise", () => reviseBudget(budgetId), "New draft version started.", (result) => {
                if (result.id) router.push(`/finance/budgets/${result.id}`);
              })
            }
          >
            Revise budget
          </Button>
        )}
      </div>
      <FormError error={error} />
    </div>
  );
}
