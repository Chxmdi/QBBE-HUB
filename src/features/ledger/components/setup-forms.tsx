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
import { useT } from "@/lib/i18n/client";

function useAction() {
  const router = useRouter();
  const { toast } = useToast();
  const t = useT();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(action: () => Promise<ActionResult>, success: string) {
    setPending(true);
    setError(null);
    const result = await action();
    setPending(false);
    if (!result.ok) {
      setError(result.error ?? t("finance.ledger.setup.genericError"));
      return false;
    }
    toast(success, { tone: "success" });
    router.refresh();
    return true;
  }
  return { pending, error, run, t };
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
  const { pending, error, run, t } = useAction();
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
          t("finance.ledger.setup.approvalRecorded"),
        );
      }}
    >
      <div>
        <Label htmlFor="approved-by">{t("finance.ledger.setup.approvedBy")}</Label>
        <Input id="approved-by" name="approvedByName" maxLength={200} required placeholder={t("finance.ledger.setup.approvedByPlaceholder")} />
      </div>
      <div>
        <Label htmlFor="approved-on">{t("finance.ledger.setup.approvedOn")}</Label>
        <Input id="approved-on" name="approvedOn" type="date" max={today} required />
      </div>
      <Button type="submit" loading={pending}>
        {t("finance.ledger.setup.recordApproval")}
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
  const { pending, error, run, t } = useAction();
  const [choice, setChoice] = useState("");
  return (
    <div className="space-y-3">
      {readers.length === 0 ? (
        <p className="text-[13.5px] text-muted">{t("finance.ledger.setup.noReaders")}</p>
      ) : (
        <ul className="divide-y divide-line rounded-(--radius-sm) border border-line">
          {readers.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3 px-3 py-2 text-[13.5px]">
              <span>{r.name}</span>
              <Button
                size="sm"
                variant="secondary"
                disabled={pending}
                onClick={() => void run(() => revokeLedgerReader(r.id), t("finance.ledger.setup.readerRemoved", { name: r.name }))}
              >
                {t("finance.ledger.setup.remove")}
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
            void run(() => grantLedgerReader(choice), t("finance.ledger.setup.readGranted")).then((ok) => {
              if (ok) setChoice("");
            });
          }}
        >
          <div className="min-w-56 flex-1">
            <Label htmlFor="reader">{t("finance.ledger.setup.giveAccessTo")}</Label>
            <Select id="reader" value={choice} onChange={(e) => setChoice(e.target.value)}>
              <option value="">{t("finance.ledger.setup.chooseStaff")}</option>
              {candidates.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>
          <Button type="submit" variant="secondary" loading={pending} disabled={!choice}>
            {t("finance.ledger.setup.grantAccess")}
          </Button>
        </form>
      ) : null}
      <FormError error={error} />
    </div>
  );
}

/** Creates the twelve monthly periods of a fiscal year. */
export function FiscalYearForm({ defaultMonth }: { defaultMonth: string }) {
  const { pending, error, run, t } = useAction();
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        void run(
          () => createFiscalYear({ startMonth: form.get("startMonth") }),
          t("finance.ledger.setup.fiscalYearCreated"),
        );
      }}
    >
      <div>
        <Label htmlFor="start-month">{t("finance.ledger.setup.firstMonth")}</Label>
        <Input id="start-month" name="startMonth" type="month" defaultValue={defaultMonth} required />
        <FieldHint>{t("finance.ledger.setup.firstMonthHint")}</FieldHint>
      </div>
      <Button type="submit" loading={pending} className="mb-6">
        {t("finance.ledger.setup.addFiscalYear")}
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
  const { pending, error, run, t } = useAction();
  const next = status === "open" ? "closed" : "open";
  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        size="sm"
        variant="secondary"
        loading={pending}
        aria-label={t(next === "closed" ? "finance.ledger.setup.closeAria" : "finance.ledger.setup.reopenAria", { name })}
        onClick={() => {
          if (
            next === "open" &&
            !window.confirm(t("finance.ledger.setup.reopenConfirm", { name }))
          ) {
            return;
          }
          void run(() => setPeriodStatus(periodId, next), t(next === "closed" ? "finance.ledger.setup.periodClosed" : "finance.ledger.setup.periodReopened", { name }));
        }}
      >
        {next === "closed" ? t("finance.ledger.setup.close") : t("finance.ledger.setup.reopen")}
      </Button>
      <FormError error={error} />
    </div>
  );
}
