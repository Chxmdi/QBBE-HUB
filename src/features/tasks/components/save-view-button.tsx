"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { saveView } from "@/features/admin/services/workflow.commands";
import { Button } from "@/components/ui/button";
import { Checkbox, Input } from "@/components/ui/input";
import { useT } from "@/lib/i18n/client";

export function SaveViewButton({ path = "/my-work" }: { path?: string }) {
  const t = useT();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const name = form.get("name") as string;
    const shared = form.get("shared") === "on";
    const query: Record<string, string> = {};
    searchParams.forEach((value, key) => {
      if (key !== "task" && key !== "view") query[key] = value;
    });
    const result = await saveView({ name, path, query, shared });
    if (!result.ok) {
      setError(result.error ?? t("tasks.savedViews.saveFailed"));
      return;
    }
    setOpen(false);
    router.refresh();
  }

  if (!open) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)}>
        {t("tasks.savedViews.open")}
      </Button>
    );
  }

  return (
    <form onSubmit={handleSave} className="flex items-center gap-2">
      <Input name="name" required placeholder={t("tasks.savedViews.name")} className="h-9 w-40" />
      {path === "/projects" ? (
        <label className="flex items-center gap-1.5 text-[12.5px] text-muted">
          <Checkbox name="shared" />
          {t("tasks.savedViews.share")}
        </label>
      ) : null}
      <Button type="submit">{t("tasks.savedViews.save")}</Button>
      <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
        {t("common.cancel")}
      </Button>
      {error ? <span className="text-[12px] text-danger-fg">{error}</span> : null}
    </form>
  );
}
