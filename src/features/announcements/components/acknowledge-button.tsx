"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { acknowledgeAnnouncement } from "@/features/announcements/services/announcement.commands";

/**
 * Explicit acknowledgment — a durable record, not a reaction (ANN-003).
 */
export function AcknowledgeButton({
  announcementId,
}: {
  announcementId: string;
}) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "saving" | "done" | "error">(
    "idle",
  );

  async function handleClick() {
    setState("saving");
    const result = await acknowledgeAnnouncement(announcementId);
    if (result.ok) {
      setState("done");
      router.refresh();
    } else {
      setState("error");
    }
  }

  if (state === "done") {
    return (
      <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-success-fg">
        <CheckCircle2 className="size-4" aria-hidden />
        Acknowledged
      </span>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button size="sm" onClick={handleClick} loading={state === "saving"}>
        Acknowledge
      </Button>
      {state === "error" ? (
        <p role="alert" className="text-[12px] text-danger-fg">
          Could not save — try again.
        </p>
      ) : null}
    </div>
  );
}
