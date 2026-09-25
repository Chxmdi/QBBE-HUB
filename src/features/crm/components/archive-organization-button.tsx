"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { setCrmOrganizationStatus } from "@/features/crm/services/crm.commands";

export function ArchiveOrganizationButton({
  organizationId,
  status,
}: {
  organizationId: string;
  status: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
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
      toast(result.error ?? "Could not update status.");
      return;
    }
    toast(inactive ? "Organization restored." : "Organization archived.");
    router.refresh();
  }

  return (
    <Button variant="secondary" onClick={toggle} loading={saving}>
      {inactive ? "Restore organization" : "Archive organization"}
    </Button>
  );
}
