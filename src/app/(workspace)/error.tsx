"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { reportError } from "@/lib/observability";
import { useT } from "@/lib/i18n/client";

/**
 * Recoverable error boundary — human-readable message with a retry path,
 * never a blank surface (P0-UX-05, DEV-005).
 */
export default function WorkspaceError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useT();
  useEffect(() => {
    // Surface for diagnostics; server logs carry the correlated digest.
    reportError(error, { digest: error.digest });
  }, [error]);

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-center">
      <AlertTriangle className="size-8 text-warning-fg" aria-hidden />
      <h1 className="text-[18px] font-semibold">{t("errors.workspaceTitle")}</h1>
      <p className="max-w-md text-[13.5px] text-muted">
        {t("errors.workspaceBody")}
        {error.digest ? t("errors.reference", { digest: error.digest }) : ""}.
      </p>
      <Button onClick={reset} className="mt-2">
        {t("common.tryAgain")}
      </Button>
    </div>
  );
}
