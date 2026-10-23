"use client";

import { useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input, Label, Select } from "@/components/ui/input";
import { usePagesT } from "@/features/pages/i18n/client";
import { createPage } from "@/features/pages/services/page.commands";

/** An explicit create action; visiting the URL never creates a record. */
export function PageCreateDialog({ canCreatePrivate, canCreateWorkspace }: {
  canCreatePrivate: boolean;
  canCreateWorkspace: boolean;
}) {
  const t = usePagesT();
  const router = useRouter();
  const params = useSearchParams();
  const [manualOpen, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitting = useRef(false);
  if (!canCreatePrivate && !canCreateWorkspace) return null;

  function close() {
    setOpen(false);
    const url = new URL(window.location.href);
    if (url.searchParams.get("create") === "1") {
      url.searchParams.delete("create");
      window.history.replaceState(null, "", url.pathname + url.search + url.hash);
    }
  }

  return <>
    <Button onClick={() => setOpen(true)}>{t("sidebar.newPage")}</Button>
    <Dialog open={manualOpen || params.get("create") === "1"} onClose={() => { if (!submitting.current) close(); }} title={t("sidebar.newPage")}>
      <form className="space-y-4" onSubmit={async (event) => {
        event.preventDefault();
        if (submitting.current) return;
        submitting.current = true;
        setSaving(true);
        setError(null);
        const form = new FormData(event.currentTarget);
        try {
          const result = await createPage({ title: form.get("title"), visibility: form.get("visibility") });
          if (!result.ok || !result.id) { setError(result.error ?? t("errors.failed")); return; }
          close();
          router.push(`/pages/${result.id}`);
          router.refresh();
        } catch {
          setError(t("errors.failed"));
        } finally {
          submitting.current = false;
          setSaving(false);
        }
      }}>
        <div>
          <Label htmlFor="new-page-title">{t("page.titleLabel")}</Label>
          <Input id="new-page-title" name="title" maxLength={500} autoFocus placeholder={t("page.titlePlaceholder")} />
        </div>
        <div>
          <Label htmlFor="new-page-visibility">{t("create.visibility")}</Label>
          <Select id="new-page-visibility" name="visibility" defaultValue={canCreatePrivate ? "private" : "workspace"}>
            {canCreatePrivate ? <option value="private">{t("sidebar.private")}</option> : null}
            {canCreateWorkspace ? <option value="workspace">{t("sidebar.workspace")}</option> : null}
          </Select>
        </div>
        {error ? <p role="alert" className="text-danger-fg">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" disabled={saving} onClick={close}>{t("dialogs.cancel")}</Button>
          <Button type="submit" loading={saving}>{t("sidebar.newPage")}</Button>
        </div>
      </form>
    </Dialog>
  </>;
}
