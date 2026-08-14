"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Megaphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FieldHint, Input, Label, Select, Textarea } from "@/components/ui/input";
import { publishAnnouncement } from "@/features/announcements/services/announcement.commands";

/** Admin-only announcement composer for the mandatory channel (P0-ANN-02). */
export function AnnouncementComposeDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [requiresAck, setRequiresAck] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    const form = new FormData(e.currentTarget);
    const result = await publishAnnouncement({
      title: form.get("title"),
      body: form.get("body"),
      priority: form.get("priority"),
      requiresAck,
      ackDeadline: (form.get("ackDeadline") as string) || undefined,
    });
    setSaving(false);
    if (!result.ok) {
      setError(result.error ?? "Something went wrong.");
      return;
    }
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <Megaphone className="size-4" aria-hidden />
        New announcement
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Publish announcement"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="ann-title">Title</Label>
            <Input id="ann-title" name="title" required maxLength={200} autoFocus />
          </div>
          <div>
            <Label htmlFor="ann-body">Announcement</Label>
            <Textarea id="ann-body" name="body" required maxLength={10000} rows={5} />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="ann-priority">Priority</Label>
              <Select id="ann-priority" name="priority" defaultValue="normal">
                <option value="normal">Normal</option>
                <option value="important">Important</option>
                <option value="critical">Critical</option>
              </Select>
            </div>
            <div className="flex items-end pb-1">
              <label className="flex items-center gap-2 text-[13.5px]">
                <input
                  type="checkbox"
                  checked={requiresAck}
                  onChange={(e) => setRequiresAck(e.target.checked)}
                  className="size-4 accent-(--color-brand)"
                />
                Require acknowledgment
              </label>
            </div>
            {requiresAck ? (
              <div className="sm:col-span-2">
                <Label htmlFor="ann-deadline">Acknowledgment deadline</Label>
                <Input id="ann-deadline" name="ackDeadline" type="datetime-local" />
                <FieldHint>
                  Recipients see the announcement on Home until they acknowledge.
                </FieldHint>
              </div>
            ) : null}
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
              Publish
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
