"use client";

import { quarantineReason } from "@/features/documents/quarantine-reason";
import { useT } from "@/lib/i18n/client";

/** Why a blocked file cannot be opened, and what the uploader can do. */
export function QuarantineReasonText({
  scanStatus,
  scanNote,
  id,
}: {
  scanStatus: string | null | undefined;
  scanNote: string | null | undefined;
  id?: string;
}) {
  const t = useT();
  const reason = quarantineReason(scanStatus, scanNote);
  if (!reason) return null;
  return (
    <span id={id} className="mt-1 block text-[12px] leading-snug text-danger-fg">
      {t(`files.quarantine.${reason}`)}
    </span>
  );
}
