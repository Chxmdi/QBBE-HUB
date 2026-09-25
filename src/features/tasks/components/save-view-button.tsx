"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { saveView } from "@/features/admin/services/workflow.commands";
import { Button } from "@/components/ui/button";
import { Checkbox, Input } from "@/components/ui/input";

export function SaveViewButton({ path = "/my-work" }: { path?: string }) {
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
      setError(result.error ?? "Could not save.");
      return;
    }
    setOpen(false);
    router.refresh();
  }

  if (!open) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Save view
      </Button>
    );
  }

  return (
    <form onSubmit={handleSave} className="flex items-center gap-2">
      <Input name="name" required placeholder="View name" className="h-9 w-40" />
      {path === "/projects" ? (
        <label className="flex items-center gap-1.5 text-[12.5px] text-muted">
          <Checkbox name="shared" />
          Share with the organization
        </label>
      ) : null}
      <Button type="submit">Save</Button>
      <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
        Cancel
      </Button>
      {error ? <span className="text-[12px] text-danger-fg">{error}</span> : null}
    </form>
  );
}
