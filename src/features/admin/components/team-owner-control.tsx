"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Label, Select } from "@/components/ui/input";
import { transferTeamOwnership } from "@/features/admin/services/team.commands";
import { useT } from "@/lib/i18n/client";

export function TeamOwnerControl({
  teamId,
  currentOwnerId,
  members,
}: {
  teamId: string;
  currentOwnerId: string;
  members: { id: string; name: string }[];
}) {
  const router = useRouter();
  const t = useT();
  const [ownerId, setOwnerId] = useState(currentOwnerId);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputId = `team-owner-${teamId}`;

  async function save() {
    setSaving(true);
    setError(null);
    const result = await transferTeamOwnership(teamId, ownerId);
    setSaving(false);
    if (!result.ok) {
      setError(result.error ?? t("admin.teamControls.transferFailed"));
      return;
    }
    router.refresh();
  }

  return (
    <div className="mt-3 rounded-md border border-line bg-surface-soft/40 p-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-52 flex-1">
          <Label htmlFor={inputId}>{t("admin.teamControls.teamOwner")}</Label>
          <Select
            id={inputId}
            value={ownerId}
            onChange={(event) => setOwnerId(event.target.value)}
            disabled={saving}
          >
            {members.map((member) => (
              <option key={member.id} value={member.id}>{member.name}</option>
            ))}
          </Select>
        </div>
        <Button
          type="button"
          variant="secondary"
          onClick={save}
          loading={saving}
          disabled={ownerId === currentOwnerId || members.length === 0}
        >
          {t("admin.teamControls.transfer")}
        </Button>
      </div>
      <p className="mt-2 text-[12.5px] text-muted">
        {t("admin.teamControls.transferHelp")}
      </p>
      {error ? <p role="alert" className="mt-2 text-[12.5px] text-danger-fg">{error}</p> : null}
    </div>
  );
}
