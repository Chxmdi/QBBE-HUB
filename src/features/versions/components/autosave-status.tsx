"use client";

import { useFormatters, useLocale } from "@/lib/i18n/client";
import { fill } from "@/features/collab/i18n";
import type { AutosaveStatus as Status } from "../autosave";
import { versionsText } from "../messages";

/** The save state, announced politely to screen readers as it changes. */
export function AutosaveStatus({ status, savedAt }: { status: Status; savedAt: Date | null }) {
  const m = versionsText(useLocale()).autosave;
  const format = useFormatters();
  const text =
    status === "pending"
      ? m.pending
      : status === "saving"
        ? m.saving
        : status === "error"
          ? m.error
          : status === "saved" && savedAt
            ? fill(m.saved, { time: format.time(savedAt.toISOString()) })
            : m.idle;
  return (
    <p role="status" aria-live="polite" className={status === "error" ? "text-sm text-danger-fg" : "meta"}>
      {text}
    </p>
  );
}
