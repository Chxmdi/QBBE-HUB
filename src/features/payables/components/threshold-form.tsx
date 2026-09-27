"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { FieldHint, Input, Label } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { centsToDecimal, formatCents } from "@/features/ledger/money";
import { setBillApprovalThreshold } from "@/features/payables/services/payables.commands";

/** The bill total at or above which a bill needs an approval before posting. */
export function ThresholdForm({ thresholdCents, canEdit }: { thresholdCents: number | null; canEdit: boolean }) {
  const router = useRouter();
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!canEdit) {
    return (
      <p className="mt-6 text-[13px] text-muted">
        {thresholdCents === null
          ? "No approval threshold is set for bills."
          : `Bills of ${formatCents(thresholdCents)} or more need an approval before they are posted.`}
      </p>
    );
  }

  return (
    <form
      className="card mt-6 flex flex-wrap items-end gap-3 p-4"
      aria-label="Bill approval threshold"
      onSubmit={async (e) => {
        e.preventDefault();
        setSaving(true);
        setError(null);
        const form = new FormData(e.currentTarget);
        const result = await setBillApprovalThreshold({ threshold: String(form.get("threshold") ?? "") });
        setSaving(false);
        if (!result.ok) {
          setError(result.error ?? "Could not save the threshold.");
          return;
        }
        toast("Threshold saved.", { tone: "success" });
        router.refresh();
      }}
    >
      <div>
        <Label htmlFor="bill-threshold">Approval needed for bills of (total)</Label>
        <Input
          id="bill-threshold"
          name="threshold"
          inputMode="decimal"
          defaultValue={thresholdCents === null ? "" : centsToDecimal(thresholdCents)}
          className="text-right tabular-nums"
        />
        <FieldHint>Leave empty for no threshold. Applies where approvals are set up.</FieldHint>
      </div>
      <Button type="submit" variant="secondary" loading={saving}>
        Save threshold
      </Button>
      {error ? (
        <p role="alert" className="text-[13px] text-danger-fg">
          {error}
        </p>
      ) : null}
    </form>
  );
}
