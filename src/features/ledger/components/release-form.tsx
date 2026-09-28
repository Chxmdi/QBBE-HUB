"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { FieldHint, Input, Label, Select, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { formatCents } from "@/features/ledger/money";
import { releaseRestricted } from "@/features/ledger/services/ledger.commands";
import { useLocale, useT } from "@/lib/i18n/client";

export interface ReleaseFundOption {
  id: string;
  code: string;
  name: string;
  /** What the fund can release today; only for restricted funds. */
  availableCents?: number;
}

/**
 * An owner or admin with MFA releases restricted money to an unrestricted
 * fund once its condition is met (#149). The database checks the funds, the
 * available balance and the period again, and posts the entry.
 */
export function ReleaseForm({
  restricted,
  unrestricted,
  defaultDate,
}: {
  restricted: ReleaseFundOption[];
  unrestricted: ReleaseFundOption[];
  defaultDate: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const t = useT();
  const locale = useLocale();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fromId, setFromId] = useState("");
  const from = restricted.find((f) => f.id === fromId);

  return (
    <form
      className="grid gap-4 md:grid-cols-2"
      onSubmit={async (e) => {
        e.preventDefault();
        const formEl = e.currentTarget;
        const form = new FormData(formEl);
        setPending(true);
        setError(null);
        const result = await releaseRestricted({
          fromFundId: form.get("fromFundId") || undefined,
          toFundId: form.get("toFundId") || undefined,
          amount: form.get("amount"),
          releaseDate: form.get("releaseDate"),
          condition: form.get("condition"),
        });
        setPending(false);
        if (!result.ok) {
          setError(result.error ?? t("finance.ledger.release.form.failed"));
          return;
        }
        toast(t("finance.ledger.release.form.released"), { tone: "success" });
        formEl.reset();
        setFromId("");
        router.refresh();
      }}
    >
      <div>
        <Label htmlFor="release-from">{t("finance.ledger.release.form.fromLabel")}</Label>
        <Select
          id="release-from"
          name="fromFundId"
          required
          value={fromId}
          onChange={(e) => setFromId(e.target.value)}
        >
          <option value="">{t("finance.ledger.release.form.fromPlaceholder")}</option>
          {restricted.map((f) => (
            <option key={f.id} value={f.id}>
              {f.code} {f.name}
            </option>
          ))}
        </Select>
        <FieldHint>
          {from
            ? t("finance.ledger.release.form.available", {
                amount: formatCents(from.availableCents ?? 0, locale),
              })
            : t("finance.ledger.release.form.onlyRestricted")}
        </FieldHint>
      </div>
      <div>
        <Label htmlFor="release-to">{t("finance.ledger.release.form.toLabel")}</Label>
        <Select id="release-to" name="toFundId" required defaultValue={unrestricted.length === 1 ? unrestricted[0].id : ""}>
          <option value="">{t("finance.ledger.release.form.toPlaceholder")}</option>
          {unrestricted.map((f) => (
            <option key={f.id} value={f.id}>
              {f.code} {f.name}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <Label htmlFor="release-amount">{t("finance.ledger.release.form.amount")}</Label>
        <Input id="release-amount" name="amount" inputMode="decimal" required placeholder={t("finance.ledger.release.form.amountPlaceholder")} />
      </div>
      <div>
        <Label htmlFor="release-date">{t("finance.ledger.release.form.date")}</Label>
        <Input id="release-date" name="releaseDate" type="date" required defaultValue={defaultDate} />
        <FieldHint>{t("finance.ledger.release.form.dateHint")}</FieldHint>
      </div>
      <div className="md:col-span-2">
        <Label htmlFor="release-condition">{t("finance.ledger.release.form.condition")}</Label>
        <Textarea
          id="release-condition"
          name="condition"
          required
          maxLength={300}
          rows={2}
          placeholder={t("finance.ledger.release.form.conditionPlaceholder")}
        />
        <FieldHint>{t("finance.ledger.release.form.conditionHint")}</FieldHint>
      </div>
      <div className="flex flex-col gap-2 md:col-span-2 md:flex-row md:items-center">
        <Button type="submit" loading={pending}>
          {t("finance.ledger.release.form.submit")}
        </Button>
        {error ? (
          <p role="alert" className="text-[13px] text-danger-fg">
            {error}
          </p>
        ) : null}
      </div>
    </form>
  );
}
