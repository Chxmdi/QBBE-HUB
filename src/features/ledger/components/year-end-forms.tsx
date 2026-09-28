"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FieldHint, Input, Label, Select } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import {
  closeFiscalYear,
  grantAccountantAccess,
  reopenFiscalYear,
  revokeAccountantAccess,
} from "@/features/ledger/services/year-end.commands";
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
      setError(result.error ?? t("ui.somethingWrong"));
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

export interface GuestOption {
  id: string;
  name: string;
}

/** An admin gives an invited Guest time-limited, read-only access to the books. */
export function GrantAccountantForm({
  guests,
  defaultExpiry,
  minDate,
  maxDate,
}: {
  guests: GuestOption[];
  defaultExpiry: string;
  minDate: string;
  maxDate: string;
}) {
  const { pending, error, run } = useAction();
  const t = useT();
  return (
    <form
      className="grid gap-3 md:grid-cols-[1fr_11rem_1fr_auto] md:items-start"
      onSubmit={(e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        void run(
          () =>
            grantAccountantAccess({
              userId: form.get("userId") || undefined,
              expiresOn: form.get("expiresOn"),
              note: form.get("note") || undefined,
            }),
          t("finance.ledgerReports.yearEndForms.grantSuccess"),
        );
      }}
    >
      <div>
        <Label htmlFor="accountant-user">{t("finance.ledgerReports.yearEndForms.accountant")}</Label>
        <Select id="accountant-user" name="userId" required defaultValue="">
          <option value="">{t("finance.ledgerReports.yearEndForms.chooseGuest")}</option>
          {guests.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <Label htmlFor="accountant-expires">{t("finance.ledgerReports.yearEndForms.accessEndsOn")}</Label>
        <Input id="accountant-expires" name="expiresOn" type="date" required min={minDate} max={maxDate} defaultValue={defaultExpiry} />
        <FieldHint>{t("finance.ledgerReports.yearEndForms.atMostOneYear")}</FieldHint>
      </div>
      <div>
        <Label htmlFor="accountant-note">{t("finance.ledgerReports.yearEndForms.noteOptional")}</Label>
        <Input
          id="accountant-note"
          name="note"
          maxLength={500}
          placeholder={t("finance.ledgerReports.yearEndForms.notePlaceholder")}
        />
      </div>
      <Button type="submit" loading={pending} className="md:mt-6">
        {t("finance.ledgerReports.yearEndForms.grantAccess")}
      </Button>
      <div className="md:col-span-4">
        <FormError error={error} />
      </div>
    </form>
  );
}

export function RevokeAccountantButton({ grantId, name }: { grantId: string; name: string }) {
  const { pending, error, run } = useAction();
  const t = useT();
  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        size="sm"
        variant="secondary"
        loading={pending}
        aria-label={t("finance.ledgerReports.yearEndForms.revokeAria", { name })}
        onClick={() => {
          if (!window.confirm(t("finance.ledgerReports.yearEndForms.revokeConfirm", { name }))) return;
          void run(
            () => revokeAccountantAccess(grantId),
            t("finance.ledgerReports.yearEndForms.revokeSuccess", { name }),
          );
        }}
      >
        {t("finance.ledgerReports.yearEndForms.revoke")}
      </Button>
      <FormError error={error} />
    </div>
  );
}

export function CloseYearButton({ startsOn, label }: { startsOn: string; label: string }) {
  const { pending, error, run } = useAction();
  const t = useT();
  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        size="sm"
        loading={pending}
        aria-label={t("finance.ledgerReports.yearEndForms.closeAria", { label })}
        onClick={() => {
          if (!window.confirm(t("finance.ledgerReports.yearEndForms.closeConfirm", { label }))) return;
          void run(
            () => closeFiscalYear({ startsOn, confirm: true }),
            t("finance.ledgerReports.yearEndForms.closeSuccess", { label }),
          );
        }}
      >
        {t("finance.ledgerReports.yearEndForms.closeYear")}
      </Button>
      <FormError error={error} />
    </div>
  );
}

export function ReopenYearForm({ startsOn, label }: { startsOn: string; label: string }) {
  const { pending, error, run } = useAction();
  const t = useT();
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <Button
        size="sm"
        variant="secondary"
        aria-label={t("finance.ledgerReports.yearEndForms.reopenAria", { label })}
        onClick={() => setOpen(true)}
      >
        {t("finance.ledgerReports.yearEndForms.reopen")}
      </Button>
    );
  }
  return (
    <form
      className="flex flex-col items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        void run(
          () => reopenFiscalYear({ startsOn, reason: form.get("reason") }),
          t("finance.ledgerReports.yearEndForms.reopenSuccess", { label }),
        );
      }}
    >
      <div className="w-64 text-left">
        <Label htmlFor={`reopen-${startsOn}`}>{t("finance.ledgerReports.yearEndForms.reopenReason", { label })}</Label>
        <Input id={`reopen-${startsOn}`} name="reason" required maxLength={500} />
      </div>
      <div className="flex gap-2">
        <Button size="sm" variant="ghost" type="button" onClick={() => setOpen(false)}>
          {t("finance.common.cancel")}
        </Button>
        <Button size="sm" variant="danger" type="submit" loading={pending}>
          {t("finance.ledgerReports.yearEndForms.reopenSubmit")}
        </Button>
      </div>
      <FormError error={error} />
    </form>
  );
}

export function PrintButton() {
  const t = useT();
  return (
    <Button variant="secondary" size="sm" onClick={() => window.print()} className="print:hidden">
      <Printer className="size-4" aria-hidden />
      {t("finance.common.print")}
    </Button>
  );
}
