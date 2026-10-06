"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Checkbox, FieldHint, Input, Label, Select, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { useT } from "@/lib/i18n/client";
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
  const t = useT();
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
        {t("finance.gifts.recordDialog.button")}
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={t("finance.gifts.recordDialog.button")} className="max-w-2xl">
        {noDonors ? (
          <p className="text-[13.5px] text-muted">{t("finance.gifts.recordDialog.noDonors")}</p>
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
                setError(result.error ?? t("finance.gifts.recordDialog.couldNotRecord"));
                return;
              }
              toast(posts ? t("finance.gifts.recordDialog.recordedAndPosted") : t("finance.gifts.recordDialog.recorded"), { tone: "success" });
              setOpen(false);
              router.push(`/finance/gifts/${result.id}`);
              router.refresh();
            }}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="gift-type">{t("finance.gifts.recordDialog.kind")}</Label>
                <Select id="gift-type" value={type} onChange={(e) => setType(e.target.value as GiftType)}>
                  <option value="donation">{t("finance.gifts.recordDialog.typeDonation")}</option>
                  <option value="grant_payment">{t("finance.gifts.recordDialog.typeGrantPayment")}</option>
                  <option value="in_kind">{t("finance.gifts.recordDialog.typeInKind")}</option>
                </Select>
              </div>
              <div>
                <Label htmlFor="gift-received">{t("finance.gifts.recordDialog.dateReceived")}</Label>
                <Input id="gift-received" name="receivedOn" type="date" max={options.today} defaultValue={options.today} required />
              </div>
            </div>

            {type === "grant_payment" ? (
              <div>
                <Label htmlFor="gift-grant">{t("finance.gifts.recordDialog.grant")}</Label>
                <Select id="gift-grant" value={grantId} onChange={(e) => setGrantId(e.target.value)} required>
                  <option value="">{t("finance.gifts.recordDialog.chooseGrant")}</option>
                  {options.grants.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.label}
                    </option>
                  ))}
                </Select>
                <FieldHint>{t("finance.gifts.recordDialog.grantHint")}</FieldHint>
              </div>
            ) : (
              <div>
                <Label htmlFor="gift-donor">{t("finance.gifts.recordDialog.donor")}</Label>
                <Select id="gift-donor" name="donor" required defaultValue="">
                  <option value="">{t("finance.gifts.recordDialog.chooseFromCrm")}</option>
                  {options.contacts.length ? (
                    <optgroup label={t("finance.gifts.recordDialog.people")}>
                      {options.contacts.map((c) => (
                        <option key={c.id} value={`contact:${c.id}`}>
                          {c.label}
                        </option>
                      ))}
                    </optgroup>
                  ) : null}
                  {options.organizations.length ? (
                    <optgroup label={t("finance.gifts.recordDialog.organizations")}>
                      {options.organizations.map((o) => (
                        <option key={o.id} value={`organization:${o.id}`}>
                          {o.label}
                        </option>
                      ))}
                    </optgroup>
                  ) : null}
                </Select>
                <FieldHint>{t("finance.gifts.recordDialog.notListed")}</FieldHint>
              </div>
            )}

            {type === "in_kind" ? (
              <div>
                <Label htmlFor="gift-description">{t("finance.gifts.recordDialog.whatWasGiven")}</Label>
                <Textarea id="gift-description" name="inKindDescription" maxLength={1000} required />
              </div>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="gift-amount">
                  {type === "in_kind" ? t("finance.gifts.recordDialog.valueOptional") : t("finance.gifts.recordDialog.amountReceived")}
                </Label>
                <Input
                  id="gift-amount"
                  name="amount"
                  inputMode="decimal"
                  placeholder={t("finance.gifts.recordDialog.amountPlaceholder")}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  required={type !== "in_kind"}
                />
              </div>
              {type === "in_kind" ? (
                <label className="mt-6 flex items-start gap-2 text-[13.5px]">
                  <Checkbox checked={valueByDonor} onChange={(e) => setValueByDonor(e.target.checked)} />
                  <span>{t("finance.gifts.recordDialog.donorSuppliedValue")}</span>
                </label>
              ) : null}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              {type === "grant_payment" ? null : (
                <div>
                  <Label htmlFor="gift-fund">{t("finance.common.fund")}</Label>
                  <Select id="gift-fund" name="fundId" required defaultValue={options.funds[0]?.id ?? ""}>
                    {options.funds.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.label}
                      </option>
                    ))}
                  </Select>
                  <FieldHint>{t("finance.gifts.recordDialog.fundHint")}</FieldHint>
                </div>
              )}
              <div>
                <Label htmlFor="gift-program">{t("finance.gifts.recordDialog.programOptional")}</Label>
                <Select id="gift-program" name="programId" defaultValue="">
                  <option value="">{t("finance.gifts.recordDialog.noProgramRestriction")}</option>
                  {options.programs.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            <div>
              <Label htmlFor="gift-restriction">{t("finance.gifts.recordDialog.donorWords")}</Label>
              <Input id="gift-restriction" name="donorRestriction" maxLength={1000} />
            </div>

            {posts ? (
              <fieldset className="rounded-(--radius-sm) border border-line p-3">
                <legend className="px-1 text-[13px] font-medium">{t("finance.gifts.recordDialog.ledgerEntry")}</legend>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="gift-debit">{t("finance.common.debit")}</Label>
                    <Select id="gift-debit" name="debitAccountId" key={`d-${type}`} defaultValue={defaultDebit} required>
                      {options.debitAccounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.label}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="gift-credit">{t("finance.common.credit")}</Label>
                    <Select id="gift-credit" name="creditAccountId" key={`c-${type}`} defaultValue={defaultCredit} required>
                      {options.creditAccounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.label}
                        </option>
                      ))}
                    </Select>
                  </div>
                </div>
                <FieldHint>{t("finance.gifts.recordDialog.postingHint")}</FieldHint>
              </fieldset>
            ) : (
              <p className="text-[13px] text-muted">{t("finance.gifts.recordDialog.nothingPosted")}</p>
            )}

            <div>
              <Label htmlFor="gift-note">{t("finance.gifts.recordDialog.noteOptional")}</Label>
              <Input id="gift-note" name="note" maxLength={1000} />
            </div>

            {error ? (
              <p role="alert" className="text-[13.5px] text-danger-fg">
                {error}
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
                {t("finance.common.cancel")}
              </Button>
              <Button type="submit" loading={saving}>
                {posts ? t("finance.gifts.recordDialog.recordAndPost") : t("finance.gifts.recordDialog.recordGift")}
              </Button>
            </div>
          </form>
        )}
      </Dialog>
    </>
  );
}
