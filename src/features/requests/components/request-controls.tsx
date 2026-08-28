"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import {
  PROJECT_REQUEST_STATUSES,
  REFUSED_REQUEST_STATUSES,
  REQUEST_STATUS_LABELS,
  type ProjectRequestStatus,
} from "@/features/requests/schemas";
import {
  decideApproval,
  decideProjectRequest,
} from "@/features/requests/services/request.commands";

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

/**
 * Deciding one project request.
 *
 * Approving asks for the project's name, because the proposal's title is
 * written to persuade and the project's name has to be worked with daily —
 * they are usually not the same sentence. Declining asks why, which the
 * database also insists on; asking here means the person is not refused after
 * the fact.
 */
export function RequestDecision({
  requestId,
  title,
  status,
}: {
  requestId: string;
  title: string;
  status: ProjectRequestStatus;
}) {
  const { busy, error, run } = useRowAction();
  const [open, setOpen] = React.useState(false);
  const [next, setNext] = React.useState<ProjectRequestStatus>(status);

  const approving = next === "approved";
  const refusing = REFUSED_REQUEST_STATUSES.includes(next);

  if (!open) {
    return (
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
          Decide
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
        const saved = await run(() =>
          decideProjectRequest({
            requestId,
            status: next,
            decisionNote: String(form.get("decisionNote") ?? "").trim() || undefined,
            projectName: String(form.get("projectName") ?? "").trim() || undefined,
          }),
        );
        if (saved) setOpen(false);
      }}
    >
      <div>
        <Label htmlFor={`request-status-${requestId}`}>Decision</Label>
        <Select
          id={`request-status-${requestId}`}
          value={next}
          onChange={(event) =>
            setNext(event.currentTarget.value as ProjectRequestStatus)
          }
        >
          {PROJECT_REQUEST_STATUSES.filter((value) => value !== "withdrawn").map(
            (value) => (
              <option key={value} value={value}>
                {REQUEST_STATUS_LABELS[value]}
              </option>
            ),
          )}
        </Select>
      </div>

      {approving ? (
        <div>
          <Label htmlFor={`project-name-${requestId}`}>Project name</Label>
          <Input
            id={`project-name-${requestId}`}
            name="projectName"
            defaultValue={title}
            maxLength={200}
          />
        </div>
      ) : null}

      <div className="sm:col-span-2">
        <Label htmlFor={`request-note-${requestId}`}>
          {refusing ? "Why not? The next person to propose this needs to know." : "Note"}
        </Label>
        <Textarea
          id={`request-note-${requestId}`}
          name="decisionNote"
          rows={2}
          required={refusing}
        />
      </div>

      <div className="flex items-center gap-2 sm:col-span-2">
        <Button type="submit" size="sm" loading={busy} disabled={busy}>
          {approving ? "Approve and open the project" : "Save"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => {
            setOpen(false);
            setNext(status);
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

/** Answering an approval addressed to you. */
export function ApprovalDecision({ approvalId }: { approvalId: string }) {
  const { busy, error, run } = useRowAction();
  const [rejecting, setRejecting] = React.useState(false);

  if (rejecting) {
    return (
      <form
        className="mt-2"
        onSubmit={async (event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          const saved = await run(() =>
            decideApproval({
              approvalId,
              decision: "rejected",
              decisionNote: String(form.get("decisionNote") ?? "").trim(),
            }),
          );
          if (saved) setRejecting(false);
        }}
      >
        <Label htmlFor={`reject-${approvalId}`}>Why are you rejecting it?</Label>
        <Textarea id={`reject-${approvalId}`} name="decisionNote" rows={2} required />
        <div className="mt-2 flex items-center gap-2">
          <Button type="submit" size="sm" loading={busy} disabled={busy}>
            Reject
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setRejecting(false)}
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

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <Button
        size="sm"
        loading={busy}
        disabled={busy}
        onClick={() => run(() => decideApproval({ approvalId, decision: "approved" }))}
      >
        Approve
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setRejecting(true)}>
        Reject
      </Button>
      {error ? <span className="text-[12.5px] text-danger-fg">{error}</span> : null}
    </div>
  );
}
