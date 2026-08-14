"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FieldHint, Input, Label, Select, Textarea } from "@/components/ui/input";
import { createChannel } from "@/features/channels/services/channel.commands";

export function ChannelCreateDialog({ defaultOpen = false }: { defaultOpen?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(defaultOpen);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    const form = new FormData(e.currentTarget);
    const result = await createChannel({
      name: form.get("name"),
      purpose: (form.get("purpose") as string) || undefined,
      privacy: form.get("privacy"),
      type: form.get("type"),
    });
    setSaving(false);
    if (!result.ok) {
      setError(result.error ?? "Something went wrong.");
      return;
    }
    setOpen(false);
    if (result.id) router.push(`/channels/${result.id}`);
    router.refresh();
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus className="size-4" aria-hidden />
        New channel
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Create channel">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="channel-name">Name</Label>
            <Input
              id="channel-name"
              name="name"
              required
              maxLength={80}
              placeholder="e.g. program-family-first"
              autoFocus
            />
            <FieldHint>
              Use predictable prefixes: program-, project-, event-, team-.
            </FieldHint>
          </div>
          <div>
            <Label htmlFor="channel-purpose">Purpose</Label>
            <Textarea
              id="channel-purpose"
              name="purpose"
              maxLength={500}
              placeholder="What is this channel for?"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="channel-privacy">Privacy</Label>
              <Select id="channel-privacy" name="privacy" defaultValue="public">
                <option value="public">Public — discoverable by members</option>
                <option value="private">Private — members only</option>
              </Select>
            </div>
            <div>
              <Label htmlFor="channel-type">Type</Label>
              <Select id="channel-type" name="type" defaultValue="custom">
                <option value="custom">General</option>
                <option value="team">Team</option>
                <option value="program">Program</option>
                <option value="project">Project</option>
                <option value="event">Event</option>
                <option value="operations">Operations</option>
                <option value="leadership">Leadership</option>
              </Select>
            </div>
          </div>
          {error ? (
            <p role="alert" className="text-[13px] text-danger-fg">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={saving}>
              Create channel
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
