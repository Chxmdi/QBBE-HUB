"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label, Select, Textarea, Input, FieldHint } from "@/components/ui/input";
import { publishStatusUpdate } from "@/features/projects/services/project.commands";

/**
 * Structured project status update (P0-PRJ-05). At-risk / off-track health
 * requires a reason (P0-PRJ-04) — enforced client- and server-side.
 */
export function StatusUpdateForm({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [health, setHealth] = useState("on_track");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const needsReason = health === "at_risk" || health === "off_track";

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    const form = new FormData(e.currentTarget);
    const result = await publishStatusUpdate({
      projectId,
      health,
      progressSummary: form.get("progressSummary"),
      nextSteps: (form.get("nextSteps") as string) || undefined,
      blockers: (form.get("blockers") as string) || undefined,
      decisionsNeeded: (form.get("decisionsNeeded") as string) || undefined,
      helpRequested: (form.get("helpRequested") as string) || undefined,
      healthReason: (form.get("healthReason") as string) || undefined,
    });
    setSaving(false);
    if (!result.ok) {
      setError(result.error ?? "Could not publish the update.");
      return;
    }
    setExpanded(false);
    router.refresh();
  }

  if (!expanded) {
    return (
      <Button variant="secondary" onClick={() => setExpanded(true)}>
        Publish status update
      </Button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="card space-y-4 p-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="update-health">Health</Label>
          <Select
            id="update-health"
            value={health}
            onChange={(e) => setHealth(e.target.value)}
          >
            <option value="on_track">On track</option>
            <option value="at_risk">At risk</option>
            <option value="off_track">Off track</option>
            <option value="paused">Paused</option>
          </Select>
        </div>
        {needsReason ? (
          <div>
            <Label htmlFor="update-reason">Reason (required)</Label>
            <Input
              id="update-reason"
              name="healthReason"
              required
              maxLength={1000}
              placeholder="Why is this project at risk?"
            />
          </div>
        ) : null}
      </div>
      <div>
        <Label htmlFor="update-progress">Progress</Label>
        <Textarea id="update-progress" name="progressSummary" required maxLength={5000} />
        <FieldHint>What moved since the last update?</FieldHint>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="update-next">Next steps</Label>
          <Textarea id="update-next" name="nextSteps" maxLength={5000} />
        </div>
        <div>
          <Label htmlFor="update-blockers">Blockers</Label>
          <Textarea id="update-blockers" name="blockers" maxLength={5000} />
        </div>
        <div>
          <Label htmlFor="update-decisions">Decisions needed</Label>
          <Textarea id="update-decisions" name="decisionsNeeded" maxLength={5000} />
        </div>
        <div>
          <Label htmlFor="update-help">Help requested</Label>
          <Textarea id="update-help" name="helpRequested" maxLength={5000} />
        </div>
      </div>
      {error ? (
        <p role="alert" className="text-[13px] text-danger-fg">
          {error}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={() => setExpanded(false)}>
          Cancel
        </Button>
        <Button type="submit" loading={saving}>
          Publish update
        </Button>
      </div>
    </form>
  );
}
