"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { completeMeeting } from "@/features/meetings/services/meeting.commands";
import { useT } from "@/lib/i18n/client";

export function CompleteMeetingButton({ meetingId }: { meetingId: string }) {
  const router = useRouter();
  const t = useT();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleComplete() {
    if (
      !window.confirm(
        t("meetings.completeMeeting.confirm"),
      )
    )
      return;
    setSaving(true);
    const result = await completeMeeting(meetingId);
    setSaving(false);
    if (!result.ok) {
      setError(result.error ?? t("meetings.completeMeeting.error"));
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button onClick={handleComplete} loading={saving}>
        {t("meetings.completeMeeting.button")}
      </Button>
      {error ? (
        <p role="alert" className="text-[12px] text-danger-fg">
          {error}
        </p>
      ) : null}
    </div>
  );
}
