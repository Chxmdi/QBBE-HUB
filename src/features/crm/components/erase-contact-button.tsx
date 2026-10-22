"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { eraseCrmContact } from "@/features/crm/services/crm.commands";
import { useT } from "@/lib/i18n/client";

/** Administrators: erase a contact at their request, after confirming. */
export function EraseContactButton({ contactId, name }: { contactId: string; name: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const t = useT();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function erase() {
    setError(null);
    setSaving(true);
    const result = await eraseCrmContact(contactId);
    setSaving(false);
    if (!result.ok) {
      setError(result.error ?? t("crm.erase.failed"));
      return;
    }
    setOpen(false);
    toast(t("crm.erase.done"));
    router.refresh();
  }

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        {t("crm.erase.button")}
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={t("crm.erase.title", { name })}>
        <div className="space-y-3 text-[13.5px]">
          <p>{t("crm.erase.explanation")}</p>
          <p className="text-muted">{t("crm.erase.kept")}</p>
          {error ? (
            <p role="alert" className="text-[12.5px] text-danger-fg">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              {t("crm.erase.cancel")}
            </Button>
            <Button type="button" variant="danger" loading={saving} onClick={erase}>
              {t("crm.erase.confirm")}
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
