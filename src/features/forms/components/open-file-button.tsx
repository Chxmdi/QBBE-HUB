"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { openFormFile } from "@/features/forms/services/form.commands";
import { openSigningDocument } from "@/features/forms/services/signature.commands";

const scanLabel = {
  pending: "Security check pending",
  quarantined: "Quarantined",
  rejected: "Rejected by security check",
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
  const [busy, setBusy] = useState(false);

  if (scanStatus !== "clean") {
    return <Badge tone={scanStatus === "pending" ? "neutral" : "danger"}>{scanLabel[scanStatus]}</Badge>;
  }

  async function open() {
    setBusy(true);
    const result = kind === "form-file" ? await openFormFile(id) : await openSigningDocument(id);
    setBusy(false);
    if (!result.ok || !result.url) {
      toast(result.error ?? "Could not open the file.", { tone: "error" });
      return;
    }
    window.open(result.url, "_blank", "noopener,noreferrer");
  }

  return (
    <Button size="sm" variant="secondary" disabled={busy} onClick={open} aria-label={`Open ${fileName}`}>
      Open
    </Button>
  );
}
