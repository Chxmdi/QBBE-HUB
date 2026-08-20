"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { reportError } from "@/lib/observability";

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
  useEffect(() => {
    // Surface for diagnostics; server logs carry the correlated digest.
    reportError(error, { digest: error.digest });
  }, [error]);

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-center">
      <AlertTriangle className="size-8 text-warning-fg" aria-hidden />
      <h1 className="text-[18px] font-semibold">Something went wrong</h1>
      <p className="max-w-md text-[13.5px] text-muted">
        The page hit an unexpected error. Your data is safe — try again, and if
        this keeps happening let an administrator know
        {error.digest ? ` (reference: ${error.digest})` : ""}.
      </p>
      <Button onClick={reset} className="mt-2">
        Try again
      </Button>
    </div>
  );
}
