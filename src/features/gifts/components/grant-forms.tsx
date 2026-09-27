"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FieldHint, Input, Label, Select, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
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
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      {grant ? (
        <Button variant="secondary" onClick={() => setOpen(true)}>
          <Pencil className="size-4" aria-hidden />
          Edit grant
        </Button>
      ) : (
        <Button onClick={() => setOpen(true)}>
          <Plus className="size-4" aria-hidden />
          Add a grant
        </Button>
      )}
      <Dialog open={open} onClose={() => setOpen(false)} title={grant ? "Edit grant" : "Add a grant"} className="max-w-2xl">
        {options.funders.length === 0 ? (
          <p className="text-[13.5px] text-muted">Add the funder to Relationships (the CRM) as an organization first.</p>
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
                setError(result.error ?? "Could not save the grant.");
                return;
              }
              toast(grant ? "Grant saved." : "Grant added.", { tone: "success" });
              setOpen(false);
              if (!grant) router.push(`/finance/gifts/grants/${result.id}`);
              router.refresh();
            }}
          >
            <div>
              <Label htmlFor="grant-title">Grant name</Label>
              <Input id="grant-title" name="title" maxLength={200} defaultValue={grant?.title} required />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="grant-funder">Funder</Label>
                <Select id="grant-funder" name="funderId" defaultValue={grant?.funder_crm_organization_id ?? ""} required>
                  <option value="">Choose from the CRM</option>
                  {options.funders.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="grant-contact">Funder contact (optional)</Label>
                <Select id="grant-contact" name="funderContactId" defaultValue={grant?.funder_contact_id ?? ""}>
                  <option value="">None</option>
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
                <Label htmlFor="grant-amount">Amount awarded</Label>
                <Input id="grant-amount" name="amount" inputMode="decimal" defaultValue={grant?.amount} required />
              </div>
              <div>
                <Label htmlFor="grant-reference">Funder&apos;s file number (optional)</Label>
                <Input id="grant-reference" name="funderReference" maxLength={100} defaultValue={grant?.funder_reference ?? ""} />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <Label htmlFor="grant-awarded">Awarded on</Label>
                <Input id="grant-awarded" name="awardedOn" type="date" defaultValue={grant?.awarded_on ?? ""} />
              </div>
              <div>
                <Label htmlFor="grant-starts">Starts</Label>
                <Input id="grant-starts" name="startsOn" type="date" defaultValue={grant?.starts_on ?? ""} />
              </div>
              <div>
                <Label htmlFor="grant-ends">Ends</Label>
                <Input id="grant-ends" name="endsOn" type="date" defaultValue={grant?.ends_on ?? ""} />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="grant-fund">Fund</Label>
                <Select id="grant-fund" name="fundId" defaultValue={grant?.fund_id ?? ""} required>
                  <option value="">Choose a fund</option>
                  {options.funds.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </Select>
                <FieldHint>Usually an externally restricted fund set up in Ledger, Funds.</FieldHint>
              </div>
              <div>
                <Label htmlFor="grant-program">Program (optional)</Label>
                <Select id="grant-program" name="programId" defaultValue={grant?.program_id ?? ""}>
                  <option value="">Any program</option>
                  {options.programs.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            <div>
              <Label htmlFor="grant-restrictions">Restrictions and conditions</Label>
              <Textarea id="grant-restrictions" name="restrictions" maxLength={2000} defaultValue={grant?.restrictions ?? ""} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="grant-responsible">Responsible for reports</Label>
                <Select id="grant-responsible" name="responsibleUserId" defaultValue={grant?.responsible_user_id ?? ""}>
                  <option value="">Owners and admins</option>
                  {options.staff.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </Select>
                <FieldHint>Gets the report reminders.</FieldHint>
              </div>
              {grant ? (
                <div>
                  <Label htmlFor="grant-status">Status</Label>
                  <Select id="grant-status" name="status" defaultValue={grant.status}>
                    <option value="active">Active</option>
                    <option value="closed">Closed (no more reminders)</option>
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
                Cancel
              </Button>
              <Button type="submit" loading={saving}>
                Save grant
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
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      aria-label="Add a report due date"
      onSubmit={async (e) => {
        e.preventDefault();
        const formEl = e.currentTarget;
        setError(null);
        setSaving(true);
        const form = new FormData(formEl);
        const result = await addGrantReport({ grantId, title: form.get("title"), dueOn: form.get("dueOn") });
        setSaving(false);
        if (!result.ok) {
          setError(result.error ?? "Could not add the report.");
          return;
        }
        formEl.reset();
        toast("Report due date added.", { tone: "success" });
        router.refresh();
      }}
    >
      <div className="min-w-48 flex-1">
        <Label htmlFor="report-title">Report</Label>
        <Input id="report-title" name="title" maxLength={200} placeholder="Interim report" required />
      </div>
      <div>
        <Label htmlFor="report-due">Due</Label>
        <Input id="report-due" name="dueOn" type="date" required />
      </div>
      <Button type="submit" loading={saving}>
        Add
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
  const [pending, setPending] = useState(false);
  const run = async (fn: () => Promise<{ ok: boolean; error?: string }>, done: string) => {
    setPending(true);
    const result = await fn();
    setPending(false);
    toast(result.ok ? done : (result.error ?? "Could not update the report."), { tone: result.ok ? "success" : "error" });
    router.refresh();
  };
  return (
    <div className="flex flex-wrap justify-end gap-2">
      {submitted ? (
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => setGrantReportSubmitted({ reportId, submittedOn: "" }), "Marked as not submitted.")}>
          Undo submitted
        </Button>
      ) : (
        <>
          <Button size="sm" variant="secondary" disabled={pending} onClick={() => run(() => setGrantReportSubmitted({ reportId, submittedOn: today }), "Marked as submitted.")}>
            Mark submitted
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() => {
              if (window.confirm("Remove this report due date?")) void run(() => deleteGrantReport(reportId), "Report removed.");
            }}
          >
            Remove
          </Button>
        </>
      )}
    </div>
  );
}
