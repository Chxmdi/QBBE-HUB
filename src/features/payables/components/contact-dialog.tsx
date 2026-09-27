"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Checkbox, Input, Label, Select, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { saveContact } from "@/features/payables/services/payables.commands";
import type { ContactRow } from "@/features/payables/services/payables.queries";
import { useT } from "@/lib/i18n/client";

/** Add a vendor or customer, or edit one. */
export function ContactDialog({ contact }: { contact?: ContactRow }) {
  const router = useRouter();
  const { toast } = useToast();
  const t = useT();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      {contact ? (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setOpen(true)}
          aria-label={t("finance.payables.contactDialog.editContact", { name: contact.name })}
        >
          <Pencil className="size-4" aria-hidden />
        </Button>
      ) : (
        <Button onClick={() => setOpen(true)}>
          <Plus className="size-4" aria-hidden />
          {t("finance.payables.contactDialog.addContact")}
        </Button>
      )}
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={
          contact
            ? t("finance.payables.contactDialog.editContact", { name: contact.name })
            : t("finance.payables.contactDialog.addTitle")
        }
      >
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setError(null);
            setSaving(true);
            const form = new FormData(e.currentTarget);
            const text = (name: string) => String(form.get(name) ?? "");
            const result = await saveContact({
              id: contact?.id,
              name: text("name"),
              isVendor: form.get("isVendor") === "on",
              isCustomer: form.get("isCustomer") === "on",
              email: text("email"),
              phone: text("phone"),
              address: text("address"),
              language: text("language"),
              gstNumber: text("gstNumber"),
              qstNumber: text("qstNumber"),
              notes: text("notes"),
              isActive: form.get("isActive") === "on",
            });
            setSaving(false);
            if (!result.ok) {
              setError(result.error ?? t("finance.payables.contactDialog.couldNotSave"));
              return;
            }
            toast(
              contact ? t("finance.payables.contactDialog.saved") : t("finance.payables.contactDialog.added"),
              { tone: "success" },
            );
            setOpen(false);
            router.refresh();
          }}
        >
          <div>
            <Label htmlFor="contact-name">{t("finance.payables.contactDialog.name")}</Label>
            <Input id="contact-name" name="name" maxLength={200} defaultValue={contact?.name} required />
          </div>
          <fieldset className="flex flex-wrap gap-5">
            <legend className="mb-1 text-[13px] font-medium">{t("finance.payables.contactDialog.thisContactIs")}</legend>
            <label className="flex items-center gap-2 text-[13.5px]">
              <Checkbox name="isVendor" defaultChecked={contact?.is_vendor ?? true} />
              {t("finance.payables.contactDialog.isVendor")}
            </label>
            <label className="flex items-center gap-2 text-[13.5px]">
              <Checkbox name="isCustomer" defaultChecked={contact?.is_customer ?? false} />
              {t("finance.payables.contactDialog.isCustomer")}
            </label>
          </fieldset>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="contact-email">{t("finance.payables.contactDialog.email")}</Label>
              <Input id="contact-email" name="email" type="email" maxLength={320} defaultValue={contact?.email ?? ""} />
            </div>
            <div>
              <Label htmlFor="contact-phone">{t("finance.payables.contactDialog.phone")}</Label>
              <Input id="contact-phone" name="phone" maxLength={50} defaultValue={contact?.phone ?? ""} />
            </div>
          </div>
          <div>
            <Label htmlFor="contact-address">{t("finance.payables.contactDialog.address")}</Label>
            <Textarea id="contact-address" name="address" maxLength={1000} defaultValue={contact?.address ?? ""} />
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <Label htmlFor="contact-language">{t("finance.payables.contactDialog.invoiceLanguage")}</Label>
              <Select id="contact-language" name="language" defaultValue={contact?.language ?? "fr"}>
                <option value="fr">{t("finance.payables.languages.fr")}</option>
                <option value="en">{t("finance.payables.languages.en")}</option>
              </Select>
            </div>
            <div>
              <Label htmlFor="contact-gst">{t("finance.payables.contactDialog.gstNumber")}</Label>
              <Input id="contact-gst" name="gstNumber" maxLength={30} defaultValue={contact?.gst_number ?? ""} />
            </div>
            <div>
              <Label htmlFor="contact-qst">{t("finance.payables.contactDialog.qstNumber")}</Label>
              <Input id="contact-qst" name="qstNumber" maxLength={30} defaultValue={contact?.qst_number ?? ""} />
            </div>
          </div>
          <div>
            <Label htmlFor="contact-notes">{t("finance.payables.contactDialog.notes")}</Label>
            <Textarea id="contact-notes" name="notes" maxLength={2000} defaultValue={contact?.notes ?? ""} />
          </div>
          <label className="flex items-center gap-2 text-[13.5px]">
            <Checkbox name="isActive" defaultChecked={contact?.is_active ?? true} />
            {t("finance.payables.contactDialog.active")}
          </label>
          {error ? (
            <p role="alert" className="text-[13px] text-danger-fg">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              {t("finance.payables.contactDialog.cancel")}
            </Button>
            <Button type="submit" loading={saving}>
              {t("finance.payables.contactDialog.save")}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
