"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Label, Textarea } from "@/components/ui/input";
import {
  approveReport,
  regenerateReport,
  rejectReport,
} from "@/features/reports/services/report.commands";
import { useT } from "@/lib/i18n/client";

/**
 * Deciding, or rebuilding, the report on screen.
 *
 * Approval is recorded against the version being looked at, so the buttons are
 * about "this version" rather than "this report". Regenerating says out loud
 * that it clears the sign-off, because that surprise is otherwise discovered
 * afterwards.
 */
export function ReportDecisionControls({
  reportId,
  canDecide,
  isApproved,
}: {
  reportId: string;
  canDecide: boolean;
  isApproved: boolean;
}) {
  const router = useRouter();
  const t = useT();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [rejecting, setRejecting] = React.useState(false);

  async function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(true);
    setError(null);
    const result = await action();
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? t("reports.decision.failed"));
      return false;
    }
    router.refresh();
    return true;
  }

  if (rejecting) {
    return (
      <form
        className="no-print w-full max-w-md"
        onSubmit={async (event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          const saved = await run(() =>
            rejectReport(reportId, String(form.get("note") ?? "")),
          );
          if (saved) setRejecting(false);
        }}
      >
        <Label htmlFor="report-reject-note">
          {t("reports.decision.rejectLabel")}
        </Label>
        <Textarea id="report-reject-note" name="note" rows={2} required />
        <div className="mt-2 flex items-center gap-2">
          <Button type="submit" size="sm" loading={busy} disabled={busy}>
            {t("reports.decision.sendBack")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setRejecting(false)}
          >
            {t("reports.decision.cancel")}
          </Button>
          {error ? (
            <span role="alert" className="text-[12.5px] text-danger-fg">
              {error}
            </span>
          ) : null}
        </div>
      </form>
    );
  }

  return (
    <div className="no-print flex flex-col items-end gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="secondary"
          loading={busy}
          disabled={busy}
          onClick={() => {
            const warning = isApproved
              ? t("reports.decision.confirmRegenerateApproved")
              : t("reports.decision.confirmRegenerate");
            if (!window.confirm(warning)) return;
            void run(() => regenerateReport(reportId));
          }}
        >
          {t("reports.decision.regenerate")}
        </Button>

        {canDecide && !isApproved ? (
          <>
            <Button
              size="sm"
              loading={busy}
              disabled={busy}
              onClick={() => {
                if (
                  !window.confirm(t("reports.decision.confirmApprove"))
                ) {
                  return;
                }
                void run(() => approveReport(reportId));
              }}
            >
              {t("reports.decision.approve")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setRejecting(true)}>
              {t("reports.decision.sendBack")}
            </Button>
          </>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="text-[12px] text-danger-fg">
          {error}
        </p>
      ) : null}
    </div>
  );
}
