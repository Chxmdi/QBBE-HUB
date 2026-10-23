"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { openFormFile } from "@/features/forms/services/form.commands";
import { openSigningDocument } from "@/features/forms/services/signature.commands";
import { useT } from "@/lib/i18n/client";
import { runServerAction } from "@/lib/use-server-action";
import { QuarantineReasonText } from "@/features/documents/components/quarantine-reason-text";

const scanLabel = {
  pending: "forms.files.scan.pending",
  quarantined: "forms.files.scan.quarantined",
  rejected: "forms.files.scan.rejected",
} as const;

/** Opens a clean private file through a one-minute link; otherwise says why not. */
export function OpenFileButton({
  kind,
  id,
  fileName,
  scanStatus,
  scanNote,
}: {
  kind: "form-file" | "signing-document";
  id: string;
  fileName: string;
  scanStatus: "pending" | "clean" | "quarantined" | "rejected";
  scanNote?: string | null;
}) {
  const { toast } = useToast();
  const t = useT();
  const [busy, setBusy] = useState(false);

  if (scanStatus !== "clean") {
    return (
      <>
        <Badge tone={scanStatus === "pending" ? "neutral" : "danger"}>{t(scanLabel[scanStatus])}</Badge>
        <QuarantineReasonText scanStatus={scanStatus} scanNote={scanNote} />
      </>
    );
  }

  async function open() {
    const result = await runServerAction(() => (kind === "form-file" ? openFormFile(id) : openSigningDocument(id)), {
      setBusy,
      setError: (text) => {
        if (text) toast(text, { tone: "error" });
      },
      t,
      reload: () => window.location.reload(),
    });
    if (!result) return;
    if (!result.ok || !result.url) {
      toast(result.error ?? t("forms.errors.openFailed"), { tone: "error" });
      return;
    }
    window.open(result.url, "_blank", "noopener,noreferrer");
  }

  return (
    <Button size="sm" variant="secondary" disabled={busy} onClick={open} aria-label={t("forms.files.openName", { name: fileName })}>
      {t("forms.files.open")}
    </Button>
  );
}
