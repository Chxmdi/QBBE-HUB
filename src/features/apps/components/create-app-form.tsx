"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { fill, type AppsMessages } from "../i18n";
import { createApp } from "../services/app.commands";

/** Name and web address, then straight into the app's settings. */
export function CreateAppForm({ messages }: { messages: AppsMessages }) {
  const router = useRouter();
  const [nameEn, setNameEn] = React.useState("");
  const [nameFr, setNameFr] = React.useState("");
  const [slug, setSlug] = React.useState("");
  const [error, setError] = React.useState("");
  const [pending, startTransition] = React.useTransition();

  return (
    <form
      aria-labelledby="create-app-heading"
      className="rounded-(--radius-md) border border-line bg-surface p-4"
      onSubmit={(event) => {
        event.preventDefault();
        startTransition(async () => {
          const result = await createApp({ nameEn, nameFr, slug });
          if (result.ok) router.push(`/apps/manage/${result.value.id}`);
          else setError(result.error);
        });
      }}
    >
      <h2 id="create-app-heading" className="mb-3 text-[15px] font-semibold text-ink">{messages.create.heading}</h2>
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <Label htmlFor="app-name-en">{messages.create.nameEn}</Label>
          <Input id="app-name-en" required value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="app-name-fr">{messages.create.nameFr}</Label>
          <Input id="app-name-fr" lang="fr-CA" required value={nameFr} onChange={(e) => setNameFr(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="app-slug">{messages.create.slug}</Label>
          <Input
            id="app-slug"
            required
            spellCheck={false}
            aria-describedby="app-slug-hint"
            value={slug}
            onChange={(e) => setSlug(e.target.value.toLowerCase())}
          />
          <p id="app-slug-hint" className="mt-1 text-[12.5px] text-muted">
            {fill(messages.create.slugHint, { slug: slug || "…" })}
          </p>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <Button type="submit" loading={pending}>{messages.create.submit}</Button>
        <p role="status" className="text-[13px] text-danger-fg">{error}</p>
      </div>
    </form>
  );
}
