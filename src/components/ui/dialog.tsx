"use client";

import * as React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Accessible modal built on the native <dialog> element: focus trapping,
 * Escape handling, and inert background come from the platform (UI-004).
 */
export function Dialog({
  open,
  onClose,
  title,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  const ref = React.useRef<HTMLDialogElement>(null);
  const titleId = React.useId();

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
        // Click on the backdrop closes.
        if (e.target === ref.current) onClose();
      }}
      // Without this the modal has no accessible name: a screen reader
      // announces "dialog" and nothing else on open.
      aria-labelledby={titleId}
      className={cn(
        "m-auto w-[min(560px,calc(100vw-2rem))] rounded-(--radius-md) border border-line bg-surface p-0 text-ink shadow-(--shadow-pop)",
        "backdrop:bg-ink/40 dark:backdrop:bg-black/60",
        className,
      )}
    >
      <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
        <h2 id={titleId} className="text-[15px] font-semibold">
          {title}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close dialog"
          className="rounded-(--radius-sm) p-1 text-muted transition-colors hover:bg-surface-soft hover:text-ink"
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>
      <div className="max-h-[75vh] overflow-y-auto px-5 py-4">{children}</div>
    </dialog>
  );
}
