"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { saveMeetingNotes } from "@/features/meetings/services/meeting.commands";
import { useT } from "@/lib/i18n/client";

export function MeetingNotesForm({
  meetingId,
  initialNotes,
}: {
  meetingId: string;
  initialNotes: string | null;
}) {
  const t = useT();
  const [notes, setNotes] = useState(initialNotes ?? "");
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  async function handleSave() {
    setState("saving");
    const result = await saveMeetingNotes({ meetingId, notes });
    setState(result.ok ? "saved" : "error");
    if (result.ok) setTimeout(() => setState("idle"), 2500);
  }

  return (
    <div className="card space-y-3 p-4">
      <Textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder={t("meetings.notesForm.placeholder")}
        rows={5}
        aria-label={t("meetings.notesForm.label")}
        maxLength={20000}
      />
      <div className="flex items-center justify-end gap-3">
        {state === "saved" ? (
          <span role="status" className="text-[12.5px] text-success-fg">
            {t("meetings.notesForm.saved")}
          </span>
        ) : state === "error" ? (
          <span role="alert" className="text-[12.5px] text-danger-fg">
            {t("meetings.notesForm.error")}
          </span>
        ) : null}
        <Button variant="secondary" size="sm" onClick={handleSave} loading={state === "saving"}>
          {t("meetings.notesForm.save")}
        </Button>
      </div>
    </div>
  );
}
