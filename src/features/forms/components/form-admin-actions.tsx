"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { deleteDraftForm, setFormStatus } from "@/features/forms/services/form.commands";
import { useT } from "@/lib/i18n/client";

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
  const t = useT();
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<{ ok: boolean; error?: string }>, done: string, to?: string) {
    setBusy(true);
    const result = await action();
    setBusy(false);
    if (!result.ok) {
      toast(result.error ?? t("forms.admin.changeFailed"), { tone: "error" });
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
            {t("forms.admin.editDraft")}
          </Link>
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => {
              if (window.confirm(t("forms.admin.deleteConfirm"))) {
                void run(() => deleteDraftForm(formId), t("forms.admin.draftDeleted"), "/forms");
              }
            }}
          >
            {t("forms.admin.deleteDraft")}
          </Button>
          <Button
            disabled={busy}
            onClick={() => {
              if (window.confirm(t("forms.admin.publishConfirm"))) {
                void run(() => setFormStatus(formId, "published"), t("forms.admin.published"));
              }
            }}
          >
            {t("forms.admin.publish")}
          </Button>
        </>
      ) : (
        <>
          <Link
            href={`/forms/${formId}/submissions`}
            className="inline-flex items-center px-2 text-[13px] font-medium text-brand-fg hover:underline"
          >
            {t("forms.admin.viewSubmissions")}
          </Link>
          {status === "published" ? (
            <Button variant="secondary" disabled={busy} onClick={() => run(() => setFormStatus(formId, "closed"), t("forms.admin.closed"))}>
              {t("forms.admin.close")}
            </Button>
          ) : (
            <Button variant="secondary" disabled={busy} onClick={() => run(() => setFormStatus(formId, "published"), t("forms.admin.reopened"))}>
              {t("forms.admin.reopen")}
            </Button>
          )}
        </>
      )}
    </div>
  );
}
