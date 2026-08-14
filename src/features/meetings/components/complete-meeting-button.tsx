"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { completeMeeting } from "@/features/meetings/services/meeting.commands";

export function CompleteMeetingButton({ meetingId }: { meetingId: string }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleComplete() {
    if (
      !window.confirm(
        "Complete this meeting? A summary of decisions and actions will be posted to the linked channel.",
      )
    )
      return;
    setSaving(true);
    const result = await completeMeeting(meetingId);
    setSaving(false);
    if (!result.ok) {
      setError(result.error ?? "Could not complete the meeting.");
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button onClick={handleComplete} loading={saving}>
        Complete meeting
      </Button>
      {error ? (
        <p role="alert" className="text-[12px] text-danger-fg">
          {error}
        </p>
      ) : null}
    </div>
  );
}
