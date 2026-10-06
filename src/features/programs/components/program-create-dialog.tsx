"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import type { Option } from "@/features/tasks/components/task-create-dialog";
import { createProgram } from "@/features/projects/services/project.commands";
import { useT } from "@/lib/i18n/client";

export function ProgramCreateDialog({
  people,
  defaultOpen = false,
}: {
  people: Option[];
  defaultOpen?: boolean;
}) {
  const router = useRouter();
  const t = useT();
  const [open, setOpen] = useState(defaultOpen);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    const form = new FormData(e.currentTarget);
    const result = await createProgram({
      name: form.get("name"),
      description: (form.get("description") as string) || undefined,
      leadId: (form.get("leadId") as string) || undefined,
    });
    setSaving(false);
    if (!result.ok) {
      setError(result.error ?? t("programs.create.error"));
      return;
    }
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus className="size-4" aria-hidden />
        {t("programs.create.open")}
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={t("programs.create.title")}>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="program-name">{t("programs.create.name")}</Label>
            <Input id="program-name" name="name" required maxLength={200} autoFocus />
          </div>
          <div>
            <Label htmlFor="program-description">{t("programs.create.description")}</Label>
            <Textarea id="program-description" name="description" maxLength={2000} />
          </div>
          <div>
            <Label htmlFor="program-lead">{t("programs.create.lead")}</Label>
            <Select id="program-lead" name="leadId" defaultValue="">
              <option value="">{t("programs.create.me")}</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </Select>
          </div>
          {error ? (
            <p role="alert" className="text-[13px] text-danger-fg">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              {t("programs.create.cancel")}
            </Button>
            <Button type="submit" loading={saving}>
              {t("programs.create.submit")}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
