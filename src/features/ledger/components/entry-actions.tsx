"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FieldHint, Input, Label } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { deleteDraft, postEntry, reverseEntry } from "@/features/ledger/services/ledger.commands";

/** Post, edit or delete a draft. */
export function DraftActions({ entryId }: { entryId: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, setPending] = useState<null | "post" | "delete">(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap gap-2">
        <Link
          href={`/finance/ledger/journal/${entryId}?edit=1`}
          className="inline-flex h-9.5 items-center rounded-(--radius-sm) border border-line bg-surface px-4 text-sm font-medium hover:bg-surface-soft"
        >
          Edit draft
        </Link>
        <Button
          variant="danger"
          loading={pending === "delete"}
          disabled={pending !== null}
          onClick={async () => {
            if (!window.confirm("Delete this draft? It has not been posted, so nothing else changes.")) return;
            setPending("delete");
            setError(null);
            const result = await deleteDraft(entryId);
            setPending(null);
            if (!result.ok) {
              setError(result.error ?? "Could not delete the draft.");
              return;
            }
            toast("Draft deleted.", { tone: "success" });
            router.push("/finance/ledger/journal");
            router.refresh();
          }}
        >
          Delete draft
        </Button>
        <Button
          loading={pending === "post"}
          disabled={pending !== null}
          onClick={async () => {
            if (!window.confirm("Post this entry? A posted entry can never be changed or deleted, only reversed.")) {
              return;
            }
            setPending("post");
            setError(null);
            const result = await postEntry(entryId);
            setPending(null);
            if (!result.ok) {
              setError(result.error ?? "Could not post the entry.");
              return;
            }
            toast("Entry posted.", { tone: "success" });
            router.refresh();
          }}
        >
          Post entry
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-[13px] text-danger-fg">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Corrects a posted entry with its mirror image on a chosen date. */
export function ReverseEntryButton({
  entryId,
  entryNumber,
  defaultDate,
  minDate,
}: {
  entryId: string;
  entryNumber: number;
  defaultDate: string;
  minDate: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Reverse entry
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={`Reverse entry ${entryNumber}`}>
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setSaving(true);
            setError(null);
            const form = new FormData(e.currentTarget);
            const result = await reverseEntry({
              entryId,
              entryDate: form.get("entryDate"),
              memo: form.get("memo") ?? undefined,
            });
            setSaving(false);
            if (!result.ok || !result.id) {
              setError(result.error ?? "Could not reverse the entry.");
              return;
            }
            toast("Reversing entry posted.", { tone: "success" });
            setOpen(false);
            router.push(`/finance/ledger/journal/${result.id}`);
            router.refresh();
          }}
        >
          <p className="text-[13.5px] text-muted">
            This posts a new entry with every debit and credit swapped, which cancels this one. The original stays
            in the books unchanged. Post a corrected entry afterwards if one is needed.
          </p>
          <div>
            <Label htmlFor="reverse-date">Date of the reversal</Label>
            <Input id="reverse-date" name="entryDate" type="date" defaultValue={defaultDate} min={minDate} required />
            <FieldHint>Must be in an open period, on or after {minDate}.</FieldHint>
          </div>
          <div>
            <Label htmlFor="reverse-memo">Memo (optional)</Label>
            <Input id="reverse-memo" name="memo" maxLength={500} placeholder={`Reversal of entry ${entryNumber}`} />
          </div>
          {error ? (
            <p role="alert" className="text-[13px] text-danger-fg">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={saving}>
              Post reversal
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
