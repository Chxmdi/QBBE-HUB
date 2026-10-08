"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSpacesT } from "@/features/spaces/i18n/client";

/**
 * The audit log export form (V2-9). The file is fetched and saved from the
 * page rather than by navigating to the export address: a refused range
 * stays on this page as a message instead of replacing it with plain text,
 * and the download starts the same way in every browser (a navigation that
 * answers with an attachment never reached WebKit's downloads in testing).
 */
export function AuditExportForm({ from, to }: { from: string; to: string }) {
  const t = useSpacesT();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState("");

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const data = new FormData(form);
    const query = new URLSearchParams({ from: String(data.get("from") ?? ""), to: String(data.get("to") ?? "") });
    setBusy(true);
    setError(null);
    setDone("");
    try {
      const response = await fetch(`/spaces/admin/audit-export?${query}`, { credentials: "same-origin" });
      if (!response.ok) {
        setError(t("admin.audit.failed"));
        return;
      }
      const disposition = response.headers.get("Content-Disposition") ?? "";
      const fileName = /filename="([^"]+)"/.exec(disposition)?.[1] ?? "audit-log.csv";
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setDone(t("admin.audit.downloaded"));
    } catch {
      setError(t("admin.audit.failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-2">
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid gap-1">
          <label htmlFor="audit-from" className="text-[13px] font-medium text-ink">
            {t("admin.audit.from")}
          </label>
          <Input id="audit-from" name="from" type="date" required defaultValue={from} />
        </div>
        <div className="grid gap-1">
          <label htmlFor="audit-to" className="text-[13px] font-medium text-ink">
            {t("admin.audit.to")}
          </label>
          <Input id="audit-to" name="to" type="date" required defaultValue={to} />
        </div>
        <Button type="submit" variant="secondary" loading={busy} disabled={busy}>
          {t("admin.audit.download")}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-[13px] text-danger-fg">
          {error}
        </p>
      ) : null}
      <p role="status" aria-live="polite" className="sr-only">
        {done}
      </p>
    </form>
  );
}
