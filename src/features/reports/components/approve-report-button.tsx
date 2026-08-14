"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { approveReport } from "@/features/reports/services/report.commands";

export function ApproveReportButton({ reportId }: { reportId: string }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleApprove() {
    if (!window.confirm("Approve this report version? Approval is recorded with your name and timestamp.")) return;
    setSaving(true);
    const result = await approveReport(reportId);
    setSaving(false);
    if (!result.ok) {
      setError(result.error ?? "Approval failed.");
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button onClick={handleApprove} loading={saving}>
        Approve
      </Button>
      {error ? (
        <p role="alert" className="text-[12px] text-danger-fg">
          {error}
        </p>
      ) : null}
    </div>
  );
}
