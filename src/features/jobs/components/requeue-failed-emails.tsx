"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { requeueFailedEmails } from "@/features/jobs/services/jobs.commands";
import { useT } from "@/lib/i18n/client";

/** Sends the organization's recently failed email again (Admin > Jobs). */
export function RequeueFailedEmails() {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function run() {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      try {
        const result = await requeueFailedEmails();
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setNotice(t("jobs.requeue.done", { count: result.count }));
        router.refresh();
      } catch {
        setError(t("jobs.requeue.failed"));
      }
    });
  }

  return (
    <div className="card mt-4 px-4 py-3">
      <p className="text-[13.5px] font-medium">{t("jobs.requeue.title")}</p>
      <p className="meta mt-1">{t("jobs.requeue.body")}</p>
      <Button type="button" variant="secondary" className="mt-3" onClick={run} disabled={pending}>
        {pending ? t("jobs.requeue.working") : t("jobs.requeue.button")}
      </Button>
      {error ? <p role="alert" className="mt-3 text-sm text-danger-fg">{error}</p> : null}
      {notice ? <p role="status" className="mt-3 text-sm text-success-fg">{notice}</p> : null}
    </div>
  );
}
