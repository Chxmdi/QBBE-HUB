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
          "Accountant access granted.",
        );
      }}
    >
      <div>
        <Label htmlFor="accountant-user">Accountant</Label>
        <Select id="accountant-user" name="userId" required defaultValue="">
          <option value="">Choose an invited Guest</option>
          {guests.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <Label htmlFor="accountant-expires">Access ends on</Label>
        <Input id="accountant-expires" name="expiresOn" type="date" required min={minDate} max={maxDate} defaultValue={defaultExpiry} />
        <FieldHint>At most one year.</FieldHint>
      </div>
      <div>
        <Label htmlFor="accountant-note">Note (optional)</Label>
        <Input id="accountant-note" name="note" maxLength={500} placeholder="Firm, engagement" />
      </div>
      <Button type="submit" loading={pending} className="md:mt-6">
        Grant access
      </Button>
      <div className="md:col-span-4">
        <FormError error={error} />
      </div>
    </form>
  );
}

export function RevokeAccountantButton({ grantId, name }: { grantId: string; name: string }) {
  const { pending, error, run } = useAction();
  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        size="sm"
        variant="secondary"
        loading={pending}
        aria-label={`Revoke access for ${name}`}
        onClick={() => {
          if (!window.confirm(`Revoke ${name}'s access to the books now?`)) return;
          void run(() => revokeAccountantAccess(grantId), `${name} can no longer open the books.`);
        }}
      >
        Revoke
      </Button>
      <FormError error={error} />
    </div>
  );
}

export function CloseYearButton({ startsOn, label }: { startsOn: string; label: string }) {
  const { pending, error, run } = useAction();
  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        size="sm"
        loading={pending}
        aria-label={`Close fiscal year ${label}`}
        onClick={() => {
          if (
            !window.confirm(
              `Close fiscal year ${label}? This posts the closing entry and closes every period of the year. ` +
                "It can only be undone by reopening the year, which posts a reopening entry.",
            )
          ) {
            return;
          }
          void run(() => closeFiscalYear({ startsOn, confirm: true }), `Fiscal year ${label} closed.`);
        }}
      >
        Close year
      </Button>
      <FormError error={error} />
    </div>
  );
}

export function ReopenYearForm({ startsOn, label }: { startsOn: string; label: string }) {
  const { pending, error, run } = useAction();
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <Button size="sm" variant="secondary" aria-label={`Reopen fiscal year ${label}`} onClick={() => setOpen(true)}>
        Reopen
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
          `Fiscal year ${label} reopened. A reopening entry was posted.`,
        );
      }}
    >
      <div className="w-64 text-left">
        <Label htmlFor={`reopen-${startsOn}`}>Reason for reopening {label}</Label>
        <Input id={`reopen-${startsOn}`} name="reason" required maxLength={500} />
      </div>
      <div className="flex gap-2">
        <Button size="sm" variant="ghost" type="button" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        <Button size="sm" variant="danger" type="submit" loading={pending}>
          Reopen and post reopening entry
        </Button>
      </div>
      <FormError error={error} />
    </form>
  );
}

export function PrintButton() {
  return (
    <Button variant="secondary" size="sm" onClick={() => window.print()} className="print:hidden">
      <Printer className="size-4" aria-hidden />
      Print
    </Button>
  );
}
