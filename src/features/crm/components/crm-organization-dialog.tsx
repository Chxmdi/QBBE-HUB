"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState } from "react";
import { AlertTriangle, Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import {
  createCrmOrganization,
  findDuplicateOrganizations,
  updateCrmOrganization,
  type DuplicateMatch,
} from "@/features/crm/services/crm.commands";

const CATEGORIES = [
  "funder", "sponsor", "school", "university", "community",
  "government", "vendor", "media", "donor", "association",
];

export function CrmOrganizationDialog({
  defaultOpen = false,
  organization,
}: {
  defaultOpen?: boolean;
  organization?: {
    id: string;
    name: string;
    category: string;
    website: string | null;
    notes: string | null;
    next_action_at: string | null;
    sensitive_notes?: string | null;
  };
}) {
  const router = useRouter();
  const { toast } = useToast();
  const editing = Boolean(organization);
  const [open, setOpen] = useState(defaultOpen);
  const [duplicates, setDuplicates] = useState<DuplicateMatch[]>([]);
  const [acknowledged, setAcknowledged] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function checkDuplicates(name: string, website: string) {
    if (editing || name.trim().length < 3) {
      setDuplicates([]);
      return;
    }
    const matches = await findDuplicateOrganizations(name, website || undefined);
    setDuplicates(matches);
    setAcknowledged(false);
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = new FormData(e.currentTarget);

    if (!editing && duplicates.length > 0 && !acknowledged) {
      setError("Review the possible duplicates above, then confirm to continue.");
      return;
    }

    setSaving(true);
    const payload = {
      name: form.get("name"),
      category: form.get("category"),
      website: (form.get("website") as string) || undefined,
      notes: (form.get("notes") as string) || undefined,
      nextActionAt: (form.get("nextActionAt") as string) || undefined,
      sensitiveNotes: (form.get("sensitiveNotes") as string) || undefined,
    };
    const result = editing && organization
      ? await updateCrmOrganization({ id: organization.id, ...payload })
      : await createCrmOrganization(payload);
    setSaving(false);
    if (!result.ok) {
      setError(result.error ?? "Could not save the organization.");
      return;
    }
    toast(editing ? "Organization updated." : "Organization added.");
    setOpen(false);
    setDuplicates([]);
    router.refresh();
  }

  return (
    <>
      <Button variant={editing ? "secondary" : "primary"} onClick={() => setOpen(true)}>
        {editing ? <Pencil className="size-4" aria-hidden /> : <Plus className="size-4" aria-hidden />}
        {editing ? "Edit organization" : "New organization"}
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? "Edit organization" : "Add organization"}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="crm-name">Name</Label>
            <Input
              id="crm-name"
              name="name"
              required
              maxLength={200}
              autoFocus
              defaultValue={organization?.name}
              onBlur={(e) =>
                checkDuplicates(
                  e.target.value,
                  (document.getElementById("crm-website") as HTMLInputElement)
                    ?.value ?? "",
                )
              }
            />
          </div>

          {duplicates.length > 0 ? (
            <div className="rounded-(--radius-sm) border border-warning/30 bg-warning/10 p-3">
              <p className="flex items-center gap-1.5 text-[13.5px] font-medium text-warning-fg">
                <AlertTriangle className="size-4" aria-hidden />
                {duplicates.length === 1
                  ? "A similar organization already exists"
                  : "Similar organizations already exist"}
              </p>
              <ul className="mt-1.5 space-y-1 text-[13px]">
                {duplicates.map((duplicate) => (
                  <li key={duplicate.id}>
                    <Link
                      href={`/crm/${duplicate.id}`}
                      className="font-medium text-brand-fg hover:underline"
                    >
                      {duplicate.name}
                    </Link>
                    <span className="text-muted"> · {duplicate.category}</span>
                  </li>
                ))}
              </ul>
              <label className="mt-2 flex items-start gap-2 text-[13px]">
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(e) => setAcknowledged(e.target.checked)}
                  className="mt-0.5 size-4 accent-(--color-brand)"
                />
                This is a different organization — create it anyway.
              </label>
            </div>
          ) : null}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="crm-category">Category</Label>
              <Select
                id="crm-category"
                name="category"
                defaultValue={organization?.category ?? "community"}
                required
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="crm-website">
                Website <span className="font-normal text-muted">(optional)</span>
              </Label>
              <Input
                id="crm-website"
                name="website"
                type="url"
                defaultValue={organization?.website ?? ""}
                onBlur={(e) =>
                  checkDuplicates(
                    (document.getElementById("crm-name") as HTMLInputElement)
                      ?.value ?? "",
                    e.target.value,
                  )
                }
              />
            </div>
          </div>

          <div>
            <Label htmlFor="crm-notes">
              Notes <span className="font-normal text-muted">(optional)</span>
            </Label>
            <Textarea
              id="crm-notes"
              name="notes"
              maxLength={5000}
              rows={2}
              defaultValue={organization?.notes ?? ""}
            />
          </div>
          <div>
            <Label htmlFor="crm-next-action">Next action</Label>
            <Input
              id="crm-next-action"
              name="nextActionAt"
              type="date"
              required
              defaultValue={organization?.next_action_at ?? ""}
            />
          </div>
          <div>
            <Label htmlFor="crm-sensitive">
              Sensitive notes <span className="font-normal text-muted">(owner and admins only)</span>
            </Label>
            <Textarea
              id="crm-sensitive"
              name="sensitiveNotes"
              maxLength={5000}
              rows={2}
              defaultValue={organization?.sensitive_notes ?? ""}
            />
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
              {editing ? "Save organization" : "Add organization"}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
