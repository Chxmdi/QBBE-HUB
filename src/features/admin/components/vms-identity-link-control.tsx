"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { linkVmsIdentity } from "@/features/admin/services/integration.commands";
import { labelOr } from "@/features/admin/labels";
import { useT } from "@/lib/i18n/client";

export function VmsIdentityLinkControl({
  userId,
  vmsId,
  availability,
}: {
  userId: string;
  vmsId: string | null;
  availability: string | null;
}) {
  const [value, setValue] = useState(vmsId ?? "");
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();
  const t = useT();

  async function save() {
    setSaving(true);
    const result = await linkVmsIdentity(userId, value);
    setSaving(false);
    if (!result.ok) {
      toast(result.error ?? t("admin.vmsControl.failed"), { tone: "error" });
      return;
    }
    toast(value.trim() ? t("admin.vmsControl.linked") : t("admin.vmsControl.unlinked"));
  }

  return (
    <div className="min-w-52 space-y-1.5">
      <div className="flex gap-1.5">
        <Input
          aria-label={t("admin.vmsControl.label")}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          maxLength={200}
          placeholder={t("admin.vmsControl.placeholder")}
        />
        <Button type="button" variant="secondary" onClick={save} loading={saving}>
          {t("admin.vmsControl.save")}
        </Button>
      </div>
      <p className="meta">
        {vmsId
          ? t("admin.vmsControl.availability", {
              value: labelOr(
                t,
                `admin.vmsControl.availabilityValues.${availability ?? "unknown"}`,
                availability ?? "unknown",
              ),
            })
          : t("admin.vmsControl.notLinked")}
      </p>
    </div>
  );
}
