"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Checkbox, FieldHint, Input, Label, Select } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import {
  FILING_FREQUENCIES,
  FILING_FREQUENCY_LABEL,
  TAX_CODES,
  TAX_CODE_HELP,
  TAX_CODE_LABEL,
  type Direction,
  type FilingFrequency,
  type TaxCode,
} from "@/features/sales-tax/return-lines";
import type { LineValues } from "@/features/sales-tax/line-values";
import {
  closeTaxPeriod,
  createTaxPeriod,
  deleteTaxLine,
  importReceipts,
  reopenTaxPeriod,
  saveTaxLine,
  saveTaxSettings,
} from "@/features/sales-tax/services/sales-tax.commands";
import type { ActionResult } from "@/features/tasks/services/task.commands";
import { useT } from "@/lib/i18n/client";

function useAction() {
  const router = useRouter();
  const { toast } = useToast();
  const t = useT();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run<T extends ActionResult>(action: () => Promise<T>, success: string | ((r: T) => string)) {
    setPending(true);
    setError(null);
    const result = await action();
    setPending(false);
    if (!result.ok) {
      setError(result.error ?? t("finance.salesTax.genericError"));
      return false;
    }
    toast(typeof success === "function" ? success(result) : success, { tone: "success" });
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

export interface SettingsValues {
  gstRegistered: boolean;
  gstNumber: string;
  qstRegistered: boolean;
  qstNumber: string;
  filingFrequency: FilingFrequency;
  claimPercent: string;
  showPsbRebate: boolean;
}

/** Registration, filing frequency and the claimable share (#152). */
export function TaxSettingsForm({ initial }: { initial: SettingsValues }) {
  const { pending, error, run, t } = useAction();
  return (
    <form
      className="grid gap-4 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        void run(
          () =>
            saveTaxSettings({
              gstRegistered: form.get("gstRegistered") === "on",
              gstNumber: form.get("gstNumber") ?? undefined,
              qstRegistered: form.get("qstRegistered") === "on",
              qstNumber: form.get("qstNumber") ?? undefined,
              filingFrequency: form.get("filingFrequency"),
              claimPercent: form.get("claimPercent"),
              showPsbRebate: form.get("showPsbRebate") === "on",
            }),
          t("finance.salesTax.settingsForm.saved"),
        );
      }}
    >
      <fieldset className="space-y-2">
        <legend className="text-[13.5px] font-medium">{t("finance.common.gst")}</legend>
        <label className="flex items-center gap-2 text-[13.5px]">
          <Checkbox name="gstRegistered" defaultChecked={initial.gstRegistered} />
          {t("finance.salesTax.settingsForm.gstRegistered")}
        </label>
        <div>
          <Label htmlFor="gst-number">{t("finance.salesTax.settingsForm.gstNumber")}</Label>
          <Input id="gst-number" name="gstNumber" maxLength={40} defaultValue={initial.gstNumber} placeholder="123456789 RT0001" />
        </div>
      </fieldset>
      <fieldset className="space-y-2">
        <legend className="text-[13.5px] font-medium">{t("finance.common.qst")}</legend>
        <label className="flex items-center gap-2 text-[13.5px]">
          <Checkbox name="qstRegistered" defaultChecked={initial.qstRegistered} />
          {t("finance.salesTax.settingsForm.qstRegistered")}
        </label>
        <div>
          <Label htmlFor="qst-number">{t("finance.salesTax.settingsForm.qstNumber")}</Label>
          <Input id="qst-number" name="qstNumber" maxLength={40} defaultValue={initial.qstNumber} placeholder="1234567890 TQ0001" />
        </div>
      </fieldset>
      <div>
        <Label htmlFor="filing-frequency">{t("finance.salesTax.overview.filingFrequency")}</Label>
        <Select id="filing-frequency" name="filingFrequency" defaultValue={initial.filingFrequency}>
          {FILING_FREQUENCIES.map((f) => (
            <option key={f} value={f}>
              {t(FILING_FREQUENCY_LABEL[f])}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <Label htmlFor="claim-percent">{t("finance.salesTax.settingsForm.claimPercent")}</Label>
        <Input id="claim-percent" name="claimPercent" inputMode="decimal" defaultValue={initial.claimPercent} required />
        <FieldHint>{t("finance.salesTax.settingsForm.claimPercentHint")}</FieldHint>
      </div>
      <label className="flex items-start gap-2 text-[13.5px] sm:col-span-2">
        <Checkbox name="showPsbRebate" defaultChecked={initial.showPsbRebate} className="mt-0.5" />
        <span>{t("finance.salesTax.settingsForm.showPsbRebate")}</span>
      </label>
      <div className="flex items-center justify-end gap-3 sm:col-span-2">
        <FormError error={error} />
        <Button type="submit" loading={pending}>
          {t("finance.salesTax.settingsForm.submit")}
        </Button>
      </div>
    </form>
  );
}

/** Adds a reporting period. */
export function TaxPeriodForm({ defaultStart, defaultEnd }: { defaultStart: string; defaultEnd: string }) {
  const { pending, error, run, t } = useAction();
  return (
    <form
      className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        void run(
          () => createTaxPeriod({ startsOn: form.get("startsOn"), endsOn: form.get("endsOn") }),
          t("finance.salesTax.periodForm.added"),
        );
      }}
    >
      <div>
        <Label htmlFor="period-start">{t("finance.salesTax.periodForm.starts")}</Label>
        <Input id="period-start" name="startsOn" type="date" defaultValue={defaultStart} required />
      </div>
      <div>
        <Label htmlFor="period-end">{t("finance.salesTax.periodForm.ends")}</Label>
        <Input id="period-end" name="endsOn" type="date" defaultValue={defaultEnd} required />
      </div>
      <Button type="submit" loading={pending}>
        {t("finance.salesTax.periodForm.submit")}
      </Button>
      <div className="sm:col-span-3">
        <FormError error={error} />
      </div>
    </form>
  );
}

/** Brings reviewed receipts with GST or QST in as purchases. */
export function ImportReceiptsForm({ from, to }: { from: string; to: string }) {
  const { pending, error, run, t } = useAction();
  return (
    <form
      className="flex flex-wrap items-center gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        void run(
          () => importReceipts({ from, to }),
          (r) =>
            r.count
              ? t(
                  r.count === 1
                    ? "finance.salesTax.importForm.broughtInOne"
                    : "finance.salesTax.importForm.broughtInOther",
                  { count: r.count },
                )
              : t("finance.salesTax.importForm.noneToBringIn"),
        );
      }}
    >
      <Button type="submit" variant="secondary" loading={pending}>
        {t("finance.salesTax.importForm.submit")}
      </Button>
      <span className="meta">{t("finance.salesTax.importForm.hint", { from, to })}</span>
      <FormError error={error} />
    </form>
  );
}

/** Adds or edits one tax line in a dialog. */
export function TaxLineDialog({
  initial,
  trigger,
}: {
  initial: LineValues;
  trigger: { label: string; variant?: "primary" | "secondary" | "ghost" };
}) {
  const [open, setOpen] = useState(false);
  const [direction, setDirection] = useState<Direction>(initial.direction);
  const [taxCode, setTaxCode] = useState<TaxCode>(initial.taxCode);
  const { pending, error, run, t } = useAction();
  const taxed = taxCode === "standard";
  const idp = initial.id ? `line-${initial.id.slice(0, 8)}` : "line-new";

  return (
    <>
      <Button variant={trigger.variant ?? "primary"} onClick={() => setOpen(true)}>
        {trigger.label}
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={initial.id ? t("finance.salesTax.lineDialog.editTitle") : t("finance.salesTax.lineDialog.addTitle")}>
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={async (e) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            const ok = await run(
              () =>
                saveTaxLine({
                  id: initial.id,
                  direction,
                  taxCode,
                  transactionDate: form.get("transactionDate"),
                  counterparty: form.get("counterparty"),
                  reference: form.get("reference") ?? undefined,
                  description: form.get("description") ?? undefined,
                  amount: form.get("amount"),
                  gst: taxed ? (form.get("gst") ?? undefined) : undefined,
                  qst: taxed ? (form.get("qst") ?? undefined) : undefined,
                  itc: taxed && direction === "purchase" ? (form.get("itc") ?? undefined) : undefined,
                  itr: taxed && direction === "purchase" ? (form.get("itr") ?? undefined) : undefined,
                }),
              t("finance.salesTax.lineDialog.saved"),
            );
            if (ok) setOpen(false);
          }}
        >
          <div>
            <Label htmlFor={`${idp}-direction`}>{t("finance.salesTax.lineDialog.direction")}</Label>
            <Select
              id={`${idp}-direction`}
              value={direction}
              onChange={(e) => setDirection(e.target.value as Direction)}
            >
              <option value="sale">{t("finance.salesTax.lineDialog.saleOption")}</option>
              <option value="purchase">{t("finance.salesTax.lineDialog.purchaseOption")}</option>
            </Select>
          </div>
          <div>
            <Label htmlFor={`${idp}-code`}>{t("finance.salesTax.lineDialog.taxCode")}</Label>
            <Select id={`${idp}-code`} value={taxCode} onChange={(e) => setTaxCode(e.target.value as TaxCode)}>
              {TAX_CODES.map((c) => (
                <option key={c} value={c}>
                  {t(TAX_CODE_LABEL[c])}
                </option>
              ))}
            </Select>
            <FieldHint>{t(TAX_CODE_HELP[taxCode])}</FieldHint>
          </div>
          <div>
            <Label htmlFor={`${idp}-date`}>{t("finance.common.date")}</Label>
            <Input id={`${idp}-date`} name="transactionDate" type="date" defaultValue={initial.transactionDate} required />
          </div>
          <div>
            <Label htmlFor={`${idp}-counterparty`}>{direction === "sale" ? t("finance.salesTax.lineDialog.customer") : t("finance.salesTax.lineDialog.supplier")}</Label>
            <Input id={`${idp}-counterparty`} name="counterparty" maxLength={200} defaultValue={initial.counterparty} required />
          </div>
          <div>
            <Label htmlFor={`${idp}-reference`}>{t("finance.salesTax.lineDialog.reference")}</Label>
            <Input id={`${idp}-reference`} name="reference" maxLength={100} defaultValue={initial.reference} />
          </div>
          <div>
            <Label htmlFor={`${idp}-amount`}>{t("finance.salesTax.lineDialog.amount")}</Label>
            <Input id={`${idp}-amount`} name="amount" inputMode="decimal" defaultValue={initial.amount} required />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor={`${idp}-description`}>{t("finance.salesTax.lineDialog.description")}</Label>
            <Input id={`${idp}-description`} name="description" maxLength={500} defaultValue={initial.description} />
          </div>
          {taxed ? (
            <>
              <div>
                <Label htmlFor={`${idp}-gst`}>{direction === "sale" ? t("finance.salesTax.lineDialog.gstCharged") : t("finance.salesTax.lineDialog.gstPaid")}</Label>
                <Input id={`${idp}-gst`} name="gst" inputMode="decimal" defaultValue={initial.gst} />
                <FieldHint>
                  {direction === "sale"
                    ? t("finance.salesTax.lineDialog.saleTaxHint")
                    : t("finance.salesTax.lineDialog.purchaseTaxHint")}
                </FieldHint>
              </div>
              <div>
                <Label htmlFor={`${idp}-qst`}>{direction === "sale" ? t("finance.salesTax.lineDialog.qstCharged") : t("finance.salesTax.lineDialog.qstPaid")}</Label>
                <Input id={`${idp}-qst`} name="qst" inputMode="decimal" defaultValue={initial.qst} />
              </div>
              {direction === "purchase" ? (
                <>
                  <div>
                    <Label htmlFor={`${idp}-itc`}>{t("finance.salesTax.lineDialog.itc")}</Label>
                    <Input id={`${idp}-itc`} name="itc" inputMode="decimal" defaultValue={initial.itc} />
                    <FieldHint>{t("finance.salesTax.lineDialog.itcHint")}</FieldHint>
                  </div>
                  <div>
                    <Label htmlFor={`${idp}-itr`}>{t("finance.salesTax.lineDialog.itr")}</Label>
                    <Input id={`${idp}-itr`} name="itr" inputMode="decimal" defaultValue={initial.itr} />
                  </div>
                </>
              ) : null}
            </>
          ) : null}
          <div className="sm:col-span-2">
            <FormError error={error} />
          </div>
          <div className="flex justify-end gap-2 sm:col-span-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              {t("finance.common.cancel")}
            </Button>
            <Button type="submit" loading={pending}>
              {t("finance.salesTax.lineDialog.submit")}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}

export function DeleteTaxLineButton({ lineId, label }: { lineId: string; label: string }) {
  const { pending, error, run, t } = useAction();
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <Button
        variant="ghost"
        loading={pending}
        aria-label={t("finance.salesTax.deleteLine.aria", { label })}
        onClick={() => {
          if (!window.confirm(t("finance.salesTax.deleteLine.confirm", { label }))) return;
          void run(() => deleteTaxLine(lineId), t("finance.salesTax.deleteLine.deleted"));
        }}
      >
        {t("finance.salesTax.deleteLine.button")}
      </Button>
      <FormError error={error} />
    </span>
  );
}

/** Closes a period: freezes its lines and posts its net tax to the ledger. */
export function CloseTaxPeriodButton({ periodId, label }: { periodId: string; label: string }) {
  const { pending, error, run, t } = useAction();
  return (
    <div className="flex flex-col items-end gap-2">
      <Button
        loading={pending}
        onClick={() => {
          if (
            !window.confirm(t("finance.salesTax.closePeriod.confirm", { label }))
          ) {
            return;
          }
          void run(() => closeTaxPeriod(periodId), t("finance.salesTax.closePeriod.closed"));
        }}
      >
        {t("finance.salesTax.closePeriod.button")}
      </Button>
      <FormError error={error} />
    </div>
  );
}

/** Reopens a closed period, reversing its closing entry on a chosen date. */
export function ReopenTaxPeriodButton({
  periodId,
  label,
  defaultDate,
  minDate,
}: {
  periodId: string;
  label: string;
  defaultDate: string;
  minDate: string;
}) {
  const [open, setOpen] = useState(false);
  const { pending, error, run, t } = useAction();
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        {t("finance.salesTax.reopenPeriod.button")}
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={t("finance.salesTax.reopenPeriod.title", { label })}>
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            const ok = await run(
              () => reopenTaxPeriod({ periodId, reversalDate: form.get("reversalDate") }),
              t("finance.salesTax.reopenPeriod.reopened"),
            );
            if (ok) setOpen(false);
          }}
        >
          <p className="text-[13.5px] text-muted">{t("finance.salesTax.reopenPeriod.explanation")}</p>
          <div>
            <Label htmlFor="reopen-date">{t("finance.salesTax.reopenPeriod.date")}</Label>
            <Input id="reopen-date" name="reversalDate" type="date" defaultValue={defaultDate} min={minDate} required />
            <FieldHint>{t("finance.salesTax.reopenPeriod.dateHint", { date: minDate })}</FieldHint>
          </div>
          <FormError error={error} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              {t("finance.common.cancel")}
            </Button>
            <Button type="submit" loading={pending}>
              {t("finance.salesTax.reopenPeriod.submit")}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
