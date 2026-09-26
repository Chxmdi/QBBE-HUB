"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { deleteDraftForm, setFormStatus } from "@/features/forms/services/form.commands";

/** Publish, close, reopen or delete a form. The database enforces each step. */
export function FormAdminActions({
  formId,
  status,
}: {
  formId: string;
  status: "draft" | "published" | "closed";
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<{ ok: boolean; error?: string }>, done: string, to?: string) {
    setBusy(true);
    const result = await action();
    setBusy(false);
    if (!result.ok) {
      toast(result.error ?? "Could not change the form.", { tone: "error" });
      return;
    }
    toast(done);
    if (to) router.push(to);
    router.refresh();
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {status === "draft" ? (
        <>
          <Link
            href={`/forms/${formId}/edit`}
            className="inline-flex items-center px-2 text-[13px] font-medium text-brand-fg hover:underline"
          >
            Edit draft
          </Link>
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => {
              if (window.confirm("Delete this draft? This cannot be undone.")) {
                void run(() => deleteDraftForm(formId), "Draft deleted.", "/forms");
              }
            }}
          >
            Delete draft
          </Button>
          <Button
            disabled={busy}
            onClick={() => {
              if (window.confirm("Publish this form? Its questions cannot be changed afterwards.")) {
                void run(() => setFormStatus(formId, "published"), "Form published.");
              }
            }}
          >
            Publish
          </Button>
        </>
      ) : (
        <>
          <Link
            href={`/forms/${formId}/submissions`}
            className="inline-flex items-center px-2 text-[13px] font-medium text-brand-fg hover:underline"
          >
            View submissions
          </Link>
          {status === "published" ? (
            <Button variant="secondary" disabled={busy} onClick={() => run(() => setFormStatus(formId, "closed"), "Form closed.")}>
              Close form
            </Button>
          ) : (
            <Button variant="secondary" disabled={busy} onClick={() => run(() => setFormStatus(formId, "published"), "Form reopened.")}>
              Reopen form
            </Button>
          )}
        </>
      )}
    </div>
  );
}
