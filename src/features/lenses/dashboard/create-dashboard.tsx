"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Checkbox, Input, Label } from "@/components/ui/input";
import { useLensT } from "@/features/lenses/i18n/client";
import { createDashboard } from "./actions";

/** Name a new dashboard, personal or shared, and open it. */
export function CreateDashboard() {
  const t = useLensT();
  const router = useRouter();
  const [name, setName] = React.useState("");
  const [shared, setShared] = React.useState(false);
  const [message, setMessage] = React.useState("");
  const [pending, startTransition] = React.useTransition();
  return (
    <form
      className="card mb-6 flex flex-wrap items-end gap-3 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          const result = await createDashboard({ name, shared });
          if (result.ok && result.id) router.push(`/lenses/dashboard?lens=${result.id}`);
          else setMessage(result.error ?? t("dashboard.saveFailed"));
        });
      }}
    >
      <div className="min-w-60 flex-1">
        <Label htmlFor="new-dashboard">{t("dashboard.createName")}</Label>
        <Input id="new-dashboard" value={name} required maxLength={120} onChange={(e) => setName(e.target.value)} />
      </div>
      <label className="flex h-9.5 items-center gap-2 text-[13.5px] text-ink">
        <Checkbox checked={shared} onChange={(e) => setShared(e.target.checked)} />
        {t("dashboard.createShared")}
      </label>
      <Button type="submit" loading={pending} disabled={!name.trim()}>
        {t("dashboard.create")}
      </Button>
      <p role="status" aria-live="polite" className="w-full text-[12.5px] text-danger-fg empty:hidden">
        {message}
      </p>
    </form>
  );
}
