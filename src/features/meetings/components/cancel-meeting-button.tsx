"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cancelMeeting } from "@/features/meetings/services/meeting.commands";
import { useT } from "@/lib/i18n/client";
import { runServerAction } from "@/lib/use-server-action";

export function CancelMeetingButton({ meetingId }: { meetingId: string }) {
  const router = useRouter();
  const t = useT();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCancel() {
    if (
      !window.confirm(
        t("meetings.cancelMeeting.confirm"),
      )
    ) return;
    const result = await runServerAction(() => cancelMeeting({ meetingId }), {
      setBusy: setSaving,
      setError,
      t,
      reload: () => window.location.reload(),
    });
    if (!result) return;
    if (!result.ok) {
      setError(result.error ?? t("meetings.cancelMeeting.error"));
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button variant="secondary" onClick={() => void handleCancel()} loading={saving}>
        {t("meetings.cancelMeeting.button")}
      </Button>
      {error ? <p role="alert" className="text-[12px] text-danger-fg">{error}</p> : null}
    </div>
  );
}
