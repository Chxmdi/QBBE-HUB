"use client";

import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n/client";

/**
 * A load that failed, said plainly, with a way to try again (P0-UX-05,
 * UI-006). For fetches made after the page rendered — a search, a panel, an
 * older page of history — where the route error boundary cannot help. The
 * alternative this replaces was rendering the empty state, which told people
 * there was nothing when in fact nothing could be read.
 */
export function ErrorState({
  message,
  onRetry,
  className,
}: {
  message?: string;
  onRetry?: () => void;
  className?: string;
}) {
  const t = useT();
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center gap-2 px-4 py-5 text-center text-[13px] text-muted",
        className,
      )}
    >
      <AlertTriangle className="size-5 text-warning-fg" aria-hidden />
      <p>{message ?? t("ui.loadFailed")}</p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="rounded-(--radius-sm) px-2 py-1 text-[12.5px] font-semibold text-brand-fg underline-offset-2 hover:underline"
        >
          {t("common.tryAgain")}
        </button>
      ) : null}
    </div>
  );
}
