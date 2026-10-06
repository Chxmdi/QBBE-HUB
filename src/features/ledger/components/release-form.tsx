"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { FieldHint, Input, Label, Select, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { formatCents } from "@/features/ledger/money";
import { fundAvailableOn, releaseRestricted } from "@/features/ledger/services/ledger.commands";
import { useFormatters, useLocale, useT } from "@/lib/i18n/client";

export interface ReleaseFundOption {
  id: string;
  code: string;
  name: string;
  /** What the fund can release on the form's default date; only for restricted funds. */
  availableCents?: number;
}

/**
 * What the chosen fund can release on the chosen date. Starts from the figure
 * the page loaded for the default date, and asks again whenever the fund or
 * the date changes, so the hint matches what the release will be checked
 * against. `null` while asking or when the date is not a full date.
 */
function useAvailable(from: ReleaseFundOption | undefined, date: string, defaultDate: string) {
  const [asked, setAsked] = useState<{ key: string; cents: number | null } | null>(null);
  const key = from ? `${from.id}|${date}` : "";
  const complete = /^\d{4}-\d{2}-\d{2}$/.test(date);
  const isDefault = date === defaultDate && from?.availableCents !== undefined;
  useEffect(() => {
    if (!from || !complete || isDefault) return;
    let current = true;
    void fundAvailableOn(from.id, date).then((cents) => {
      if (current) setAsked({ key, cents });
    });
    return () => {
      current = false;
    };
  }, [from, date, key, complete, isDefault]);
  if (!from || !complete) return null;
  if (isDefault) return from.availableCents ?? null;
  return asked?.key === key ? asked.cents : null;
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
  const format = useFormatters();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fromId, setFromId] = useState("");
  const [date, setDate] = useState(defaultDate);
  const from = restricted.find((f) => f.id === fromId);
  const available = useAvailable(from, date, defaultDate);

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
        setDate(defaultDate);
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
        {/* Announced when it changes, so a screen reader hears the new figure. */}
        <div aria-live="polite">
          <FieldHint>
            {!from
              ? t("finance.ledger.release.form.onlyRestricted")
              : available === null
                ? t("finance.ledger.release.form.checkingAvailable")
                : t("finance.ledger.release.form.available", {
                    amount: formatCents(available, locale),
                    // A date-only value: read in UTC so it never shows as the day before.
                    date: format.inZone(date, "UTC", { year: "numeric", month: "short", day: "numeric" }),
                  })}
          </FieldHint>
        </div>
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
        <Input
          id="release-date"
          name="releaseDate"
          type="date"
          required
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
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
