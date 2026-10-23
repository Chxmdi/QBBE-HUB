"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { setCrmOrganizationStatus } from "@/features/crm/services/crm.commands";
import { useT } from "@/lib/i18n/client";
import { runServerAction } from "@/lib/use-server-action";

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
    const result = await runServerAction(
      () => setCrmOrganizationStatus(organizationId, inactive ? "active" : "inactive"),
      {
        setBusy: setSaving,
        setError: (text) => {
          if (text) toast(text, { tone: "error" });
        },
        t,
        reload: () => window.location.reload(),
      },
    );
    if (!result) return;
    if (!result.ok) {
      toast(result.error ?? t("crm.archive.statusFailed"));
      return;
    }
    toast(inactive ? t("crm.archive.restored") : t("crm.archive.archived"));
    router.refresh();
  }

  return (
    <Button variant="secondary" onClick={() => void toggle()} loading={saving}>
      {inactive ? t("crm.archive.restore") : t("crm.archive.archive")}
    </Button>
  );
}
