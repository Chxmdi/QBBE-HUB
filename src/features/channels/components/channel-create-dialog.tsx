"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FieldHint, Input, Label, Select, Textarea } from "@/components/ui/input";
import { createChannel } from "@/features/channels/services/channel.commands";
import { useT } from "@/lib/i18n/client";

export function ChannelCreateDialog({ defaultOpen = false }: { defaultOpen?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(defaultOpen);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const t = useT();

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
      postingPolicy: form.get("postingPolicy"),
    });
    setSaving(false);
    if (!result.ok) {
      setError(result.error ?? t("channels.errors.somethingWrong"));
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
        {t("channels.create.button")}
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={t("channels.create.title")}>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="channel-name">{t("channels.create.name")}</Label>
            <Input
              id="channel-name"
              name="name"
              required
              maxLength={80}
              placeholder={t("channels.create.namePlaceholder")}
              autoFocus
            />
            <FieldHint>
              {t("channels.create.nameHint")}{" "}
              {/* The prefixes are the slugs channels really use, in either language. */}
              <span lang="en" translate="no">program-, project-, event-, team-.</span>
            </FieldHint>
          </div>
          <div>
            <Label htmlFor="channel-purpose">{t("channels.create.purpose")}</Label>
            <Textarea
              id="channel-purpose"
              name="purpose"
              maxLength={500}
              placeholder={t("channels.create.purposePlaceholder")}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="channel-privacy">{t("channels.create.privacy")}</Label>
              <Select id="channel-privacy" name="privacy" defaultValue="public">
                <option value="public">{t("channels.create.privacyPublic")}</option>
                <option value="private">{t("channels.create.privacyPrivate")}</option>
              </Select>
            </div>
            <div>
              <Label htmlFor="channel-type">{t("channels.create.type")}</Label>
              <Select id="channel-type" name="type" defaultValue="custom">
                <option value="custom">{t("channels.create.types.custom")}</option>
                <option value="program">{t("channels.create.types.program")}</option>
                <option value="project">{t("channels.create.types.project")}</option>
                <option value="event">{t("channels.create.types.event")}</option>
                <option value="operations">{t("channels.create.types.operations")}</option>
                <option value="leadership">{t("channels.create.types.leadership")}</option>
              </Select>
            </div>
          </div>
          <div>
            <Label htmlFor="channel-posting">{t("channels.create.whoCanPost")}</Label>
            <Select id="channel-posting" name="postingPolicy" defaultValue="everyone">
              <option value="everyone">{t("channels.create.posting.everyone")}</option>
              <option value="staff">{t("channels.create.posting.staff")}</option>
              <option value="admins">{t("channels.create.posting.admins")}</option>
            </Select>
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
              {t("channels.create.submit")}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
