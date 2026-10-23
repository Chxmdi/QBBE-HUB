"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Select } from "@/components/ui/input";
import {
  changeMemberRole,
  reissueInvitation,
  revokeInvitation,
  setMemberActive,
} from "@/features/admin/services/admin.commands";
import type { OrgRole } from "@/types/entities";
import { useT } from "@/lib/i18n/client";
import { runServerAction } from "@/lib/use-server-action";
import { InvitationLinkField } from "./invitation-link-field";

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

/**
 * Replace a pending or expired invitation's link (SEC-001): the old link stops
 * working, the new one is emailed and shown here once. Invitations made before
 * links existed get theirs this way.
 */
export function NewInvitationLinkButton({
  invitationId,
  email,
}: {
  invitationId: string;
  email: string;
}) {
  const router = useRouter();
  const t = useT();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [created, setCreated] = useState<{
    link: string;
    expiresAt: string;
    timeZone?: string;
  } | null>(null);

  function openDialog() {
    setError(null);
    setNotice(null);
    setCreated(null);
    setOpen(true);
  }

  // Asked first, because the person may be about to use the current link.
  async function handleNewLink() {
    const result = await runServerAction(() => reissueInvitation(invitationId), {
      setBusy,
      setError,
      t,
      reload: () => window.location.reload(),
    });
    if (!result) return;
    if (!result.ok) {
      setError(result.error ?? t("admin.workspace.invitations.newLinkFailed"));
      return;
    }
    setNotice(
      result.emailSent
        ? t("admin.invite.sent", { email })
        : t("admin.invite.notSent", { email }),
    );
    if (result.inviteLink && result.expiresAt) {
      setCreated({ link: result.inviteLink, expiresAt: result.expiresAt, timeZone: result.timeZone });
    }
    router.refresh();
  }

  const done = Boolean(notice || created);

  return (
    <>
      <button
        type="button"
        onClick={openDialog}
        aria-label={t("admin.workspace.invitations.newLinkFor", { email })}
        className="text-[12.5px] font-medium text-brand-fg hover:underline disabled:opacity-60"
      >
        {t("admin.workspace.invitations.newLink")}
      </button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={t("admin.workspace.invitations.newLinkFor", { email })}
      >
        <div className="space-y-4">
          {!done ? (
            <p className="text-[13.5px]">
              {t("admin.workspace.invitations.newLinkConfirm", { email })}
            </p>
          ) : null}
          {/* Mounted for the dialog's whole life so the change is announced. */}
          <p aria-live="polite" className="text-[13px] text-muted">
            {busy ? t("admin.workspace.invitations.creatingLink") : ""}
          </p>
          {error ? <p role="alert" className="text-[13px] text-danger-fg">{error}</p> : null}
          {notice ? <p role="status" className="text-[13px] text-success-fg">{notice}</p> : null}
          {created ? (
            <InvitationLinkField
              link={created.link}
              email={email}
              expiresAt={created.expiresAt}
              timeZone={created.timeZone}
            />
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              {done ? t("admin.invite.close") : t("common.cancel")}
            </Button>
            {!done ? (
              <Button type="button" loading={busy} onClick={handleNewLink}>
                {t("admin.workspace.invitations.newLinkCreate")}
              </Button>
            ) : null}
          </div>
        </div>
      </Dialog>
    </>
  );
}
