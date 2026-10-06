"use client";

import { useActionState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { useSpacesT } from "../i18n/client";
import { createCustomSpace, type SpaceActionState } from "../services/spaces.commands";

const initial: SpaceActionState = { ok: false, message: null };

/** Administrators create custom spaces, named in both languages. */
export function CreateSpaceForm() {
  const t = useSpacesT();
  const [state, action, pending] = useActionState(createCustomSpace, initial);
  const form = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.ok) form.current?.reset();
  }, [state]);

  return (
    <section aria-labelledby="create-space" className="card mb-8 max-w-xl p-4">
      <h2 id="create-space" className="text-[15px] font-semibold text-ink">
        {t("create.heading")}
      </h2>
      <p className="mt-1 text-[13px] text-muted">{t("create.help")}</p>
      <form ref={form} action={action} className="mt-3 grid gap-3">
        <div className="grid gap-1">
          <label htmlFor="space-name-en" className="text-[13px] font-medium text-ink">
            {t("create.nameEn")}
          </label>
          <Input id="space-name-en" name="nameEn" required maxLength={120} autoComplete="off" />
        </div>
        <div className="grid gap-1">
          <label htmlFor="space-name-fr" className="text-[13px] font-medium text-ink">
            {t("create.nameFr")}
          </label>
          <Input id="space-name-fr" name="nameFr" lang="fr-CA" required maxLength={120} autoComplete="off" />
        </div>
        <div className="grid gap-1">
          <label htmlFor="space-description" className="text-[13px] font-medium text-ink">
            {t("create.descriptionLabel")}
          </label>
          <Textarea id="space-description" name="description" maxLength={2000} />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" loading={pending}>
            {pending ? t("create.submitting") : t("create.submit")}
          </Button>
          <p
            role={state.ok ? "status" : "alert"}
            aria-live={state.ok ? "polite" : "assertive"}
            className={state.ok ? "text-[13px] text-success-fg" : "text-[13px] text-danger-fg"}
          >
            {state.message ?? ""}
          </p>
        </div>
      </form>
    </section>
  );
}
