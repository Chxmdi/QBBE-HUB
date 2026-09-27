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

/** Add a vendor or customer, or edit one. */
export function ContactDialog({ contact }: { contact?: ContactRow }) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      {contact ? (
        <Button size="sm" variant="ghost" onClick={() => setOpen(true)} aria-label={`Edit ${contact.name}`}>
          <Pencil className="size-4" aria-hidden />
        </Button>
      ) : (
        <Button onClick={() => setOpen(true)}>
          <Plus className="size-4" aria-hidden />
          Add contact
        </Button>
      )}
      <Dialog open={open} onClose={() => setOpen(false)} title={contact ? `Edit ${contact.name}` : "Add a vendor or customer"}>
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
              setError(result.error ?? "Could not save the contact.");
              return;
            }
            toast(contact ? "Contact saved." : "Contact added.", { tone: "success" });
            setOpen(false);
            router.refresh();
          }}
        >
          <div>
            <Label htmlFor="contact-name">Name</Label>
            <Input id="contact-name" name="name" maxLength={200} defaultValue={contact?.name} required />
          </div>
          <fieldset className="flex flex-wrap gap-5">
            <legend className="mb-1 text-[13px] font-medium">This contact is</legend>
            <label className="flex items-center gap-2 text-[13.5px]">
              <Checkbox name="isVendor" defaultChecked={contact?.is_vendor ?? true} />
              A vendor (sends us bills)
            </label>
            <label className="flex items-center gap-2 text-[13.5px]">
              <Checkbox name="isCustomer" defaultChecked={contact?.is_customer ?? false} />
              A customer or funder (we invoice them)
            </label>
          </fieldset>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="contact-email">Email (optional)</Label>
              <Input id="contact-email" name="email" type="email" maxLength={320} defaultValue={contact?.email ?? ""} />
            </div>
            <div>
              <Label htmlFor="contact-phone">Phone (optional)</Label>
              <Input id="contact-phone" name="phone" maxLength={50} defaultValue={contact?.phone ?? ""} />
            </div>
          </div>
          <div>
            <Label htmlFor="contact-address">Address (optional, printed on invoices)</Label>
            <Textarea id="contact-address" name="address" maxLength={1000} defaultValue={contact?.address ?? ""} />
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <Label htmlFor="contact-language">Invoice language</Label>
              <Select id="contact-language" name="language" defaultValue={contact?.language ?? "fr"}>
                <option value="fr">French</option>
                <option value="en">English</option>
              </Select>
            </div>
            <div>
              <Label htmlFor="contact-gst">GST number (optional)</Label>
              <Input id="contact-gst" name="gstNumber" maxLength={30} defaultValue={contact?.gst_number ?? ""} />
            </div>
            <div>
              <Label htmlFor="contact-qst">QST number (optional)</Label>
              <Input id="contact-qst" name="qstNumber" maxLength={30} defaultValue={contact?.qst_number ?? ""} />
            </div>
          </div>
          <div>
            <Label htmlFor="contact-notes">Notes (optional)</Label>
            <Textarea id="contact-notes" name="notes" maxLength={2000} defaultValue={contact?.notes ?? ""} />
          </div>
          <label className="flex items-center gap-2 text-[13.5px]">
            <Checkbox name="isActive" defaultChecked={contact?.is_active ?? true} />
            Active (inactive contacts are not offered on new bills and invoices)
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
