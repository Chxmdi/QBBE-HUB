"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { inviteUser } from "@/features/admin/services/admin.commands";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input, Label, Select } from "@/components/ui/input";
import { Plus } from "lucide-react";
import { useT } from "@/lib/i18n/client";
import { runServerAction } from "@/lib/use-server-action";
import { InvitationLinkField } from "./invitation-link-field";

export function InviteUserDialog({ emailConfigured }: { emailConfigured: boolean }) {
  const router = useRouter();
  const t = useT();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [created, setCreated] = useState<{
    link: string;
    email: string;
    expiresAt: string;
    timeZone?: string;
  } | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setNotice(null);
    setCreated(null);
    const formElement = e.currentTarget;
    const form = new FormData(formElement);
    const email = String(form.get("email") ?? "").trim().toLowerCase();
    const result = await runServerAction(
      () =>
        inviteUser({
          email,
          intendedRole: form.get("intendedRole"),
        }),
      { setBusy: setSaving, setError, t, reload: () => window.location.reload() },
    );
    if (!result) return;
    if (!result.ok) {
      setError(result.error ?? t("admin.errors.inviteFailed"));
      return;
    }
    setNotice(
      result.emailSent
        ? t("admin.invite.sent", { email })
        : t("admin.invite.notSent", { email }),
    );
    if (result.inviteLink && result.expiresAt) {
      setCreated({
        link: result.inviteLink,
        email,
        expiresAt: result.expiresAt,
        timeZone: result.timeZone,
      });
    }
    // Empty the address, so a second click cannot create (and email) a second
    // invitation for the same person.
    const emailField = formElement.elements.namedItem("email");
    if (emailField instanceof HTMLInputElement) emailField.value = "";
    router.refresh();
  }

  return (
    <>
      <Button onClick={() => { setOpen(true); setNotice(null); setError(null); setCreated(null); }}>
        <Plus className="size-4" aria-hidden />
        {t("admin.invite.button")}
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={t("admin.invite.title")}>
        <form onSubmit={handleSubmit} className="space-y-4">
          {!emailConfigured ? (
            <p className="rounded-(--radius-sm) bg-warning/10 px-3 py-2 text-[13px] text-warning-fg">
              {t("admin.invite.emailNotConfigured")}
            </p>
          ) : null}
          <div>
            <Label htmlFor="invite-email">{t("admin.invite.email")}</Label>
            <Input id="invite-email" name="email" type="email" required autoFocus />
          </div>
          <div>
            <Label htmlFor="invite-role">{t("admin.invite.role")}</Label>
            <Select id="invite-role" name="intendedRole" defaultValue="staff" required>
              <option value="admin">{t("admin.roles.workspaceAdmin")}</option>
              <option value="leadership_viewer">{t("admin.roles.leadership_viewer")}</option>
              <option value="staff">{t("admin.roles.staff")}</option>
              <option value="volunteer">{t("admin.roles.volunteer")}</option>
              <option value="guest">{t("admin.roles.readOnlyGuest")}</option>
            </Select>
            <p className="mt-1 text-[12.5px] text-muted">
              {t("admin.invite.roleHelp")}
            </p>
          </div>
          {error ? <p role="alert" className="text-[13px] text-danger-fg">{error}</p> : null}
          {notice ? <p role="status" className="text-[13px] text-success-fg">{notice}</p> : null}
          {created ? (
            <InvitationLinkField
              link={created.link}
              email={created.email}
              expiresAt={created.expiresAt}
              timeZone={created.timeZone}
            />
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              {t("admin.invite.close")}
            </Button>
            <Button type="submit" loading={saving}>
              {t("admin.invite.submit")}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
