"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { FieldHint, Input, Label } from "@/components/ui/input";
import { updateOwnProfile } from "@/features/people/services/profile.commands";
import { useT } from "@/lib/i18n/client";

/** Settings: correct your own name and title. */
export function ProfileForm({ initial }: { initial: { fullName: string; title: string | null; email: string } }) {
  const t = useT();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <section aria-labelledby="profile-heading" className="mt-8">
      <h2 id="profile-heading" className="section-heading">
        {t("settings.profile.heading")}
      </h2>
      <form
        className="mt-3 grid max-w-xl gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          const form = new FormData(e.currentTarget);
          setError(null);
          setSaved(false);
          startTransition(async () => {
            const result = await updateOwnProfile({ fullName: form.get("fullName"), title: form.get("title") ?? "" });
            if (!result.ok) {
              setError(result.error ?? t("settings.profile.saveFailed"));
              return;
            }
            setSaved(true);
            router.refresh();
          });
        }}
      >
        <div>
          <Label htmlFor="profile-name">{t("settings.profile.name")}</Label>
          <Input id="profile-name" name="fullName" defaultValue={initial.fullName} maxLength={120} required />
        </div>
        <div>
          <Label htmlFor="profile-title">{t("settings.profile.jobTitle")}</Label>
          <Input id="profile-title" name="title" defaultValue={initial.title ?? ""} maxLength={120} />
        </div>
        <div>
          <Label htmlFor="profile-email">{t("settings.profile.email")}</Label>
          <Input id="profile-email" value={initial.email} readOnly aria-describedby="profile-email-help" />
          <FieldHint>
            <span id="profile-email-help">{t("settings.profile.emailHelp")}</span>
          </FieldHint>
        </div>
        {error ? (
          <p role="alert" className="text-[12.5px] text-danger-fg">
            {error}
          </p>
        ) : null}
        {saved ? (
          <p role="status" className="text-[12.5px] text-muted">
            {t("settings.profile.saved")}
          </p>
        ) : null}
        <div>
          <Button type="submit" loading={pending}>
            {t("settings.profile.save")}
          </Button>
        </div>
      </form>
    </section>
  );
}
