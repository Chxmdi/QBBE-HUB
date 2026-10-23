"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Check } from "lucide-react";
import { useToast } from "@/components/ui/toast";
import { completeFollowUp } from "@/features/crm/services/crm.commands";
import { useT } from "@/lib/i18n/client";
import { runServerAction } from "@/lib/use-server-action";

export function CompleteFollowUpButton({ followUpId }: { followUpId: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const t = useT();
  const [saving, setSaving] = useState(false);

  async function handleComplete() {
    const result = await runServerAction(() => completeFollowUp(followUpId), {
      setBusy: setSaving,
      setError: (text) => {
        if (text) toast(text, { tone: "error" });
      },
      t,
      reload: () => window.location.reload(),
    });
    if (result?.ok) router.refresh();
  }

  return (
    <button
      type="button"
      onClick={() => void handleComplete()}
      disabled={saving}
      aria-label={t("crm.followUps.markDoneLabel")}
      title={t("crm.followUps.markDone")}
      className="rounded-(--radius-sm) p-1.5 text-muted transition-colors hover:bg-surface-soft hover:text-success-fg disabled:opacity-50"
    >
      <Check className="size-4" aria-hidden />
    </button>
  );
}
