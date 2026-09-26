"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FieldHint, Input, Label, Select } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import {
  issueAnnualStatement,
  issueGiftAcknowledgement,
  resendAcknowledgement,
  voidGift,
} from "@/features/gifts/services/gift.commands";

type Target = { kind: "gift"; giftId: string } | { kind: "statement"; donor: string; year: number };

/**
 * Issues a thank-you letter or annual statement: English or French, printed
 * or emailed. The letter is built on the server from the recorded gifts and
 * always carries the bilingual "not an official receipt" sentence.
 */
export function AcknowledgeForm({ target, defaultEmail }: { target: Target; defaultEmail: string | null }) {
  const router = useRouter();
  const { toast } = useToast();
  const [channel, setChannel] = useState<"print" | "email">("print");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const prefix = target.kind === "gift" ? "ack" : "stmt";

  return (
    <form
      className="space-y-3"
      aria-label={target.kind === "gift" ? "Issue a thank-you acknowledgement" : "Issue the annual statement"}
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        setSaving(true);
        const form = new FormData(e.currentTarget);
        const delivery = {
          language: form.get("language"),
          channel,
          recipientEmail: channel === "email" ? form.get("recipientEmail") ?? undefined : undefined,
        };
        const result =
          target.kind === "gift"
            ? await issueGiftAcknowledgement({ ...delivery, giftId: target.giftId })
            : await issueAnnualStatement({ ...delivery, donor: target.donor, year: target.year });
        setSaving(false);
        if (!result.ok) {
          setError(result.error ?? "Could not issue the letter.");
          if (result.id) router.refresh();
          return;
        }
        if (channel === "print" && result.id) {
          window.open(`/api/finance/gifts/acknowledgements/${result.id}`, "_blank", "noopener");
        }
        toast(channel === "email" ? "Letter emailed." : "Letter issued. It opens in a new tab for printing.", {
          tone: "success",
        });
        router.refresh();
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor={`${prefix}-language`}>Language</Label>
          <Select id={`${prefix}-language`} name="language" defaultValue="fr">
            <option value="fr">Français</option>
            <option value="en">English</option>
          </Select>
        </div>
        <div>
          <Label htmlFor={`${prefix}-channel`}>Send by</Label>
          <Select
            id={`${prefix}-channel`}
            value={channel}
            onChange={(e) => setChannel(e.target.value as "print" | "email")}
          >
            <option value="print">Print or save (HTML)</option>
            <option value="email">Email</option>
          </Select>
        </div>
      </div>
      {channel === "email" ? (
        <div>
          <Label htmlFor={`${prefix}-email`}>Donor&apos;s email</Label>
          <Input
            id={`${prefix}-email`}
            name="recipientEmail"
            type="email"
            maxLength={320}
            defaultValue={defaultEmail ?? ""}
            required
          />
          <FieldHint>Taken from the CRM. Outside production, only allowlisted addresses are emailed.</FieldHint>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="text-[13px] text-danger-fg">
          {error}
        </p>
      ) : null}
      <Button type="submit" loading={saving}>
        {target.kind === "gift" ? "Issue thank-you letter" : "Issue statement"}
      </Button>
    </form>
  );
}

export function ResendButton({ ackId }: { ackId: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, setPending] = useState(false);
  return (
    <Button
      size="sm"
      variant="secondary"
      loading={pending}
      onClick={async () => {
        setPending(true);
        const result = await resendAcknowledgement(ackId);
        setPending(false);
        toast(result.ok ? "Letter emailed." : (result.error ?? "Could not send the email."), {
          tone: result.ok ? "success" : "error",
        });
        router.refresh();
      }}
    >
      Try email again
    </Button>
  );
}

/** Voids a gift recorded by mistake: its ledger entry is reversed, both stay on record. */
export function VoidGiftDialog({ giftId, today }: { giftId: string; today: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <Button variant="danger" onClick={() => setOpen(true)}>
        Void gift
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Void this gift">
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setError(null);
            setSaving(true);
            const form = new FormData(e.currentTarget);
            const result = await voidGift({ giftId, voidOn: form.get("voidOn"), reason: form.get("reason") });
            setSaving(false);
            if (!result.ok) {
              setError(result.error ?? "Could not void the gift.");
              return;
            }
            toast("Gift voided and its ledger entry reversed.", { tone: "success" });
            setOpen(false);
            router.refresh();
          }}
        >
          <p className="text-[13.5px] text-muted">
            The gift stays on record, marked void, and a reversing entry is posted to the ledger. This cannot be undone:
            to restore it, record the gift again.
          </p>
          <div>
            <Label htmlFor="void-date">Date of the reversing entry</Label>
            <Input id="void-date" name="voidOn" type="date" defaultValue={today} required />
            <FieldHint>Must be in an open period, on or after the date the gift was received.</FieldHint>
          </div>
          <div>
            <Label htmlFor="void-reason">Reason</Label>
            <Input id="void-reason" name="reason" maxLength={500} required />
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
            <Button type="submit" variant="danger" loading={saving}>
              Void and reverse
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
