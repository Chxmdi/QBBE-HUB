"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { PenLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { SignatureFields } from "@/features/forms/components/signature-fields";
import { signDocument } from "@/features/forms/services/signature.commands";
import { useT } from "@/lib/i18n/client";
import { runServerAction } from "@/lib/use-server-action";

export function SignDocumentForm({ documentId }: { documentId: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const t = useT();
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const result = await runServerAction(
      () =>
        signDocument({
          documentId,
          signerName: form.get("signerName"),
          consent: form.get("consent") === "on",
        }),
      { setBusy: setSaving, setError, t, reload: () => window.location.reload() },
    );
    if (!result) return;
    if (!result.ok) {
      setError(result.error ?? t("signatures.sign.failed"));
      return;
    }
    toast(t("signatures.sign.signed"));
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-2xl space-y-3" aria-label={t("signatures.sign.label")}>
      <SignatureFields idPrefix="sd" />
      {error ? (
        <p role="alert" className="text-[13px] text-danger-fg">
          {error}
        </p>
      ) : null}
      <div className="flex justify-end">
        <Button type="submit" loading={saving}>
          <PenLine className="size-4" aria-hidden />
          {t("signatures.sign.sign")}
        </Button>
      </div>
    </form>
  );
}
