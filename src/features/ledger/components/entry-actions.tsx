"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FieldHint, Input, Label } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { deleteDraft, postEntry, reverseEntry } from "@/features/ledger/services/ledger.commands";
import { useT } from "@/lib/i18n/client";

/** Post, edit or delete a draft. */
export function DraftActions({ entryId }: { entryId: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const t = useT();
  const [pending, setPending] = useState<null | "post" | "delete">(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap gap-2">
        <Link
          href={`/finance/ledger/journal/${entryId}?edit=1`}
          className="inline-flex h-9.5 items-center rounded-(--radius-sm) border border-line bg-surface px-4 text-sm font-medium hover:bg-surface-soft"
        >
          {t("finance.ledger.entryActions.editDraft")}
        </Link>
        <Button
          variant="danger"
          loading={pending === "delete"}
          disabled={pending !== null}
          onClick={async () => {
            if (!window.confirm(t("finance.ledger.entryActions.deleteConfirm"))) return;
            setPending("delete");
            setError(null);
            const result = await deleteDraft(entryId);
            setPending(null);
            if (!result.ok) {
              setError(result.error ?? t("finance.ledger.entryActions.deleteFailed"));
              return;
            }
            toast(t("finance.ledger.entryActions.deleted"), { tone: "success" });
            router.push("/finance/ledger/journal");
            router.refresh();
          }}
        >
          {t("finance.ledger.entryActions.deleteDraft")}
        </Button>
        <Button
          loading={pending === "post"}
          disabled={pending !== null}
          onClick={async () => {
            if (!window.confirm(t("finance.ledger.entryActions.postConfirm"))) {
              return;
            }
            setPending("post");
            setError(null);
            const result = await postEntry(entryId);
            setPending(null);
            if (!result.ok) {
              setError(result.error ?? t("finance.ledger.entryActions.postFailed"));
              return;
            }
            toast(t("finance.ledger.entryActions.posted"), { tone: "success" });
            router.refresh();
          }}
        >
          {t("finance.ledger.entryActions.postEntry")}
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
  const t = useT();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        {t("finance.ledger.entryActions.reverseEntry")}
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={t("finance.ledger.entryActions.reverseTitle", { number: entryNumber })}>
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
              setError(result.error ?? t("finance.ledger.entryActions.reverseFailed"));
              return;
            }
            toast(t("finance.ledger.entryActions.reversed"), { tone: "success" });
            setOpen(false);
            router.push(`/finance/ledger/journal/${result.id}`);
            router.refresh();
          }}
        >
          <p className="text-[13.5px] text-muted">
            {t("finance.ledger.entryActions.reverseExplainer")}
          </p>
          <div>
            <Label htmlFor="reverse-date">{t("finance.ledger.entryActions.reversalDate")}</Label>
            <Input id="reverse-date" name="entryDate" type="date" defaultValue={defaultDate} min={minDate} required />
            <FieldHint>{t("finance.ledger.entryActions.reversalDateHint", { date: minDate })}</FieldHint>
          </div>
          <div>
            <Label htmlFor="reverse-memo">{t("finance.ledger.optionalLabel.memo")}</Label>
            <Input id="reverse-memo" name="memo" maxLength={500} placeholder={t("finance.ledger.entryActions.reversalMemoPlaceholder", { number: entryNumber })} />
          </div>
          {error ? (
            <p role="alert" className="text-[13px] text-danger-fg">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              {t("finance.common.cancel")}
            </Button>
            <Button type="submit" loading={saving}>
              {t("finance.ledger.entryActions.postReversal")}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
