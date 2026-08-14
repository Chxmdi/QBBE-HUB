"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { inviteUser } from "@/features/admin/services/admin.commands";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input, Label, Select } from "@/components/ui/input";
import { Plus } from "lucide-react";

export function InviteUserDialog({ emailConfigured }: { emailConfigured: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setSaving(true);
    const form = new FormData(e.currentTarget);
    const result = await inviteUser({
      email: form.get("email"),
      intendedRole: form.get("intendedRole"),
    });
    setSaving(false);
    if (!result.ok) {
      setError(result.error ?? "Could not create the invitation.");
      return;
    }
    setNotice(
      result.emailSent
        ? "Invitation recorded and queued for email."
        : "Invite recorded — email not sent",
    );
    router.refresh();
  }

  return (
    <>
      <Button onClick={() => { setOpen(true); setNotice(null); setError(null); }}>
        <Plus className="size-4" aria-hidden />
        Invite user
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Invite a user">
        <form onSubmit={handleSubmit} className="space-y-4">
          {!emailConfigured ? (
            <p className="rounded-(--radius-sm) bg-warning/10 px-3 py-2 text-[13px] text-warning-fg">
              Transactional email is not configured. The invitation row will be
              saved; the recipient will not receive an email until
              EMAIL_PROVIDER_API_KEY is set.
            </p>
          ) : null}
          <div>
            <Label htmlFor="invite-email">Email</Label>
            <Input id="invite-email" name="email" type="email" required autoFocus />
          </div>
          <div>
            <Label htmlFor="invite-role">Role</Label>
            <Select id="invite-role" name="intendedRole" defaultValue="staff" required>
              <option value="admin">Workspace Admin</option>
              <option value="staff">Staff</option>
              <option value="volunteer">Volunteer</option>
              <option value="guest">Read-only guest</option>
            </Select>
            <p className="mt-1 text-[12.5px] text-muted">
              When this person signs up with the invited email, the role is applied automatically.
            </p>
          </div>
          {error ? <p role="alert" className="text-[13px] text-danger-fg">{error}</p> : null}
          {notice ? <p role="status" className="text-[13px] text-success-fg">{notice}</p> : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Close
            </Button>
            <Button type="submit" loading={saving}>
              Create invitation
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
