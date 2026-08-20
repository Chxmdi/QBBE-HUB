"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Label, Select } from "@/components/ui/input";
import { addChannelMember } from "@/features/channels/services/channel.commands";

export function AddChannelMemberDialog({
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

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    const result = await addChannelMember(channelId, form.get("userId") as string);
    setSaving(false);
    if (!result.ok) {
      setError(result.error ?? "Could not add member.");
      return;
    }
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <UserPlus className="size-4" aria-hidden />
        Add member
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Add channel member">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="add-member">Person</Label>
            <Select id="add-member" name="userId" required>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </Select>
          </div>
          {error ? (
            <p role="alert" className="text-[13px] text-danger-fg">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={saving}>
              Add
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
