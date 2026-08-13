"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Check } from "lucide-react";
import { completeFollowUp } from "@/features/crm/services/crm.commands";

export function CompleteFollowUpButton({ followUpId }: { followUpId: string }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  async function handleComplete() {
    setSaving(true);
    const result = await completeFollowUp(followUpId);
    setSaving(false);
    if (result.ok) router.refresh();
  }

  return (
    <button
      type="button"
      onClick={handleComplete}
      disabled={saving}
      aria-label="Mark follow-up done"
      title="Mark done"
      className="rounded-(--radius-sm) p-1.5 text-muted transition-colors hover:bg-surface-soft hover:text-success disabled:opacity-50"
    >
      <Check className="size-4" aria-hidden />
    </button>
  );
}
