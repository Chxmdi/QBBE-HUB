"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { updateProgram } from "@/features/programs/services/program.commands";
import { PROGRAM_COLORS } from "@/features/programs/colors";
import { useT } from "@/lib/i18n/client";

export function ProgramEditDialog({ program, people }: {
  program: {
    id: string; name: string; description: string | null; status: string;
    color?: string; important_links?: { label: string; url: string }[];
    lead_id?: string | null;
  };
  people: { id: string; label: string }[];
}) {
  const router = useRouter();
  const t = useT();
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
        leadId: form.get("leadId"),
      });
      if (!result.ok) { setError(result.error ?? t("programs.edit.error")); return; }
      setOpen(false);
      router.refresh();
    } catch {
      setError(t("programs.edit.errorRetry"));
    } finally { setSaving(false); }
  }
  return <>
    <Button variant="secondary" onClick={() => { setError(null); setOpen(true); }}>{t("programs.edit.open")}</Button>
    <Dialog open={open} onClose={() => { if (!saving) setOpen(false); }} title={t("programs.edit.title")}>
      <form key={`${program.name}:${program.status}:${program.description}:${program.lead_id ?? ""}`} onSubmit={submit} className="space-y-4">
        <div><Label htmlFor="edit-program-name">{t("programs.edit.name")}</Label>
          <Input id="edit-program-name" name="name" defaultValue={program.name} required maxLength={200} /></div>
        <div><Label htmlFor="edit-program-description">{t("programs.edit.description")}</Label>
          <Textarea id="edit-program-description" name="description" defaultValue={program.description ?? ""} maxLength={2000} /></div>
        <div><Label htmlFor="edit-program-status">{t("programs.edit.status")}</Label>
          <Select id="edit-program-status" name="status" defaultValue={program.status}>
            <option value="active">{t("programs.edit.statuses.active")}</option>
            <option value="paused">{t("programs.edit.statuses.paused")}</option>
            <option value="archived">{t("programs.edit.statuses.archived")}</option>
          </Select></div>
        <div><Label htmlFor="edit-program-lead">{t("programs.edit.lead")}</Label>
          <Select id="edit-program-lead" name="leadId" defaultValue={program.lead_id ?? ""}>
            <option value="">{t("programs.edit.noLead")}</option>
            {people.map((person) => (
              <option key={person.id} value={person.id}>{person.label}</option>
            ))}
          </Select>
          <p className="mt-1 text-[12.5px] text-muted">{t("programs.edit.leadHint")}</p></div>
        <div><Label htmlFor="edit-program-color">{t("programs.edit.color")}</Label>
          <Select id="edit-program-color" name="color" defaultValue={program.color ?? "neutral"}>
            {PROGRAM_COLORS.map((value) => (
              <option key={value} value={value}>{t(`programs.edit.colors.${value}`)}</option>
            ))}
          </Select></div>
        <div><Label htmlFor="edit-program-links">{t("programs.edit.links")}</Label>
          <Textarea id="edit-program-links" name="importantLinks" defaultValue={(program.important_links ?? []).map((link) => `${link.label}|${link.url}`).join("\n")} placeholder={t("programs.edit.linksPlaceholder")} /></div>
        <p className="text-sm text-muted">{t("programs.edit.archiveNote")}</p>
        {error ? <p role="alert" className="text-sm text-danger-fg">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" disabled={saving} onClick={() => setOpen(false)}>{t("programs.edit.cancel")}</Button>
          <Button type="submit" loading={saving} disabled={saving}>{t("programs.edit.submit")}</Button>
        </div>
      </form>
    </Dialog>
  </>;
}
