"use client";

import * as React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Contextual side drawer that preserves workspace context (UI-010).
 * Becomes a full-screen sheet on mobile (Part II §11.2). Built on the
 * native <dialog> element so focus trapping, Escape, and background inert
 * behavior come from the platform.
 */
export function Drawer({
  open,
  onClose,
  title,
  description,
  actions,
  children,
  width = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  width?: "md" | "lg";
}) {
  const ref = React.useRef<HTMLDialogElement>(null);

  React.useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      aria-label={title}
      className={cn(
        // Full-screen sheet on mobile, right-anchored panel from sm up.
        "m-0 h-dvh max-h-dvh w-full max-w-full bg-surface p-0 text-ink",
        "sm:ml-auto sm:h-dvh",
        width === "lg" ? "sm:w-[560px]" : "sm:w-[460px]",
        "backdrop:bg-ink/40 dark:backdrop:bg-black/60",
        "motion-safe:animate-[drawer-in_180ms_var(--ease-app)]",
      )}
    >
      <div className="flex h-full flex-col">
        <header className="flex items-start justify-between gap-3 border-b border-line px-5 py-3.5">
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold">{title}</h2>
            {description ? (
              <p className="meta mt-0.5 truncate">{description}</p>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {actions}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close panel"
              className="rounded-(--radius-sm) p-1.5 text-muted transition-colors hover:bg-surface-soft hover:text-ink"
            >
              <X className="size-4" aria-hidden />
            </button>
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </dialog>
  );
}
