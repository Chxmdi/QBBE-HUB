"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { reportError } from "@/lib/observability";

/**
 * Root boundary. A segment's own error.tsx does not catch errors thrown by
 * its layout, so a failure in the workspace layout — the session lookup, the
 * sidebar counts — fell through to the framework default and rendered as a
 * blank page. This catches those, plus anything in /sign-in, /welcome, and
 * /account-inactive, which have no boundary of their own (DEV-005).
 */
export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    reportError(error, { digest: error.digest });
  }, [error]);

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 px-4 text-center">
      <AlertTriangle className="size-8 text-warning-fg" aria-hidden />
      <h1 className="text-[18px] font-semibold">The Hub couldn&apos;t load</h1>
      <p className="max-w-md text-[13.5px] text-muted">
        Something failed before the page could be built. Your data is safe —
        try again, and if this keeps happening let an administrator know
        {error.digest ? ` (reference: ${error.digest})` : ""}.
      </p>
      <div className="mt-2 flex items-center gap-2">
        <Button onClick={reset}>Try again</Button>
        <a
          href="/sign-in"
          className="text-[13.5px] font-medium text-brand-fg hover:underline"
        >
          Back to sign in
        </a>
      </div>
    </main>
  );
}
