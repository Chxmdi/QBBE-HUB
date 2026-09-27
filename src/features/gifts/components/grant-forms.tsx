"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FieldHint, Input, Label, Select, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { useT } from "@/lib/i18n/client";
import {
  addGrantReport,
  deleteGrantReport,
  saveGrant,
  setGrantReportSubmitted,
} from "@/features/gifts/services/gift.commands";

interface Option {
  id: string;
  label: string;
}

export interface GrantFormValue {
  id: string;
  funder_crm_organization_id: string;
  funder_contact_id: string | null;
  title: string;
  funder_reference: string | null;
  amount: string;
  awarded_on: string | null;
  starts_on: string | null;
  ends_on: string | null;
  fund_id: string;
  program_id: string | null;
  restrictions: string | null;
  responsible_user_id: string | null;
  status: "active" | "closed";
}

export interface GrantOptions {
  funders: Option[];
  contacts: Option[];
  funds: Option[];
  programs: Option[];
  staff: Option[];
}

/** Adds or edits a grant: funder, amount, restrictions and the fund that tracks it. */
export function GrantDialog({ grant, options }: { grant?: GrantFormValue; options: GrantOptions }) {
  const router = useRouter();
  const { toast } = useToast();
  const t = useT();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      {grant ? (
        <Button variant="secondary" onClick={() => setOpen(true)}>
          <Pencil className="size-4" aria-hidden />
          {t("finance.gifts.grantDialog.edit")}
        </Button>
      ) : (
        <Button onClick={() => setOpen(true)}>
          <Plus className="size-4" aria-hidden />
          {t("finance.gifts.grantDialog.add")}
        </Button>
      )}
      <Dialog open={open} onClose={() => setOpen(false)} title={grant ? t("finance.gifts.grantDialog.edit") : t("finance.gifts.grantDialog.add")} className="max-w-2xl">
        {options.funders.length === 0 ? (
          <p className="text-[13.5px] text-muted">{t("finance.gifts.grantDialog.noFunders")}</p>
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
              const result = await saveGrant({
                id: grant?.id,
                funderId: str("funderId"),
                funderContactId: str("funderContactId"),
                title: str("title"),
                funderReference: str("funderReference"),
                amount: str("amount"),
                awardedOn: str("awardedOn"),
                startsOn: str("startsOn"),
                endsOn: str("endsOn"),
                fundId: str("fundId"),
                programId: str("programId"),
                restrictions: str("restrictions"),
                responsibleUserId: str("responsibleUserId"),
                status: str("status") ?? "active",
              });
              setSaving(false);
              if (!result.ok) {
                setError(result.error ?? t("finance.gifts.grantDialog.couldNotSave"));
                return;
              }
              toast(grant ? t("finance.gifts.grantDialog.saved") : t("finance.gifts.grantDialog.added"), { tone: "success" });
              setOpen(false);
              if (!grant) router.push(`/finance/gifts/grants/${result.id}`);
              router.refresh();
            }}
          >
            <div>
              <Label htmlFor="grant-title">{t("finance.gifts.grantDialog.name")}</Label>
              <Input id="grant-title" name="title" maxLength={200} defaultValue={grant?.title} required />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="grant-funder">{t("finance.gifts.grantDialog.funder")}</Label>
                <Select id="grant-funder" name="funderId" defaultValue={grant?.funder_crm_organization_id ?? ""} required>
                  <option value="">{t("finance.gifts.grantDialog.chooseFromCrm")}</option>
                  {options.funders.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="grant-contact">{t("finance.gifts.grantDialog.contactOptional")}</Label>
                <Select id="grant-contact" name="funderContactId" defaultValue={grant?.funder_contact_id ?? ""}>
                  <option value="">{t("finance.common.none")}</option>
                  {options.contacts.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="grant-amount">{t("finance.gifts.grantDialog.amountAwarded")}</Label>
                <Input id="grant-amount" name="amount" inputMode="decimal" defaultValue={grant?.amount} required />
              </div>
              <div>
                <Label htmlFor="grant-reference">{t("finance.gifts.grantDialog.referenceOptional")}</Label>
                <Input id="grant-reference" name="funderReference" maxLength={100} defaultValue={grant?.funder_reference ?? ""} />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <Label htmlFor="grant-awarded">{t("finance.gifts.grantDialog.awardedOn")}</Label>
                <Input id="grant-awarded" name="awardedOn" type="date" defaultValue={grant?.awarded_on ?? ""} />
              </div>
              <div>
                <Label htmlFor="grant-starts">{t("finance.gifts.grantDialog.starts")}</Label>
                <Input id="grant-starts" name="startsOn" type="date" defaultValue={grant?.starts_on ?? ""} />
              </div>
              <div>
                <Label htmlFor="grant-ends">{t("finance.gifts.grantDialog.ends")}</Label>
                <Input id="grant-ends" name="endsOn" type="date" defaultValue={grant?.ends_on ?? ""} />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="grant-fund">{t("finance.common.fund")}</Label>
                <Select id="grant-fund" name="fundId" defaultValue={grant?.fund_id ?? ""} required>
                  <option value="">{t("finance.gifts.grantDialog.chooseFund")}</option>
                  {options.funds.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </Select>
                <FieldHint>{t("finance.gifts.grantDialog.fundHint")}</FieldHint>
              </div>
              <div>
                <Label htmlFor="grant-program">{t("finance.gifts.grantDialog.programOptional")}</Label>
                <Select id="grant-program" name="programId" defaultValue={grant?.program_id ?? ""}>
                  <option value="">{t("finance.gifts.grantDialog.anyProgram")}</option>
                  {options.programs.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            <div>
              <Label htmlFor="grant-restrictions">{t("finance.gifts.grantDialog.restrictions")}</Label>
              <Textarea id="grant-restrictions" name="restrictions" maxLength={2000} defaultValue={grant?.restrictions ?? ""} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="grant-responsible">{t("finance.gifts.grantDialog.responsible")}</Label>
                <Select id="grant-responsible" name="responsibleUserId" defaultValue={grant?.responsible_user_id ?? ""}>
                  <option value="">{t("finance.gifts.grantDialog.ownersAndAdmins")}</option>
                  {options.staff.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </Select>
                <FieldHint>{t("finance.gifts.grantDialog.responsibleHint")}</FieldHint>
              </div>
              {grant ? (
                <div>
                  <Label htmlFor="grant-status">{t("finance.common.status")}</Label>
                  <Select id="grant-status" name="status" defaultValue={grant.status}>
                    <option value="active">{t("finance.gifts.grantDialog.active")}</option>
                    <option value="closed">{t("finance.gifts.grantDialog.closedNoReminders")}</option>
                  </Select>
                </div>
              ) : null}
            </div>
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
                {t("finance.gifts.grantDialog.save")}
              </Button>
            </div>
          </form>
        )}
      </Dialog>
    </>
  );
}

export function AddReportForm({ grantId }: { grantId: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const t = useT();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      aria-label={t("finance.gifts.reportForm.formLabel")}
      onSubmit={async (e) => {
        e.preventDefault();
        const formEl = e.currentTarget;
        setError(null);
        setSaving(true);
        const form = new FormData(formEl);
        const result = await addGrantReport({ grantId, title: form.get("title"), dueOn: form.get("dueOn") });
        setSaving(false);
        if (!result.ok) {
          setError(result.error ?? t("finance.gifts.reportForm.couldNotAdd"));
          return;
        }
        formEl.reset();
        toast(t("finance.gifts.reportForm.added"), { tone: "success" });
        router.refresh();
      }}
    >
      <div className="min-w-48 flex-1">
        <Label htmlFor="report-title">{t("finance.gifts.reportForm.report")}</Label>
        <Input id="report-title" name="title" maxLength={200} placeholder={t("finance.gifts.reportForm.placeholder")} required />
      </div>
      <div>
        <Label htmlFor="report-due">{t("finance.gifts.reportForm.due")}</Label>
        <Input id="report-due" name="dueOn" type="date" required />
      </div>
      <Button type="submit" loading={saving}>
        {t("finance.gifts.reportForm.add")}
      </Button>
      {error ? (
        <p role="alert" className="w-full text-[13px] text-danger-fg">
          {error}
        </p>
      ) : null}
    </form>
  );
}

export function ReportControls({
  reportId,
  submitted,
  today,
}: {
  reportId: string;
  submitted: boolean;
  today: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const t = useT();
  const [pending, setPending] = useState(false);
  const run = async (fn: () => Promise<{ ok: boolean; error?: string }>, done: string) => {
    setPending(true);
    const result = await fn();
    setPending(false);
    toast(result.ok ? done : (result.error ?? t("finance.gifts.reportForm.couldNotUpdate")), { tone: result.ok ? "success" : "error" });
    router.refresh();
  };
  return (
    <div className="flex flex-wrap justify-end gap-2">
      {submitted ? (
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => setGrantReportSubmitted({ reportId, submittedOn: "" }), t("finance.gifts.reportForm.markedNotSubmitted"))}>
          {t("finance.gifts.reportForm.undoSubmitted")}
        </Button>
      ) : (
        <>
          <Button size="sm" variant="secondary" disabled={pending} onClick={() => run(() => setGrantReportSubmitted({ reportId, submittedOn: today }), t("finance.gifts.reportForm.markedSubmitted"))}>
            {t("finance.gifts.reportForm.markSubmitted")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() => {
              if (window.confirm(t("finance.gifts.reportForm.confirmRemove"))) void run(() => deleteGrantReport(reportId), t("finance.gifts.reportForm.removed"));
            }}
          >
            {t("finance.gifts.reportForm.remove")}
          </Button>
        </>
      )}
    </div>
  );
}
