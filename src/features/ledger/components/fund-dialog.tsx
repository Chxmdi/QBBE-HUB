"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Checkbox, FieldHint, Input, Label, Select, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { FUND_RESTRICTIONS, FUND_RESTRICTION_KEY, type FundRestriction } from "@/features/ledger/money";
import { saveFund } from "@/features/ledger/services/ledger.commands";
import { useT } from "@/lib/i18n/client";

export interface FundFormValue {
  id: string;
  code: string;
  name: string;
  restriction: FundRestriction;
  funder: string | null;
  starts_on: string | null;
  ends_on: string | null;
  description: string | null;
  is_active: boolean;
  programIds: string[];
  used: boolean;
}

/** Add or edit a fund (#149): its restriction, funder, dates and programs. */
export function FundDialog({
  fund,
  programs,
}: {
  fund?: FundFormValue;
  programs: { id: string; name: string }[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const t = useT();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [restriction, setRestriction] = useState<FundRestriction>(fund?.restriction ?? "externally_restricted");
  const locked = Boolean(fund?.used);

  return (
    <>
      {fund ? (
        <Button size="sm" variant="ghost" onClick={() => setOpen(true)} aria-label={t("finance.ledger.fundDialog.editTitle", { code: fund.code })}>
          <Pencil className="size-4" aria-hidden />
        </Button>
      ) : (
        <Button onClick={() => setOpen(true)}>
          <Plus className="size-4" aria-hidden />
          {t("finance.ledger.fundDialog.add")}
        </Button>
      )}
      <Dialog open={open} onClose={() => setOpen(false)} title={fund ? t("finance.ledger.fundDialog.editTitle", { code: fund.code }) : t("finance.ledger.fundDialog.addTitle")}>
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setError(null);
            setSaving(true);
            const form = new FormData(e.currentTarget);
            const result = await saveFund({
              id: fund?.id,
              code: String(form.get("code") ?? "").toUpperCase(),
              name: form.get("name"),
              restriction: form.get("restriction"),
              funder: form.get("funder") ?? undefined,
              startsOn: form.get("startsOn") ?? undefined,
              endsOn: form.get("endsOn") ?? undefined,
              description: form.get("description") ?? undefined,
              isActive: form.get("isActive") === "on",
              programIds: form.getAll("programIds").map(String),
            });
            setSaving(false);
            if (!result.ok) {
              setError(result.error ?? t("finance.ledger.fundDialog.saveFailed"));
              return;
            }
            toast(fund ? t("finance.ledger.fundDialog.saved") : t("finance.ledger.fundDialog.added"), { tone: "success" });
            setOpen(false);
            router.refresh();
          }}
        >
          <div className="grid gap-4 sm:grid-cols-[9rem_1fr]">
            <div>
              <Label htmlFor="fund-code">{t("finance.ledger.code")}</Label>
              <Input
                id="fund-code"
                name="code"
                maxLength={20}
                defaultValue={fund?.code}
                readOnly={locked}
                required
                className="uppercase"
              />
            </div>
            <div>
              <Label htmlFor="fund-name">{t("finance.ledger.name")}</Label>
              <Input id="fund-name" name="name" maxLength={200} defaultValue={fund?.name} required />
            </div>
          </div>
          <div>
            <Label htmlFor="fund-restriction">{t("finance.ledger.fundDialog.restriction")}</Label>
            {locked ? (
              <>
                <input type="hidden" name="restriction" value={restriction} />
                <Input id="fund-restriction" value={t(FUND_RESTRICTION_KEY[restriction])} readOnly />
                <FieldHint>{t("finance.ledger.fundDialog.lockedHint")}</FieldHint>
              </>
            ) : (
              <>
                <Select
                  id="fund-restriction"
                  name="restriction"
                  value={restriction}
                  onChange={(e) => setRestriction(e.target.value as FundRestriction)}
                >
                  {FUND_RESTRICTIONS.map((r) => (
                    <option key={r} value={r}>
                      {t(FUND_RESTRICTION_KEY[r])}
                    </option>
                  ))}
                </Select>
                <FieldHint>{t("finance.ledger.fundDialog.restrictionHint")}</FieldHint>
              </>
            )}
          </div>
          <div>
            <Label htmlFor="fund-funder">{t("finance.ledger.fundDialog.funder")}</Label>
            <Input id="fund-funder" name="funder" maxLength={200} defaultValue={fund?.funder ?? ""} />
          </div>
          {restriction !== "unrestricted" ? (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="fund-starts">{t("finance.ledger.fundDialog.spendFrom")}</Label>
                  <Input id="fund-starts" name="startsOn" type="date" defaultValue={fund?.starts_on ?? ""} />
                </div>
                <div>
                  <Label htmlFor="fund-ends">{t("finance.ledger.fundDialog.spendUntil")}</Label>
                  <Input id="fund-ends" name="endsOn" type="date" defaultValue={fund?.ends_on ?? ""} />
                </div>
              </div>
              <fieldset>
                <legend className="mb-1.5 text-[13px] font-medium">{t("finance.ledger.fundDialog.programsLegend")}</legend>
                {programs.length === 0 ? (
                  <p className="text-[13px] text-muted">{t("finance.ledger.fundDialog.noPrograms")}</p>
                ) : (
                  <div className="grid max-h-40 gap-1.5 overflow-y-auto sm:grid-cols-2">
                    {programs.map((p) => (
                      <label key={p.id} className="flex items-center gap-2 text-[13.5px]">
                        <Checkbox name="programIds" value={p.id} defaultChecked={fund?.programIds.includes(p.id)} />
                        {p.name}
                      </label>
                    ))}
                  </div>
                )}
                <FieldHint>{t("finance.ledger.fundDialog.programsHint")}</FieldHint>
              </fieldset>
            </>
          ) : null}
          <div>
            <Label htmlFor="fund-description">{t("finance.ledger.fundDialog.conditions")}</Label>
            <Textarea id="fund-description" name="description" maxLength={1000} defaultValue={fund?.description ?? ""} />
          </div>
          <label className="flex items-center gap-2 text-[13.5px]">
            <Checkbox name="isActive" defaultChecked={fund?.is_active ?? true} />
            {t("finance.ledger.fundDialog.active")}
          </label>
          {error ? (
            <p role="alert" className="text-[13px] text-danger-fg">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              {t("finance.common.cancel")}
            </Button>
            <Button type="submit" loading={saving}>
              {t("finance.common.save")}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
