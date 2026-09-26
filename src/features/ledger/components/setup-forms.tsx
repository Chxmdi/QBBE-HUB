"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { FieldHint, Input, Label, Select } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import {
  createFiscalYear,
  grantLedgerReader,
  recordChartApproval,
  revokeLedgerReader,
  setPeriodStatus,
} from "@/features/ledger/services/ledger.commands";
import type { ActionResult } from "@/features/tasks/services/task.commands";

function useAction() {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(action: () => Promise<ActionResult>, success: string) {
    setPending(true);
    setError(null);
    const result = await action();
    setPending(false);
    if (!result.ok) {
      setError(result.error ?? "Something went wrong. Try again.");
      return false;
    }
    toast(success, { tone: "success" });
    router.refresh();
    return true;
  }
  return { pending, error, run };
}

function FormError({ error }: { error: string | null }) {
  return error ? (
    <p role="alert" className="text-[13px] text-danger-fg">
      {error}
    </p>
  ) : null;
}

/** Records the accountant's approval of the chart of accounts (#148). */
export function ChartApprovalForm({ today }: { today: string }) {
  const { pending, error, run } = useAction();
  return (
    <form
      className="grid gap-3 sm:grid-cols-[1fr_12rem_auto] sm:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        void run(
          () =>
            recordChartApproval({
              approvedByName: form.get("approvedByName"),
              approvedOn: form.get("approvedOn"),
            }),
          "Chart approval recorded. Entries can now be posted.",
        );
      }}
    >
      <div>
        <Label htmlFor="approved-by">Accountant who approved it</Label>
        <Input id="approved-by" name="approvedByName" maxLength={200} required placeholder="Name, designation" />
      </div>
      <div>
        <Label htmlFor="approved-on">Approved on</Label>
        <Input id="approved-on" name="approvedOn" type="date" max={today} required />
      </div>
      <Button type="submit" loading={pending}>
        Record approval
      </Button>
      <div className="sm:col-span-3">
        <FormError error={error} />
      </div>
    </form>
  );
}

export interface StaffOption {
  id: string;
  name: string;
}

/** Admins name the finance staff who may read the books. */
export function LedgerReaders({
  readers,
  candidates,
}: {
  readers: StaffOption[];
  candidates: StaffOption[];
}) {
  const { pending, error, run } = useAction();
  const [choice, setChoice] = useState("");
  return (
    <div className="space-y-3">
      {readers.length === 0 ? (
        <p className="text-[13.5px] text-muted">No staff member has read access yet.</p>
      ) : (
        <ul className="divide-y divide-line rounded-(--radius-sm) border border-line">
          {readers.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3 px-3 py-2 text-[13.5px]">
              <span>{r.name}</span>
              <Button
                size="sm"
                variant="secondary"
                disabled={pending}
                onClick={() => void run(() => revokeLedgerReader(r.id), `${r.name} can no longer read the ledger.`)}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
      {candidates.length > 0 ? (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!choice) return;
            void run(() => grantLedgerReader(choice), "Read access granted.").then((ok) => {
              if (ok) setChoice("");
            });
          }}
        >
          <div className="min-w-56 flex-1">
            <Label htmlFor="reader">Give read-only access to</Label>
            <Select id="reader" value={choice} onChange={(e) => setChoice(e.target.value)}>
              <option value="">Choose a staff member</option>
              {candidates.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>
          <Button type="submit" variant="secondary" loading={pending} disabled={!choice}>
            Grant access
          </Button>
        </form>
      ) : null}
      <FormError error={error} />
    </div>
  );
}

/** Creates the twelve monthly periods of a fiscal year. */
export function FiscalYearForm({ defaultMonth }: { defaultMonth: string }) {
  const { pending, error, run } = useAction();
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        void run(
          () => createFiscalYear({ startMonth: form.get("startMonth") }),
          "Fiscal year periods created.",
        );
      }}
    >
      <div>
        <Label htmlFor="start-month">First month of the fiscal year</Label>
        <Input id="start-month" name="startMonth" type="month" defaultValue={defaultMonth} required />
        <FieldHint>Creates one open period per month for twelve months.</FieldHint>
      </div>
      <Button type="submit" loading={pending} className="mb-6">
        Add fiscal year
      </Button>
      <div className="w-full">
        <FormError error={error} />
      </div>
    </form>
  );
}

export function PeriodStatusButton({
  periodId,
  name,
  status,
}: {
  periodId: string;
  name: string;
  status: "open" | "closed";
}) {
  const { pending, error, run } = useAction();
  const next = status === "open" ? "closed" : "open";
  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        size="sm"
        variant="secondary"
        loading={pending}
        aria-label={`${next === "closed" ? "Close" : "Reopen"} ${name}`}
        onClick={() => {
          if (
            next === "open" &&
            !window.confirm(`Reopen ${name}? Entries could then be added to a month that was already closed.`)
          ) {
            return;
          }
          void run(() => setPeriodStatus(periodId, next), `${name} ${next === "closed" ? "closed" : "reopened"}.`);
        }}
      >
        {next === "closed" ? "Close" : "Reopen"}
      </Button>
      <FormError error={error} />
    </div>
  );
}
