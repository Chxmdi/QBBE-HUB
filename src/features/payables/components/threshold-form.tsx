"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { FieldHint, Input, Label } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { centsToDecimal, formatCents } from "@/features/ledger/money";
import { setBillApprovalThreshold } from "@/features/payables/services/payables.commands";
import { useLocale, useT } from "@/lib/i18n/client";

/** The bill total at or above which a bill needs an approval before posting. */
export function ThresholdForm({ thresholdCents, canEdit }: { thresholdCents: number | null; canEdit: boolean }) {
  const router = useRouter();
  const { toast } = useToast();
  const t = useT();
  const locale = useLocale();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!canEdit) {
    return (
      <p className="mt-6 text-[13px] text-muted">
        {thresholdCents === null
          ? t("finance.payables.threshold.noneSet")
          : t("finance.payables.threshold.readOnly", { amount: formatCents(thresholdCents, locale) })}
      </p>
    );
  }

  return (
    <form
      className="card mt-6 flex flex-wrap items-end gap-3 p-4"
      aria-label={t("finance.payables.threshold.ariaLabel")}
      onSubmit={async (e) => {
        e.preventDefault();
        setSaving(true);
        setError(null);
        const form = new FormData(e.currentTarget);
        const result = await setBillApprovalThreshold({ threshold: String(form.get("threshold") ?? "") });
        setSaving(false);
        if (!result.ok) {
          setError(result.error ?? t("finance.payables.threshold.couldNotSave"));
          return;
        }
        toast(t("finance.payables.threshold.saved"), { tone: "success" });
        router.refresh();
      }}
    >
      <div>
        <Label htmlFor="bill-threshold">{t("finance.payables.threshold.label")}</Label>
        <Input
          id="bill-threshold"
          name="threshold"
          inputMode="decimal"
          defaultValue={thresholdCents === null ? "" : centsToDecimal(thresholdCents)}
          className="text-right tabular-nums"
        />
        <FieldHint>{t("finance.payables.threshold.hint")}</FieldHint>
      </div>
      <Button type="submit" variant="secondary" loading={saving}>
        {t("finance.payables.threshold.save")}
      </Button>
      {error ? (
        <p role="alert" className="text-[13px] text-danger-fg">
          {error}
        </p>
      ) : null}
    </form>
  );
}
