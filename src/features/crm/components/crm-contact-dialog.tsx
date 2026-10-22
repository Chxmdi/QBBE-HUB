"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input, Label } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { updateCrmContact } from "@/features/crm/services/crm.commands";
import { useT } from "@/lib/i18n/client";

/** Staff: correct a contact's name, title, email or phone. */
export function CrmContactDialog({
  contact,
}: {
  contact: { id: string; full_name: string; role_title: string | null; email: string | null; phone: string | null };
}) {
  const router = useRouter();
  const { toast } = useToast();
  const t = useT();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = new FormData(e.currentTarget);
    setSaving(true);
    const result = await updateCrmContact({
      contactId: contact.id,
      fullName: form.get("fullName"),
      roleTitle: (form.get("roleTitle") as string) || undefined,
      email: (form.get("email") as string) ?? "",
      phone: (form.get("phone") as string) || undefined,
    });
    setSaving(false);
    if (!result.ok) {
      setError(result.error ?? t("crm.errors.saveContact"));
      return;
    }
    setOpen(false);
    toast(t("crm.contactDialog.saved"));
    router.refresh();
  }

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <Pencil aria-hidden className="size-4" />
        {t("crm.contactDialog.edit")}
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={t("crm.contactDialog.title")}>
        <form className="space-y-3" onSubmit={handleSubmit}>
          <div>
            <Label htmlFor="contact-name">{t("crm.contactDialog.name")}</Label>
            <Input id="contact-name" name="fullName" defaultValue={contact.full_name} maxLength={200} required />
          </div>
          <div>
            <Label htmlFor="contact-role">{t("crm.contactDialog.roleTitle")}</Label>
            <Input id="contact-role" name="roleTitle" defaultValue={contact.role_title ?? ""} maxLength={200} />
          </div>
          <div>
            <Label htmlFor="contact-email">{t("crm.contactDialog.email")}</Label>
            <Input id="contact-email" name="email" type="email" defaultValue={contact.email ?? ""} maxLength={300} />
          </div>
          <div>
            <Label htmlFor="contact-phone">{t("crm.contactDialog.phone")}</Label>
            <Input id="contact-phone" name="phone" defaultValue={contact.phone ?? ""} maxLength={50} />
          </div>
          {error ? (
            <p role="alert" className="text-[12.5px] text-danger-fg">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              {t("crm.contactDialog.cancel")}
            </Button>
            <Button type="submit" loading={saving}>
              {t("crm.contactDialog.save")}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
