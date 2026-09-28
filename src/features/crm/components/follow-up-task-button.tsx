"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { convertFollowUpToTask } from "@/features/crm/services/crm.commands";
import { useT } from "@/lib/i18n/client";

export function FollowUpTaskButton({
  followUpId,
  taskId,
}: {
  followUpId: string;
  taskId?: string | null;
}) {
  const router = useRouter();
  const t = useT();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  if (taskId) {
    return (
      <a className="text-[12.5px] text-brand-fg hover:underline" href={`/my-work?task=${taskId}`}>
        {t("crm.followUps.openTask")}
      </a>
    );
  }

  return (
    <span className="inline-flex items-center gap-2">
      <Button
        size="sm"
        variant="secondary"
        loading={busy}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          const result = await convertFollowUpToTask(followUpId);
          setBusy(false);
          if (!result.ok) {
            setError(result.error ?? t("crm.followUps.createTaskFailed"));
            return;
          }
          router.refresh();
        }}
      >
        {t("crm.followUps.createTask")}
      </Button>
      {error ? <span className="text-[12.5px] text-danger-fg">{error}</span> : null}
    </span>
  );
}
