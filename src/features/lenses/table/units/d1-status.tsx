"use client";

import type * as React from "react";
import { Undo2 } from "lucide-react";
import type { LensT } from "@/features/lenses/i18n";

/**
 * Wave 2 unit D1: the line above the table that says what a paste or an undo
 * did, and offers "Undo last change" while there is one. Screen readers hear
 * the same through the table's status region.
 */
export function D1Status({
  anchorRef,
  message,
  canUndo,
  busy,
  onUndo,
  t,
}: {
  /** Lets the grid unit find the table it belongs to. */
  anchorRef: React.Ref<HTMLDivElement>;
  message: string;
  canUndo: boolean;
  busy: boolean;
  onUndo: () => void;
  t: LensT;
}) {
  return (
    <div ref={anchorRef} className="mb-2 flex min-h-8 flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-muted">
      <p className="sr-only">{t("units.d1.hint")}</p>
      {message ? <p className="font-medium text-ink">{message}</p> : null}
      {canUndo ? (
        <button
          type="button"
          onClick={onUndo}
          disabled={busy}
          className="inline-flex h-8 items-center gap-1.5 rounded-(--radius-sm) border border-line bg-surface px-2.5 font-medium text-ink hover:bg-surface-soft disabled:opacity-60"
        >
          <Undo2 className="size-3.5" aria-hidden />
          {busy ? t("units.d1.undoing") : t("units.d1.undo")}
        </button>
      ) : null}
    </div>
  );
}
