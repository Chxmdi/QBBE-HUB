"use client";

import * as React from "react";
import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { usePagesT } from "@/features/pages/i18n/client";
import type { PageHeaderUnitProps } from "./types";

/** The file name the server chose, from its Content-Disposition header. */
function fileNameFrom(header: string | null, fallback: string): string {
  const match = /filename="([^"]+)"/.exec(header ?? "");
  return match ? match[1] : fallback;
}

/**
 * Wave 2 unit X1: "Export" in the page header. Downloads the page as
 * Markdown, or as a zip of the Markdown and one CSV per view block, from
 * POST /api/pages/<id>/export. The page header only renders when the
 * wos_pages switch is on, and the route refuses on its own when it is off.
 * A failure says why in an error toast that stays until dismissed and offers
 * to try again.
 */
export function X1PageExport({ page }: PageHeaderUnitProps) {
  const t = usePagesT();
  const { toast } = useToast();
  const [busy, setBusy] = React.useState(false);
  const title = page.title || t("page.untitled");

  async function run() {
    setBusy(true);
    try {
      const response = await fetch(`/api/pages/${page.id}/export`, { method: "POST", credentials: "same-origin" });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { message?: string } | null;
        const message =
          response.status === 429 && body?.message
            ? body.message
            : response.status === 404
              ? t("units.x1.export.notFound")
              : t("units.x1.export.failed");
        toast(message, { tone: "error", action: { label: t("units.x1.export.retry"), onClick: () => void run() } });
        return;
      }
      const blob = await response.blob();
      const file = fileNameFrom(response.headers.get("content-disposition"), "page.md");
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = file;
      document.body.appendChild(link);
      link.click();
      link.remove();
      // Give the browser a moment to start the download before the address goes.
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      toast(t("units.x1.export.done", { file }), { tone: "success" });
    } catch {
      toast(t("units.x1.export.failed"), { tone: "error", action: { label: t("units.x1.export.retry"), onClick: () => void run() } });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        // Not `disabled`: a disabled button drops keyboard focus mid-export.
        aria-disabled={busy || undefined}
        aria-label={t("units.x1.export.label", { title })}
        onClick={() => {
          if (!busy) void run();
        }}
        data-page-export
      >
        {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Download className="size-4" aria-hidden />}
        <span className="max-sm:sr-only">{t("units.x1.export.button")}</span>
      </Button>
      <span role="status" className="sr-only">
        {busy ? t("units.x1.export.working") : ""}
      </span>
    </>
  );
}
