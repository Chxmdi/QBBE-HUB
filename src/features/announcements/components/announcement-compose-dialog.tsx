"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Megaphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FieldHint, Input, Label, Select, Textarea, Checkbox } from "@/components/ui/input";
import { publishAnnouncement } from "@/features/announcements/services/announcement.commands";
import { useT } from "@/lib/i18n/client";

/** Admin-only announcement composer for the mandatory channel (P0-ANN-02). */
export function AnnouncementComposeDialog({ defaultOpen = false }: { defaultOpen?: boolean }) {
  const router = useRouter();
  const t = useT();
  const [open, setOpen] = useState(defaultOpen);
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
      publishAt: (form.get("publishAt") as string) || undefined,
    });
    setSaving(false);
    if (!result.ok) {
      setError(result.error ?? t("announcements.errors.somethingWrong"));
      return;
    }
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <Megaphone className="size-4" aria-hidden />
        {t("announcements.compose.button")}
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={t("announcements.compose.title")}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="ann-title">{t("announcements.compose.titleLabel")}</Label>
            <Input id="ann-title" name="title" required maxLength={200} autoFocus />
          </div>
          <div>
            <Label htmlFor="ann-body">{t("announcements.compose.body")}</Label>
            <Textarea id="ann-body" name="body" required maxLength={10000} rows={5} />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="ann-priority">{t("announcements.compose.priority")}</Label>
              <Select id="ann-priority" name="priority" defaultValue="normal">
                <option value="normal">{t("announcements.compose.priorities.normal")}</option>
                <option value="important">{t("announcements.compose.priorities.important")}</option>
                <option value="critical">{t("announcements.compose.priorities.critical")}</option>
              </Select>
            </div>
            <div className="flex items-end pb-1">
              <label className="flex items-center gap-2 text-[13.5px]">
                <Checkbox
                  checked={requiresAck}
                  onChange={(e) => setRequiresAck(e.target.checked)}
                />
                {t("announcements.compose.requireAck")}
              </label>
            </div>
            {requiresAck ? (
              <div className="sm:col-span-2">
                <Label htmlFor="ann-deadline">{t("announcements.compose.deadline")}</Label>
                <Input id="ann-deadline" name="ackDeadline" type="datetime-local" />
                <FieldHint>
                  {t("announcements.compose.deadlineHint")}
                </FieldHint>
              </div>
            ) : null}
            <div className="sm:col-span-2">
              <Label htmlFor="ann-publish">{t("announcements.compose.publishAt")}</Label>
              <Input id="ann-publish" name="publishAt" type="datetime-local" />
              <FieldHint>
                {t("announcements.compose.publishHint")}
              </FieldHint>
            </div>
          </div>
          {error ? (
            <p role="alert" className="text-[13px] text-danger-fg">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" loading={saving}>
              {t("announcements.compose.submit")}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
