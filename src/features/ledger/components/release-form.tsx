"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { FieldHint, Input, Label, Select, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { formatCents } from "@/features/ledger/money";
import { releaseRestricted } from "@/features/ledger/services/ledger.commands";

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
          setError(result.error ?? "Something went wrong. Try again.");
          return;
        }
        toast("Released and posted.", { tone: "success" });
        formEl.reset();
        setFromId("");
        router.refresh();
      }}
    >
      <div>
        <Label htmlFor="release-from">From restricted fund</Label>
        <Select
          id="release-from"
          name="fromFundId"
          required
          value={fromId}
          onChange={(e) => setFromId(e.target.value)}
        >
          <option value="">Choose a restricted fund</option>
          {restricted.map((f) => (
            <option key={f.id} value={f.id}>
              {f.code} {f.name}
            </option>
          ))}
        </Select>
        <FieldHint>
          {from ? `${formatCents(from.availableCents ?? 0)} available today.` : "Only restricted funds can be released."}
        </FieldHint>
      </div>
      <div>
        <Label htmlFor="release-to">To unrestricted fund</Label>
        <Select id="release-to" name="toFundId" required defaultValue={unrestricted.length === 1 ? unrestricted[0].id : ""}>
          <option value="">Choose an unrestricted fund</option>
          {unrestricted.map((f) => (
            <option key={f.id} value={f.id}>
              {f.code} {f.name}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <Label htmlFor="release-amount">Amount</Label>
        <Input id="release-amount" name="amount" inputMode="decimal" required placeholder="0.00" />
      </div>
      <div>
        <Label htmlFor="release-date">Release date</Label>
        <Input id="release-date" name="releaseDate" type="date" required defaultValue={defaultDate} />
        <FieldHint>Must fall in an open period.</FieldHint>
      </div>
      <div className="md:col-span-2">
        <Label htmlFor="release-condition">Condition met</Label>
        <Textarea
          id="release-condition"
          name="condition"
          required
          maxLength={300}
          rows={2}
          placeholder="For example: funder accepted the final report on 2027-03-31"
        />
        <FieldHint>Goes into the entry&apos;s memo, so the accountant sees why the money was released.</FieldHint>
      </div>
      <div className="flex flex-col gap-2 md:col-span-2 md:flex-row md:items-center">
        <Button type="submit" loading={pending}>
          Release and post
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
