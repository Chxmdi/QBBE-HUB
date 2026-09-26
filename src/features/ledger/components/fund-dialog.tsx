"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Checkbox, FieldHint, Input, Label, Select, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { FUND_RESTRICTIONS, FUND_RESTRICTION_LABEL, type FundRestriction } from "@/features/ledger/money";
import { saveFund } from "@/features/ledger/services/ledger.commands";

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
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [restriction, setRestriction] = useState<FundRestriction>(fund?.restriction ?? "externally_restricted");
  const locked = Boolean(fund?.used);

  return (
    <>
      {fund ? (
        <Button size="sm" variant="ghost" onClick={() => setOpen(true)} aria-label={`Edit fund ${fund.code}`}>
          <Pencil className="size-4" aria-hidden />
        </Button>
      ) : (
        <Button onClick={() => setOpen(true)}>
          <Plus className="size-4" aria-hidden />
          Add fund
        </Button>
      )}
      <Dialog open={open} onClose={() => setOpen(false)} title={fund ? `Edit fund ${fund.code}` : "Add a fund"}>
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
              setError(result.error ?? "Could not save the fund.");
              return;
            }
            toast(fund ? "Fund saved." : "Fund added.", { tone: "success" });
            setOpen(false);
            router.refresh();
          }}
        >
          <div className="grid gap-4 sm:grid-cols-[9rem_1fr]">
            <div>
              <Label htmlFor="fund-code">Code</Label>
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
              <Label htmlFor="fund-name">Name</Label>
              <Input id="fund-name" name="name" maxLength={200} defaultValue={fund?.name} required />
            </div>
          </div>
          <div>
            <Label htmlFor="fund-restriction">Restriction</Label>
            {locked ? (
              <>
                <input type="hidden" name="restriction" value={restriction} />
                <Input id="fund-restriction" value={FUND_RESTRICTION_LABEL[restriction]} readOnly />
                <FieldHint>This fund has entries, so its code and restriction stay as they are.</FieldHint>
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
                      {FUND_RESTRICTION_LABEL[r]}
                    </option>
                  ))}
                </Select>
                <FieldHint>
                  Externally restricted: a funder set conditions. Internally restricted: the board set it aside.
                </FieldHint>
              </>
            )}
          </div>
          <div>
            <Label htmlFor="fund-funder">Funder (optional)</Label>
            <Input id="fund-funder" name="funder" maxLength={200} defaultValue={fund?.funder ?? ""} />
          </div>
          {restriction !== "unrestricted" ? (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="fund-starts">Spend from (optional)</Label>
                  <Input id="fund-starts" name="startsOn" type="date" defaultValue={fund?.starts_on ?? ""} />
                </div>
                <div>
                  <Label htmlFor="fund-ends">Spend until (optional)</Label>
                  <Input id="fund-ends" name="endsOn" type="date" defaultValue={fund?.ends_on ?? ""} />
                </div>
              </div>
              <fieldset>
                <legend className="mb-1.5 text-[13px] font-medium">Programs it may pay for</legend>
                {programs.length === 0 ? (
                  <p className="text-[13px] text-muted">No active programs.</p>
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
                <FieldHint>
                  Expenses charged to this fund must be inside these dates and name one of these programs. None
                  ticked means any program.
                </FieldHint>
              </fieldset>
            </>
          ) : null}
          <div>
            <Label htmlFor="fund-description">Conditions and notes (optional)</Label>
            <Textarea id="fund-description" name="description" maxLength={1000} defaultValue={fund?.description ?? ""} />
          </div>
          <label className="flex items-center gap-2 text-[13.5px]">
            <Checkbox name="isActive" defaultChecked={fund?.is_active ?? true} />
            Active (inactive funds cannot be used in new entries)
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
