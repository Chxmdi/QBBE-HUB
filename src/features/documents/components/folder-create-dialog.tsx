"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { FolderPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FieldHint, Input, Label, Select } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { createDocumentFolder } from "@/features/documents/services/library.commands";
import { categoryLabel, FOLDER_CATEGORIES } from "@/features/documents/services/library";
import { useT } from "@/lib/i18n/client";

/** Administrators add library folders (#147). */
export function FolderCreateDialog() {
  const router = useRouter();
  const { toast } = useToast();
  const t = useT();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    const form = new FormData(e.currentTarget);
    const result = await createDocumentFolder({
      category: form.get("category"),
      name: form.get("name") || undefined,
      visibility: form.get("visibility"),
    });
    setSaving(false);
    if (!result.ok) {
      setError(result.error ?? t("documents.folder.failed"));
      return;
    }
    toast(t("documents.folder.created"));
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <FolderPlus className="size-4" aria-hidden />
        {t("documents.folder.create")}
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={t("documents.folder.title")}>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="folder-category">{t("documents.folder.category")}</Label>
            <Select id="folder-category" name="category" defaultValue="governance">
              {FOLDER_CATEGORIES.map((c) => (
                <option key={c.id} value={c.id}>
                  {categoryLabel(c.id, t)}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="folder-name">{t("documents.folder.name")}</Label>
            <Input id="folder-name" name="name" required maxLength={80} />
          </div>
          <div>
            <Label htmlFor="folder-visibility">{t("documents.folder.visibility")}</Label>
            <Select id="folder-visibility" name="visibility" defaultValue="organization">
              <option value="organization">{t("documents.folder.allActive")}</option>
              <option value="staff">{t("documents.folder.staffAndAdmins")}</option>
            </Select>
            <FieldHint>{t("documents.folder.hint")}</FieldHint>
          </div>
          {error ? (
            <p role="alert" className="text-[13px] text-danger-fg">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              {t("documents.folder.cancel")}
            </Button>
            <Button type="submit" loading={saving}>
              {t("documents.folder.submit")}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
