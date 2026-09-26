"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { FolderPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FieldHint, Input, Label, Select } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { createDocumentFolder } from "@/features/documents/services/library.commands";
import { FOLDER_CATEGORIES } from "@/features/documents/services/library";

/** Administrators add library folders (#147). */
export function FolderCreateDialog() {
  const router = useRouter();
  const { toast } = useToast();
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
      setError(result.error ?? "Could not create the folder.");
      return;
    }
    toast("Folder created.");
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <FolderPlus className="size-4" aria-hidden />
        New folder
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="New folder">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="folder-category">Category</Label>
            <Select id="folder-category" name="category" defaultValue="governance">
              {FOLDER_CATEGORIES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="folder-name">Name</Label>
            <Input id="folder-name" name="name" required maxLength={80} />
          </div>
          <div>
            <Label htmlFor="folder-visibility">Who can open what is filed here</Label>
            <Select id="folder-visibility" name="visibility" defaultValue="organization">
              <option value="organization">All active members</option>
              <option value="staff">Staff and admins only</option>
            </Select>
            <FieldHint>
              A staff-only folder hides everything filed in it, and every earlier
              version, from volunteers and guests.
            </FieldHint>
          </div>
          {error ? (
            <p role="alert" className="text-[13px] text-danger-fg">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={saving}>
              Create folder
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
