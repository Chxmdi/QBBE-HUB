"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FieldHint, Label, Textarea } from "@/components/ui/input";

/**
 * Ask why a task is blocked (P0-TSK-04, A11Y-002).
 *
 * This replaces `window.prompt`, which the board and the status control both
 * used. A native prompt cannot be given a label, cannot show the task it is
 * asking about, is announced inconsistently by screen readers, is suppressed
 * outright by some browsers and by every embedded view, and throws the typed
 * text away with no recovery if it is dismissed by accident. For a field the
 * server refuses to proceed without, that is the wrong control.
 *
 * The reason is required here and required again in `updateTaskStatus`, which
 * is deliberate: the dialog is a courtesy to the person typing, and the command
 * is the rule. Nothing reaches `blocked` without an explanation of why.
 */
export function BlockedReasonDialog({
  open,
  taskTitle,
  busy = false,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  /** Named in the title, so the answer cannot be given about the wrong card. */
  taskTitle: string | null;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  // Every StatusSelect on the page renders one of these, so a fixed id would
  // appear many times over. Duplicate ids are not merely untidy: the browser
  // binds <label for> to the first match, so the visible label belonged to a
  // closed dialog and the open field was left with no accessible name at all
  // — the same accessibility failure this component exists to remove.
  const fieldId = useId();

  // Cleared on the way out rather than on the way in. Carrying the previous
  // answer forward would let somebody block a second task with the first
  // one's explanation without noticing, which is worse than an empty field.
  // Both exits run through here, including Escape and a backdrop click, which
  // the native <dialog> reports as a close and `Dialog` forwards to onClose.
  function cancel() {
    setReason("");
    onCancel();
  }

  return (
    <Dialog
      open={open}
      onClose={cancel}
      title={taskTitle ? `What is blocking “${taskTitle}”?` : "What is blocking this task?"}
    >
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          const trimmed = reason.trim();
          if (!trimmed) return;
          setReason("");
          onConfirm(trimmed);
        }}
      >
        <div>
          <Label htmlFor={fieldId}>Reason</Label>
          <Textarea
            id={fieldId}
            name="reason"
            required
            rows={3}
            maxLength={1000}
            autoFocus
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Waiting on the signed venue contract before we can confirm dates."
          />
          <FieldHint>
            Shown on the task wherever it appears. It is cleared automatically
            when the task leaves Blocked, so it never outlives the blockage.
          </FieldHint>
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={cancel}>
            Cancel
          </Button>
          <Button type="submit" loading={busy} disabled={!reason.trim()}>
            Mark blocked
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
