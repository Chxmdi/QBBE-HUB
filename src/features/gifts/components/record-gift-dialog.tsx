"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Checkbox, FieldHint, Input, Label, Select, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { recordGift } from "@/features/gifts/services/gift.commands";

export interface Option {
  id: string;
  label: string;
}

export interface RecordGiftOptions {
  contacts: Option[];
  organizations: Option[];
  funds: Option[];
  programs: Option[];
  grants: (Option & { funderId: string; fundId: string })[];
  debitAccounts: (Option & { code: string })[];
  creditAccounts: (Option & { code: string })[];
  today: string;
}

type GiftType = "donation" | "grant_payment" | "in_kind";

/**
 * Records a gift or grant payment and posts it to the ledger (#156). Donors
 * are chosen from the CRM, never typed here, so nobody is duplicated.
 */
export function RecordGiftDialog({ options }: { options: RecordGiftOptions }) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [type, setType] = useState<GiftType>("donation");
  const [grantId, setGrantId] = useState("");
  const [amount, setAmount] = useState("");
  const [valueByDonor, setValueByDonor] = useState(false);

  const grant = options.grants.find((g) => g.id === grantId);
  const byCode = (list: (Option & { code: string })[], code: string) => list.find((a) => a.code === code)?.id ?? "";
  const posts = type !== "in_kind" || (amount.trim() !== "" && valueByDonor);
  const defaultDebit = type === "in_kind" ? byCode(options.debitAccounts, "5400") : byCode(options.debitAccounts, "1000");
  const defaultCredit = byCode(options.creditAccounts, type === "grant_payment" ? "4100" : "4200");
  const noDonors = options.contacts.length + options.organizations.length === 0;

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus className="size-4" aria-hidden />
        Record a gift
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Record a gift" className="max-w-2xl">
        {noDonors ? (
          <p className="text-[13.5px] text-muted">
            Add the donor to Relationships (the CRM) first. Gifts are always linked to a CRM contact or organization.
          </p>
        ) : (
          <form
            className="space-y-4"
            onSubmit={async (e) => {
              e.preventDefault();
              setError(null);
              setSaving(true);
              const form = new FormData(e.currentTarget);
              const str = (name: string) => {
                const v = form.get(name);
                return typeof v === "string" ? v : undefined;
              };
              const result = await recordGift({
                giftType: type,
                donor: type === "grant_payment" && grant ? `organization:${grant.funderId}` : str("donor"),
                receivedOn: str("receivedOn"),
                amount: str("amount"),
                inKindDescription: str("inKindDescription"),
                valueSuppliedByDonor: valueByDonor,
                fundId: type === "grant_payment" ? undefined : str("fundId"),
                programId: str("programId"),
                donorRestriction: str("donorRestriction"),
                grantId: type === "grant_payment" ? grantId : undefined,
                debitAccountId: posts ? str("debitAccountId") : undefined,
                creditAccountId: posts ? str("creditAccountId") : undefined,
                note: str("note"),
              });
              setSaving(false);
              if (!result.ok) {
                setError(result.error ?? "Could not record the gift.");
                return;
              }
              toast(posts ? "Gift recorded and posted to the ledger." : "Gift recorded.", { tone: "success" });
              setOpen(false);
              router.push(`/finance/gifts/${result.id}`);
              router.refresh();
            }}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="gift-type">Kind of gift</Label>
                <Select id="gift-type" value={type} onChange={(e) => setType(e.target.value as GiftType)}>
                  <option value="donation">Donation (money)</option>
                  <option value="grant_payment">Grant payment</option>
                  <option value="in_kind">In-kind gift (goods or services)</option>
                </Select>
              </div>
              <div>
                <Label htmlFor="gift-received">Date received</Label>
                <Input id="gift-received" name="receivedOn" type="date" max={options.today} defaultValue={options.today} required />
              </div>
            </div>

            {type === "grant_payment" ? (
              <div>
                <Label htmlFor="gift-grant">Grant</Label>
                <Select id="gift-grant" value={grantId} onChange={(e) => setGrantId(e.target.value)} required>
                  <option value="">Choose a grant</option>
                  {options.grants.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.label}
                    </option>
                  ))}
                </Select>
                <FieldHint>The payment comes from the grant&apos;s funder and goes to the grant&apos;s fund.</FieldHint>
              </div>
            ) : (
              <div>
                <Label htmlFor="gift-donor">Donor</Label>
                <Select id="gift-donor" name="donor" required defaultValue="">
                  <option value="">Choose from the CRM</option>
                  {options.contacts.length ? (
                    <optgroup label="People">
                      {options.contacts.map((c) => (
                        <option key={c.id} value={`contact:${c.id}`}>
                          {c.label}
                        </option>
                      ))}
                    </optgroup>
                  ) : null}
                  {options.organizations.length ? (
                    <optgroup label="Organizations">
                      {options.organizations.map((o) => (
                        <option key={o.id} value={`organization:${o.id}`}>
                          {o.label}
                        </option>
                      ))}
                    </optgroup>
                  ) : null}
                </Select>
                <FieldHint>Not listed? Add them in Relationships first.</FieldHint>
              </div>
            )}

            {type === "in_kind" ? (
              <div>
                <Label htmlFor="gift-description">What was given</Label>
                <Textarea id="gift-description" name="inKindDescription" maxLength={1000} required />
              </div>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="gift-amount">
                  {type === "in_kind" ? "Value stated by the donor (optional)" : "Amount received"}
                </Label>
                <Input
                  id="gift-amount"
                  name="amount"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  required={type !== "in_kind"}
                />
              </div>
              {type === "in_kind" ? (
                <label className="mt-6 flex items-start gap-2 text-[13.5px]">
                  <Checkbox checked={valueByDonor} onChange={(e) => setValueByDonor(e.target.checked)} />
                  <span>The donor supplied this value. QBBE does not put a value on in-kind gifts itself.</span>
                </label>
              ) : null}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              {type === "grant_payment" ? null : (
                <div>
                  <Label htmlFor="gift-fund">Fund</Label>
                  <Select id="gift-fund" name="fundId" required defaultValue={options.funds[0]?.id ?? ""}>
                    {options.funds.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.label}
                      </option>
                    ))}
                  </Select>
                  <FieldHint>General fund for unrestricted gifts; a restricted fund when the donor set conditions.</FieldHint>
                </div>
              )}
              <div>
                <Label htmlFor="gift-program">Restricted to a program (optional)</Label>
                <Select id="gift-program" name="programId" defaultValue="">
                  <option value="">No program restriction</option>
                  {options.programs.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            <div>
              <Label htmlFor="gift-restriction">Donor&apos;s own words about how it may be used (optional)</Label>
              <Input id="gift-restriction" name="donorRestriction" maxLength={1000} />
            </div>

            {posts ? (
              <fieldset className="rounded-(--radius-sm) border border-line p-3">
                <legend className="px-1 text-[13px] font-medium">Ledger entry</legend>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="gift-debit">Debit</Label>
                    <Select id="gift-debit" name="debitAccountId" key={`d-${type}`} defaultValue={defaultDebit} required>
                      {options.debitAccounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.label}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="gift-credit">Credit</Label>
                    <Select id="gift-credit" name="creditAccountId" key={`c-${type}`} defaultValue={defaultCredit} required>
                      {options.creditAccounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.label}
                        </option>
                      ))}
                    </Select>
                  </div>
                </div>
                <FieldHint>
                  Posted at once, dated the day received. A posted entry never changes; to correct it, void the gift.
                </FieldHint>
              </fieldset>
            ) : (
              <p className="text-[13px] text-muted">No dollar value, so nothing is posted to the ledger.</p>
            )}

            <div>
              <Label htmlFor="gift-note">Internal note (optional)</Label>
              <Input id="gift-note" name="note" maxLength={1000} />
            </div>

            {error ? (
              <p role="alert" className="text-[13.5px] text-danger-fg">
                {error}
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" loading={saving}>
                {posts ? "Record and post" : "Record gift"}
              </Button>
            </div>
          </form>
        )}
      </Dialog>
    </>
  );
}
