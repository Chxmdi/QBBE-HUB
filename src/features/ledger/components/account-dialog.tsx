"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Checkbox, FieldHint, Input, Label, Select, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { ACCOUNT_TYPES, ACCOUNT_TYPE_LABEL, type AccountType } from "@/features/ledger/money";
import { saveAccount } from "@/features/ledger/services/ledger.commands";

export interface AccountFormValue {
  id: string;
  code: string;
  name: string;
  account_type: AccountType;
  description: string | null;
  is_active: boolean;
  used: boolean;
}

/** Add an account, or edit one. Used accounts keep their code and type. */
export function AccountDialog({ account }: { account?: AccountFormValue }) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const locked = Boolean(account?.used);

  return (
    <>
      {account ? (
        <Button size="sm" variant="ghost" onClick={() => setOpen(true)} aria-label={`Edit account ${account.code}`}>
          <Pencil className="size-4" aria-hidden />
        </Button>
      ) : (
        <Button onClick={() => setOpen(true)}>
          <Plus className="size-4" aria-hidden />
          Add account
        </Button>
      )}
      <Dialog open={open} onClose={() => setOpen(false)} title={account ? `Edit account ${account.code}` : "Add an account"}>
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setError(null);
            setSaving(true);
            const form = new FormData(e.currentTarget);
            const result = await saveAccount({
              id: account?.id,
              code: form.get("code"),
              name: form.get("name"),
              accountType: form.get("accountType"),
              description: form.get("description") ?? undefined,
              isActive: form.get("isActive") === "on",
            });
            setSaving(false);
            if (!result.ok) {
              setError(result.error ?? "Could not save the account.");
              return;
            }
            toast(account ? "Account saved." : "Account added.", { tone: "success" });
            setOpen(false);
            router.refresh();
          }}
        >
          <div className="grid gap-4 sm:grid-cols-[8rem_1fr]">
            <div>
              <Label htmlFor="account-code">Code</Label>
              <Input
                id="account-code"
                name="code"
                inputMode="numeric"
                pattern="[0-9]{3,6}"
                defaultValue={account?.code}
                readOnly={locked}
                required
              />
            </div>
            <div>
              <Label htmlFor="account-name">Name</Label>
              <Input id="account-name" name="name" maxLength={200} defaultValue={account?.name} required />
            </div>
          </div>
          <div>
            <Label htmlFor="account-type">Type</Label>
            {locked ? (
              <>
                <input type="hidden" name="accountType" value={account?.account_type} />
                <Input id="account-type" value={ACCOUNT_TYPE_LABEL[account!.account_type]} readOnly />
                <FieldHint>This account has entries, so its code and type stay as they are.</FieldHint>
              </>
            ) : (
              <Select id="account-type" name="accountType" defaultValue={account?.account_type ?? "expense"}>
                {ACCOUNT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {ACCOUNT_TYPE_LABEL[t]}
                  </option>
                ))}
              </Select>
            )}
          </div>
          <div>
            <Label htmlFor="account-description">Description (optional)</Label>
            <Textarea
              id="account-description"
              name="description"
              maxLength={1000}
              defaultValue={account?.description ?? ""}
            />
          </div>
          <label className="flex items-center gap-2 text-[13.5px]">
            <Checkbox name="isActive" defaultChecked={account?.is_active ?? true} />
            Active (inactive accounts cannot be used in new entries)
          </label>
          {error ? (
            <p role="alert" className="text-[13px] text-danger-fg">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={saving}>
              Save
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
