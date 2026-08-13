"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Select } from "@/components/ui/input";
import {
  changeMemberRole,
  revokeInvitation,
  setMemberActive,
} from "@/features/admin/services/admin.commands";
import type { OrgRole } from "@/types/entities";

export function MemberRoleSelect({
  membershipId,
  role,
}: {
  membershipId: string;
  role: OrgRole;
}) {
  const router = useRouter();
  const [value, setValue] = useState<OrgRole>(role);
  const [error, setError] = useState<string | null>(null);

  if (role === "owner") {
    return <span className="text-[13px] font-medium">Primary Owner</span>;
  }

  async function handleChange(next: OrgRole) {
    const previous = value;
    setValue(next);
    setError(null);
    const result = await changeMemberRole({ membershipId, role: next });
    if (!result.ok) {
      setValue(previous);
      setError(result.error ?? "Failed.");
      return;
    }
    router.refresh();
  }

  return (
    <div>
      <Select
        aria-label="Member role"
        value={value}
        onChange={(e) => handleChange(e.target.value as OrgRole)}
        className="h-8 w-32 text-[12.5px]"
      >
        <option value="admin">Admin</option>
        <option value="staff">Staff</option>
        <option value="volunteer">Volunteer</option>
        <option value="guest">Guest</option>
      </Select>
      {error ? (
        <p role="alert" className="mt-1 text-[12px] text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function MemberActiveToggle({
  membershipId,
  active,
  isOwner,
  isSelf,
}: {
  membershipId: string;
  active: boolean;
  isOwner: boolean;
  isSelf: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  if (isOwner || isSelf) return null;

  async function handleToggle() {
    if (
      active &&
      !window.confirm(
        "Deactivate this account? They lose access immediately; history and attribution are preserved.",
      )
    )
      return;
    setError(null);
    const result = await setMemberActive(membershipId, !active);
    if (!result.ok) {
      setError(result.error ?? "Failed.");
      return;
    }
    router.refresh();
  }

  return (
    <div>
      <button
        type="button"
        onClick={handleToggle}
        className={
          active
            ? "text-[12.5px] font-medium text-danger hover:underline"
            : "text-[12.5px] font-medium text-success hover:underline"
        }
      >
        {active ? "Deactivate" : "Reactivate"}
      </button>
      {error ? (
        <p role="alert" className="mt-1 text-[12px] text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function RevokeInvitationButton({ invitationId }: { invitationId: string }) {
  const router = useRouter();
  async function handleRevoke() {
    const result = await revokeInvitation(invitationId);
    if (result.ok) router.refresh();
  }
  return (
    <button
      type="button"
      onClick={handleRevoke}
      className="text-[12.5px] font-medium text-danger hover:underline"
    >
      Revoke
    </button>
  );
}
