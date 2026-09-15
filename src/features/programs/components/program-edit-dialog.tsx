"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { updateProgram } from "@/features/programs/services/program.commands";

export function ProgramEditDialog({ program }: { program: {
  id: string; name: string; description: string | null; status: string;
  color?: string; important_links?: { label: string; url: string }[];
} }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true);
    setError(null);
    try {
      const result = await updateProgram({
        id: program.id,
        name: form.get("name"),
        description: form.get("description"),
        status: form.get("status"),
        color: form.get("color"),
        importantLinks: form.get("importantLinks"),
      });
      if (!result.ok) { setError(result.error ?? "Could not save the program."); return; }
      setOpen(false);
      router.refresh();
    } catch {
      setError("Could not save the program. Please try again.");
    } finally { setSaving(false); }
  }
  return <>
    <Button variant="secondary" onClick={() => { setError(null); setOpen(true); }}>Edit program</Button>
    <Dialog open={open} onClose={() => { if (!saving) setOpen(false); }} title="Edit program">
      <form key={`${program.name}:${program.status}:${program.description}`} onSubmit={submit} className="space-y-4">
        <div><Label htmlFor="edit-program-name">Name</Label>
          <Input id="edit-program-name" name="name" defaultValue={program.name} required maxLength={200} /></div>
        <div><Label htmlFor="edit-program-description">Description</Label>
          <Textarea id="edit-program-description" name="description" defaultValue={program.description ?? ""} maxLength={2000} /></div>
        <div><Label htmlFor="edit-program-status">Status</Label>
          <Select id="edit-program-status" name="status" defaultValue={program.status}>
            <option value="active">Active</option><option value="paused">Paused</option><option value="archived">Archived</option>
          </Select></div>
        <div><Label htmlFor="edit-program-color">Colour</Label>
          <Select id="edit-program-color" name="color" defaultValue={program.color ?? "neutral"}>
            <option value="neutral">Neutral</option>
            <option value="blue">Blue</option>
            <option value="green">Green</option>
            <option value="amber">Amber</option>
            <option value="rose">Rose</option>
          </Select></div>
        <div><Label htmlFor="edit-program-links">Important links</Label>
          <Textarea id="edit-program-links" name="importantLinks" defaultValue={(program.important_links ?? []).map((link) => `${link.label}|${link.url}`).join("\n")} placeholder="Label|https://example.org" /></div>
        <p className="text-sm text-muted">Archived programs remain available in the archive. Choose Active or Paused to restore a program. Its projects keep their own status.</p>
        {error ? <p role="alert" className="text-sm text-danger-fg">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" disabled={saving} onClick={() => setOpen(false)}>Cancel</Button>
          <Button type="submit" loading={saving} disabled={saving}>Save program</Button>
        </div>
      </form>
    </Dialog>
  </>;
}
