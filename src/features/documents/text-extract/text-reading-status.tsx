"use client";

import { ScanText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { textReaderMessage, type TextReaderState } from "./use-file-text-reader";

/**
 * What the file-text reader is doing, announced politely. Reading never
 * blocks saving: Skip stops it and the file is saved without its words.
 */
export function TextReadingStatus({
  state,
  onSkip,
  id,
}: {
  state: TextReaderState;
  onSkip: () => void;
  id?: string;
}) {
  const message = textReaderMessage(state);
  // Nothing at all until a readable file is chosen, so a form that already has
  // a status region (the receipt dialog) keeps exactly one while idle.
  if (!message) return null;
  return (
    <div id={id} role="status" aria-live="polite" className="mt-1.5">
      <p className="flex flex-wrap items-center gap-2 text-[12.5px] text-muted">
        <ScanText className="size-4 shrink-0" aria-hidden />
        <span>{message}</span>
        {state.kind === "running" ? (
          <Button type="button" variant="ghost" size="sm" onClick={onSkip}>
            Skip reading
          </Button>
        ) : null}
      </p>
    </div>
  );
}
