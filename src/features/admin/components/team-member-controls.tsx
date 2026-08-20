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
}: {
  teamId: string;
  userId: string;
  isMember: boolean;
  label: string;
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
      <Button variant="secondary" type="button" onClick={toggle} className="h-8 text-[12.5px]">
        {isMember ? `Remove ${label}` : `Add ${label}`}
      </Button>
      {error ? <span className="text-[12px] text-danger-fg">{error}</span> : null}
    </span>
  );
}
