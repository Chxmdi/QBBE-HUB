"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { setCrmOrganizationStatus } from "@/features/crm/services/crm.commands";
import { useT } from "@/lib/i18n/client";

export function ArchiveOrganizationButton({
  organizationId,
  status,
}: {
  organizationId: string;
  status: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const t = useT();
  const [saving, setSaving] = useState(false);
  const inactive = status === "inactive";

  async function toggle() {
    setSaving(true);
    const result = await setCrmOrganizationStatus(
      organizationId,
      inactive ? "active" : "inactive",
    );
    setSaving(false);
    if (!result.ok) {
      toast(result.error ?? t("crm.archive.statusFailed"));
      return;
    }
    toast(inactive ? t("crm.archive.restored") : t("crm.archive.archived"));
    router.refresh();
  }

  return (
    <Button variant="secondary" onClick={toggle} loading={saving}>
      {inactive ? t("crm.archive.restore") : t("crm.archive.archive")}
    </Button>
  );
}
