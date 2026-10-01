"use client";

import * as React from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { LensSpec } from "@/lib/query/spec";
import { useLensT } from "@/features/lenses/i18n/client";

/** Where the table lens keeps the viewer's column layout (table-lens.tsx). */
const LAYOUT_PREFIX = "qbbe-lens-table:";

/** The visible columns, in order, from the table's saved layout; null when there is none. */
export function storedFields(typeKey: string): string[] | null {
  try {
    const raw = window.localStorage.getItem(LAYOUT_PREFIX + typeKey);
    const columns = raw ? (JSON.parse(raw) as { key?: unknown; hidden?: unknown }[]) : null;
    if (!Array.isArray(columns)) return null;
    const keys = columns
      .filter((c) => c && typeof c.key === "string" && c.hidden !== true)
      .map((c) => c.key as string)
      .filter((k) => /^[a-z][a-z0-9_]{0,62}$/.test(k) && k !== "title");
    return keys.length > 0 ? keys.slice(0, 30) : null;
  } catch {
    return null;
  }
}

/**
 * Downloads the lens as CSV (Workspace OS U15) through the export route,
 * which runs the spec again under the viewer's session. The file holds the
 * lens's rows (its saved filters) with the columns the viewer has chosen to
 * show in the table, in the same order. The status line is read out for screen readers.
 */
export function ExportCsvButton({
  spec,
  fields,
  name,
  className,
}: {
  spec: LensSpec;
  /** Properties to include, in order. Default: the spec's select. */
  fields?: string[];
  /** The lens's name, for the file name. */
  name?: string | null;
  className?: string;
}) {
  const t = useLensT();
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState("");

  const run = async () => {
    setBusy(true);
    const shown = storedFields(spec.type) ?? fields;
    setMessage(t("csv.exporting"));
    try {
      const response = await fetch("/api/lenses/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spec, fields: shown, name: name ?? undefined }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string; message?: string } | null;
        setMessage(
          response.status === 429 ? t("csv.exportRateLimited") : t("csv.exportFailed", { reason: body?.message ?? body?.error ?? String(response.status) }),
        );
        return;
      }
      const count = Number(response.headers.get("X-Row-Count") ?? "0");
      const disposition = response.headers.get("Content-Disposition") ?? "";
      const fileName = /filename="([^"]+)"/.exec(disposition)?.[1] ?? "lens.csv";
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setMessage(count === 1 ? t("csv.exportedOne") : t("csv.exported", { count }));
    } catch (error) {
      setMessage(t("csv.exportFailed", { reason: error instanceof Error ? error.message : String(error) }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={className}>
      <Button type="button" variant="secondary" size="sm" onClick={run} loading={busy} disabled={busy} data-testid="export-csv">
        {busy ? null : <Download className="size-4" aria-hidden />}
        {t("csv.export")}
      </Button>
      <p role="status" aria-live="polite" className="sr-only">
        {message}
      </p>
    </div>
  );
}
