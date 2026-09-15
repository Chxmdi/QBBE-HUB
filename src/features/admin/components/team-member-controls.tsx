"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { addTeamMember, removeTeamMember } from "@/features/admin/services/team.commands";
import { Button } from "@/components/ui/button";

export function TeamMemberControls({
  teamId,
  userId,
  isMember,
  label,
  isOwner = false,
}: {
  teamId: string;
  userId: string;
  isMember: boolean;
  label: string;
  isOwner?: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    setError(null);
    const result = isMember
      ? await removeTeamMember(teamId, userId)
      : await addTeamMember(teamId, userId);
    if (!result.ok) {
      setError(result.error ?? "Update failed.");
      return;
    }
    router.refresh();
  }

  return (
    <span className="inline-flex items-center gap-2">
      <Button
        variant="secondary"
        type="button"
        onClick={toggle}
        disabled={isOwner}
        title={isOwner ? "Transfer team ownership before removing this person." : undefined}
        className="h-8 text-[12.5px]"
      >
        {isOwner ? "Team owner" : isMember ? `Remove ${label}` : `Add ${label}`}
      </Button>
      {error ? <span className="text-[12px] text-danger-fg">{error}</span> : null}
    </span>
  );
}
