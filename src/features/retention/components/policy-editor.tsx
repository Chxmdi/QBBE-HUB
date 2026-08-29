"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import {
  ACTION_LABELS,
  describeDuration,
  policyIsAllowed,
  type RetentionSubject,
} from "@/features/retention/schemas";
import type { PolicyRow } from "@/features/retention/services/retention.queries";
import { saveRetentionPolicy } from "@/features/retention/services/retention.commands";

/**
 * Editing one policy.
 *
 * Two things this insists on. The floor is checked as the number is typed, so
 * an administrator learns the minimum before submitting rather than after.
 * And switching a policy on asks for confirmation with the count in the
 * sentence — "this will delete 4,182 records" is a different decision from
 * "enable retention", and only one of them is the truth.
 */
export function PolicyEditor({
  subject,
  policy,
  wouldAffect,
}: {
  subject: RetentionSubject;
  policy: PolicyRow | null;
  wouldAffect: number | null;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [days, setDays] = React.useState(
    String(policy?.retain_days ?? subject.default_days),
  );
  const [action, setAction] = React.useState(policy?.action ?? subject.allowed_actions[0]);

  const parsedDays = Number(days);
  const check = Number.isFinite(parsedDays)
    ? policyIsAllowed(subject, { retainDays: parsedDays, action })
    : { ok: false as const, reason: "Enter a number of days." };

  if (!open) {
    return (
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
          {policy ? "Change" : "Set a policy"}
        </Button>
        {error ? <span className="text-[12.5px] text-danger-fg">{error}</span> : null}
      </div>
    );
  }

  return (
    <form
      className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2"
      onSubmit={async (event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const enabled = form.get("enabled") === "on";

        if (enabled && wouldAffect && wouldAffect > 0) {
          const confirmed = window.confirm(
            `Switching this on will ${
              action === "delete" ? "permanently delete" : "redact"
            } ${wouldAffect.toLocaleString()} ${subject.label.toLowerCase()} records on the next nightly run, and more as they age past ${describeDuration(
              parsedDays,
            )}. Continue?`,
          );
          if (!confirmed) return;
        }

        setBusy(true);
        setError(null);
        const result = await saveRetentionPolicy({
          subjectKey: subject.key,
          retainDays: parsedDays,
          action,
          enabled,
          note: String(form.get("note") ?? "").trim() || undefined,
        });
        setBusy(false);

        if (!result.ok) {
          setError(result.error ?? "That didn't work. Try again.");
          return;
        }
        setOpen(false);
        router.refresh();
      }}
    >
      <div>
        <Label htmlFor={`days-${subject.key}`}>Keep for (days)</Label>
        <Input
          id={`days-${subject.key}`}
          value={days}
          onChange={(event) => setDays(event.currentTarget.value)}
          inputMode="numeric"
          aria-describedby={`floor-${subject.key}`}
        />
        <p id={`floor-${subject.key}`} className="meta mt-1">
          At least {describeDuration(subject.minimum_days)}.
          {Number.isFinite(parsedDays) && parsedDays >= subject.minimum_days
            ? ` That is ${describeDuration(parsedDays)}.`
            : ""}
        </p>
      </div>

      <div>
        <Label htmlFor={`action-${subject.key}`}>What happens</Label>
        <Select
          id={`action-${subject.key}`}
          value={action}
          onChange={(event) =>
            setAction(event.currentTarget.value as typeof action)
          }
        >
          {subject.allowed_actions.map((value) => (
            <option key={value} value={value}>
              {ACTION_LABELS[value]}
            </option>
          ))}
        </Select>
      </div>

      <div className="sm:col-span-2">
        <Label htmlFor={`note-${subject.key}`}>Why (optional)</Label>
        <Textarea
          id={`note-${subject.key}`}
          name="note"
          rows={2}
          defaultValue={policy?.note ?? ""}
        />
      </div>

      <label className="flex items-center gap-2 text-[13.5px] sm:col-span-2">
        <input
          type="checkbox"
          name="enabled"
          defaultChecked={policy?.enabled ?? false}
          className="size-4"
        />
        Apply this every night
      </label>

      {!check.ok ? (
        <p role="alert" className="text-[12.5px] text-danger-fg sm:col-span-2">
          {check.reason}
        </p>
      ) : null}

      <div className="flex items-center gap-2 sm:col-span-2">
        <Button type="submit" size="sm" loading={busy} disabled={busy || !check.ok}>
          Save
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
        >
          Cancel
        </Button>
        {error ? (
          <span role="alert" className="text-[12.5px] text-danger-fg">
            {error}
          </span>
        ) : null}
      </div>
    </form>
  );
}
