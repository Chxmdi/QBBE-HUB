"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cancelMeeting } from "@/features/meetings/services/meeting.commands";

export function CancelMeetingButton({ meetingId }: { meetingId: string }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCancel() {
    if (
      !window.confirm(
        "Cancel this meeting? Hub will cancel it and remove its linked Google Calendar event. If Google is unavailable, Calendar will be marked for recovery.",
      )
    ) return;
    setSaving(true);
    const result = await cancelMeeting({ meetingId });
    setSaving(false);
    if (!result.ok) {
      setError(result.error ?? "Could not cancel the meeting.");
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button variant="secondary" onClick={handleCancel} loading={saving}>
        Cancel meeting
      </Button>
      {error ? <p role="alert" className="text-[12px] text-danger-fg">{error}</p> : null}
    </div>
  );
}
