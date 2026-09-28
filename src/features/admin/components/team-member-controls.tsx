"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { addTeamMember, removeTeamMember } from "@/features/admin/services/team.commands";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n/client";

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
  const t = useT();
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    setError(null);
    const result = isMember
      ? await removeTeamMember(teamId, userId)
      : await addTeamMember(teamId, userId);
    if (!result.ok) {
      setError(result.error ?? t("admin.teamControls.updateFailed"));
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
        title={isOwner ? t("admin.teamControls.ownerTitle") : undefined}
        className="h-8 text-[12.5px]"
      >
        {isOwner
          ? t("admin.teamControls.teamOwner")
          : isMember
            ? t("admin.teamControls.remove", { label })
            : t("admin.teamControls.add", { label })}
      </Button>
      {error ? <span className="text-[12px] text-danger-fg">{error}</span> : null}
    </span>
  );
}
