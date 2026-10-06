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
import { useT } from "@/lib/i18n/client";

export function MemberRoleSelect({
  membershipId,
  role,
}: {
  membershipId: string;
  role: OrgRole;
}) {
  const router = useRouter();
  const t = useT();
  const [value, setValue] = useState<OrgRole>(role);
  const [error, setError] = useState<string | null>(null);

  if (role === "owner") {
    return <span className="text-[13px] font-medium">{t("admin.roles.owner")}</span>;
  }

  async function handleChange(next: OrgRole) {
    const previous = value;
    setValue(next);
    setError(null);
    const result = await changeMemberRole({ membershipId, role: next });
    if (!result.ok) {
      setValue(previous);
      setError(result.error ?? t("admin.genericFailed"));
      return;
    }
    router.refresh();
  }

  return (
    <div>
      <Select
        aria-label={t("admin.members.roleLabel")}
        value={value}
        onChange={(e) => handleChange(e.target.value as OrgRole)}
        className="h-8 w-32 text-[12.5px]"
      >
        <option value="admin">{t("admin.roles.admin")}</option>
        <option value="leadership_viewer">{t("admin.roles.leadership_viewer")}</option>
        <option value="staff">{t("admin.roles.staff")}</option>
        <option value="volunteer">{t("admin.roles.volunteer")}</option>
        <option value="guest">{t("admin.roles.guest")}</option>
      </Select>
      {error ? (
        <p role="alert" className="mt-1 text-[12px] text-danger-fg">
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
  const t = useT();
  const [error, setError] = useState<string | null>(null);

  if (isOwner || isSelf) return null;

  async function handleToggle() {
    if (
      active &&
      !window.confirm(t("admin.members.deactivateConfirm"))
    )
      return;
    setError(null);
    const result = await setMemberActive(membershipId, !active);
    if (!result.ok) {
      setError(result.error ?? t("admin.genericFailed"));
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
            ? "text-[12.5px] font-medium text-danger-fg hover:underline"
            : "text-[12.5px] font-medium text-success-fg hover:underline"
        }
      >
        {active ? t("admin.members.deactivate") : t("admin.members.reactivate")}
      </button>
      {error ? (
        <p role="alert" className="mt-1 text-[12px] text-danger-fg">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function RevokeInvitationButton({ invitationId }: { invitationId: string }) {
  const router = useRouter();
  const t = useT();
  async function handleRevoke() {
    const result = await revokeInvitation(invitationId);
    if (result.ok) router.refresh();
  }
  return (
    <button
      type="button"
      onClick={handleRevoke}
      className="text-[12.5px] font-medium text-danger-fg hover:underline"
    >
      {t("admin.members.revoke")}
    </button>
  );
}
