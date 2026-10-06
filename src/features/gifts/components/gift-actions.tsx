"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FieldHint, Input, Label, Select } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { useT } from "@/lib/i18n/client";
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
  const t = useT();
  const [channel, setChannel] = useState<"print" | "email">("print");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const prefix = target.kind === "gift" ? "ack" : "stmt";

  return (
    <form
      className="space-y-3"
      aria-label={t(target.kind === "gift" ? "finance.gifts.ackForm.formLabelGift" : "finance.gifts.ackForm.formLabelStatement")}
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
          setError(result.error ?? t("finance.gifts.ackForm.couldNotIssue"));
          if (result.id) router.refresh();
          return;
        }
        if (channel === "print" && result.id) {
          window.open(`/api/finance/gifts/acknowledgements/${result.id}`, "_blank", "noopener");
        }
        toast(channel === "email" ? t("finance.gifts.ackForm.emailed") : t("finance.gifts.ackForm.issuedForPrint"), {
          tone: "success",
        });
        router.refresh();
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor={`${prefix}-language`}>{t("finance.gifts.ackForm.language")}</Label>
          <Select id={`${prefix}-language`} name="language" defaultValue="fr">
            <option value="fr">{t("finance.gifts.languages.fr")}</option>
            <option value="en">{t("finance.gifts.languages.en")}</option>
          </Select>
        </div>
        <div>
          <Label htmlFor={`${prefix}-channel`}>{t("finance.gifts.ackForm.sendBy")}</Label>
          <Select
            id={`${prefix}-channel`}
            value={channel}
            onChange={(e) => setChannel(e.target.value as "print" | "email")}
          >
            <option value="print">{t("finance.gifts.ackForm.printOrSave")}</option>
            <option value="email">{t("finance.gifts.ackForm.email")}</option>
          </Select>
        </div>
      </div>
      {channel === "email" ? (
        <div>
          <Label htmlFor={`${prefix}-email`}>{t("finance.gifts.ackForm.donorEmail")}</Label>
          <Input
            id={`${prefix}-email`}
            name="recipientEmail"
            type="email"
            maxLength={320}
            defaultValue={defaultEmail ?? ""}
            required
          />
          <FieldHint>{t("finance.gifts.ackForm.emailHint")}</FieldHint>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="text-[13px] text-danger-fg">
          {error}
        </p>
      ) : null}
      <Button type="submit" loading={saving}>
        {t(target.kind === "gift" ? "finance.gifts.ackForm.issueLetter" : "finance.gifts.ackForm.issueStatement")}
      </Button>
    </form>
  );
}

export function ResendButton({ ackId }: { ackId: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const t = useT();
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
        toast(result.ok ? t("finance.gifts.ackForm.emailed") : (result.error ?? t("finance.gifts.ackForm.couldNotSend")), {
          tone: result.ok ? "success" : "error",
        });
        router.refresh();
      }}
    >
      {t("finance.gifts.ackForm.tryEmailAgain")}
    </Button>
  );
}

/** Voids a gift recorded by mistake: its ledger entry is reversed, both stay on record. */
export function VoidGiftDialog({ giftId, today }: { giftId: string; today: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const t = useT();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <Button variant="danger" onClick={() => setOpen(true)}>
        {t("finance.gifts.voidDialog.button")}
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={t("finance.gifts.voidDialog.title")}>
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
              setError(result.error ?? t("finance.gifts.voidDialog.couldNotVoid"));
              return;
            }
            toast(t("finance.gifts.voidDialog.voided"), { tone: "success" });
            setOpen(false);
            router.refresh();
          }}
        >
          <p className="text-[13.5px] text-muted">{t("finance.gifts.voidDialog.explanation")}</p>
          <div>
            <Label htmlFor="void-date">{t("finance.gifts.voidDialog.date")}</Label>
            <Input id="void-date" name="voidOn" type="date" defaultValue={today} required />
            <FieldHint>{t("finance.gifts.voidDialog.dateHint")}</FieldHint>
          </div>
          <div>
            <Label htmlFor="void-reason">{t("finance.gifts.voidDialog.reason")}</Label>
            <Input id="void-reason" name="reason" maxLength={500} required />
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
            <Button type="submit" variant="danger" loading={saving}>
              {t("finance.gifts.voidDialog.submit")}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
