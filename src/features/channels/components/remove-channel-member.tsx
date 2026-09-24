"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { UserMinus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Label, Select } from "@/components/ui/input";
import { removeChannelMember } from "@/features/channels/services/channel.commands";

export function RemoveChannelMemberDialog({
  channelId,
  people,
}: {
  channelId: string;
  people: { id: string; label: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  if (people.length === 0) return null;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const userId = form.get("userId") as string;
    const label = people.find((person) => person.id === userId)?.label ?? "this member";
    if (!window.confirm(`Revoke direct channel access for ${label}? Historical messages are preserved. Independent team or assignment access is not removed.`)) return;

    setSaving(true);
    setError(null);
    const result = await removeChannelMember(channelId, userId);
    setSaving(false);
    if (!result.ok) {
      setError(result.error ?? "Could not revoke access.");
      return;
    }
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <UserMinus className="size-4" aria-hidden />
        Remove member
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Remove channel member">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="remove-channel-member">Direct member</Label>
            <Select id="remove-channel-member" name="userId" required>
              {people.map((person) => (
                <option key={person.id} value={person.id}>{person.label}</option>
              ))}
            </Select>
            <p className="meta mt-1.5">
              Only direct access is revoked here. Team and assignment access must be removed at its source.
            </p>
          </div>
          {error ? <p role="alert" className="text-[13px] text-danger-fg">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" loading={saving}>Revoke direct access</Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
