"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { openFormFile } from "@/features/forms/services/form.commands";
import { openSigningDocument } from "@/features/forms/services/signature.commands";
import { useT } from "@/lib/i18n/client";

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
}: {
  kind: "form-file" | "signing-document";
  id: string;
  fileName: string;
  scanStatus: "pending" | "clean" | "quarantined" | "rejected";
}) {
  const { toast } = useToast();
  const t = useT();
  const [busy, setBusy] = useState(false);

  if (scanStatus !== "clean") {
    return <Badge tone={scanStatus === "pending" ? "neutral" : "danger"}>{t(scanLabel[scanStatus])}</Badge>;
  }

  async function open() {
    setBusy(true);
    const result = kind === "form-file" ? await openFormFile(id) : await openSigningDocument(id);
    setBusy(false);
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
