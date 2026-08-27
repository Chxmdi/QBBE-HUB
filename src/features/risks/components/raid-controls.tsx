"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Label, Select, Textarea } from "@/components/ui/input";
import {
  ISSUE_STATUSES,
  RISK_STATUSES,
  SETTLED_ISSUE_STATUSES,
  SETTLED_RISK_STATUSES,
  type IssueStatus,
  type RiskStatus,
} from "@/features/risks/schemas";
import {
  escalateRiskToIssue,
  updateIssue,
  updateRisk,
} from "@/features/risks/services/risk.commands";

/**
 * Inline controls for a single risk or issue.
 *
 * Settling either one demands a sentence — a mitigation for a risk, a
 * resolution for an issue — and the form asks for it the moment that status is
 * chosen, rather than letting someone submit and be refused by a constraint.
 * The database enforces the same rule; this is the humane half of it.
 */

function useRowAction() {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(true);
    setError(null);
    const result = await action();
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? "That didn't work. Try again.");
      return false;
    }
    router.refresh();
    return true;
  }

  return { busy, error, run };
}

export function RiskControls({
  riskId,
  status,
  mitigation,
  people,
}: {
  riskId: string;
  status: RiskStatus;
  mitigation: string | null;
  people: { value: string; label: string }[];
}) {
  const { busy, error, run } = useRowAction();
  const [open, setOpen] = React.useState(false);
  const [nextStatus, setNextStatus] = React.useState<RiskStatus>(status);
  const [note, setNote] = React.useState(mitigation ?? "");

  const needsNote = SETTLED_RISK_STATUSES.includes(nextStatus);

  return (
    <div className="mt-2">
      {!open ? (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
            Update
          </Button>
          <Button
            size="sm"
            variant="ghost"
            loading={busy}
            disabled={busy}
            onClick={() =>
              run(() => escalateRiskToIssue({ riskId, severity: "high" }))
            }
          >
            It happened — raise as issue
          </Button>
          {error ? <span className="text-[12.5px] text-danger-fg">{error}</span> : null}
        </div>
      ) : (
        <form
          className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2"
          onSubmit={async (event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            const ownerId = String(form.get("ownerId") ?? "");
            const saved = await run(() =>
              updateRisk({
                riskId,
                status: nextStatus,
                mitigation: note || undefined,
                ...(ownerId ? { ownerId } : {}),
              }),
            );
            if (saved) setOpen(false);
          }}
        >
          <div>
            <Label htmlFor={`risk-status-${riskId}`}>Status</Label>
            <Select
              id={`risk-status-${riskId}`}
              value={nextStatus}
              onChange={(event) => setNextStatus(event.currentTarget.value as RiskStatus)}
            >
              {RISK_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor={`risk-owner-${riskId}`}>Owner</Label>
            <Select id={`risk-owner-${riskId}`} name="ownerId" defaultValue="">
              <option value="">Unchanged</option>
              {people.map((person) => (
                <option key={person.value} value={person.value}>
                  {person.label}
                </option>
              ))}
            </Select>
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor={`risk-note-${riskId}`}>
              {needsNote ? "Why you are settling it" : "What you are doing about it"}
            </Label>
            <Textarea
              id={`risk-note-${riskId}`}
              value={note}
              required={needsNote}
              onChange={(event) => setNote(event.currentTarget.value)}
              placeholder={
                needsNote
                  ? "Accepting or closing a risk is a decision. Record the reasoning."
                  : "Optional."
              }
            />
          </div>
          <div className="flex items-center gap-3 sm:col-span-2">
            <Button type="submit" size="sm" loading={busy} disabled={busy}>
              Save
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            {error ? <span className="text-[12.5px] text-danger-fg">{error}</span> : null}
          </div>
        </form>
      )}
    </div>
  );
}

export function IssueControls({
  issueId,
  status,
  people,
}: {
  issueId: string;
  status: IssueStatus;
  people: { value: string; label: string }[];
}) {
  const { busy, error, run } = useRowAction();
  const [open, setOpen] = React.useState(false);
  const [nextStatus, setNextStatus] = React.useState<IssueStatus>(status);
  const [resolution, setResolution] = React.useState("");

  const needsResolution = SETTLED_ISSUE_STATUSES.includes(nextStatus);

  if (!open) {
    return (
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
          Update
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
        const ownerId = String(form.get("ownerId") ?? "");
        const saved = await run(() =>
          updateIssue({
            issueId,
            status: nextStatus,
            resolution: resolution || undefined,
            ...(ownerId ? { ownerId } : {}),
          }),
        );
        if (saved) setOpen(false);
      }}
    >
      <div>
        <Label htmlFor={`issue-status-${issueId}`}>Status</Label>
        <Select
          id={`issue-status-${issueId}`}
          value={nextStatus}
          onChange={(event) => setNextStatus(event.currentTarget.value as IssueStatus)}
        >
          {ISSUE_STATUSES.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <Label htmlFor={`issue-owner-${issueId}`}>Owner</Label>
        <Select id={`issue-owner-${issueId}`} name="ownerId" defaultValue="">
          <option value="">Unchanged</option>
          {people.map((person) => (
            <option key={person.value} value={person.value}>
              {person.label}
            </option>
          ))}
        </Select>
      </div>
      {needsResolution ? (
        <div className="sm:col-span-2">
          <Label htmlFor={`issue-resolution-${issueId}`}>How it was resolved</Label>
          <Textarea
            id={`issue-resolution-${issueId}`}
            value={resolution}
            required
            onChange={(event) => setResolution(event.currentTarget.value)}
            placeholder="An issue closed without a resolution is not resolved, only hidden."
          />
        </div>
      ) : null}
      <div className="flex items-center gap-3 sm:col-span-2">
        <Button type="submit" size="sm" loading={busy} disabled={busy}>
          Save
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        {error ? <span className="text-[12.5px] text-danger-fg">{error}</span> : null}
      </div>
    </form>
  );
}
