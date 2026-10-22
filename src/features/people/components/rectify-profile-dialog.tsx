"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FieldHint, Input, Label } from "@/components/ui/input";
import { rectifyMemberProfile } from "@/features/people/services/profile.commands";
import { useT } from "@/lib/i18n/client";

/** Administrators: correct a member's name and title, recorded in the audit trail. */
export function RectifyProfileDialog({ person }: { person: { id: string; fullName: string; title: string | null } }) {
  const t = useT();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <>
      <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
        {t("people.rectify.button")}
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={t("people.rectify.title", { name: person.fullName })}>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            setError(null);
            startTransition(async () => {
              const result = await rectifyMemberProfile({
                userId: person.id,
                fullName: form.get("fullName"),
                title: form.get("title") ?? "",
              });
              if (!result.ok) {
                setError(result.error ?? t("people.rectify.failed"));
                return;
              }
              setOpen(false);
              router.refresh();
            });
          }}
        >
          <p className="text-[13.5px] text-muted">{t("people.rectify.explanation")}</p>
          <div>
            <Label htmlFor="rectify-name">{t("settings.profile.name")}</Label>
            <Input id="rectify-name" name="fullName" defaultValue={person.fullName} maxLength={120} required />
          </div>
          <div>
            <Label htmlFor="rectify-title">{t("settings.profile.jobTitle")}</Label>
            <Input
              id="rectify-title"
              name="title"
              defaultValue={person.title ?? ""}
              maxLength={120}
              aria-describedby="rectify-audited"
            />
            <FieldHint>
              <span id="rectify-audited">{t("people.rectify.audited")}</span>
            </FieldHint>
          </div>
          {error ? (
            <p role="alert" className="text-[12.5px] text-danger-fg">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              {t("people.rectify.cancel")}
            </Button>
            <Button type="submit" loading={pending}>
              {t("people.rectify.save")}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
