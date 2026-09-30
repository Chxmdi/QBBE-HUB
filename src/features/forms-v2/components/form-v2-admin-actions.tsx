"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { fill, type FormsV2Text } from "@/features/forms-v2/messages";
import {
  convertLegacyForms,
  deleteDraftFormV2,
  setFormV2Status,
} from "@/features/forms-v2/services/forms-v2.commands";

/** Open, close or delete one form (owners and admins). */
export function FormV2StatusActions({
  formId,
  status,
  text,
}: {
  formId: string;
  status: "draft" | "published" | "closed";
  text: FormsV2Text;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function run(action: () => Promise<{ ok: boolean; error?: string }>, done: string, then?: string) {
    setBusy(true);
    const result = await action();
    setBusy(false);
    setMessage(result.ok ? { ok: true, text: done } : { ok: false, text: result.error ?? text.errors.generic });
    if (result.ok) {
      if (then) router.push(then);
      else router.refresh();
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {status === "draft" ? (
          <>
            <Button size="sm" loading={busy} onClick={() => run(() => setFormV2Status(formId, "published"), text.published)}>
              {text.publish}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() => run(() => deleteDraftFormV2(formId), text.saved, "/forms-v2")}
            >
              {text.deleteDraft}
            </Button>
          </>
        ) : null}
        {status === "published" ? (
          <Button size="sm" variant="secondary" loading={busy} onClick={() => run(() => setFormV2Status(formId, "closed"), text.closed)}>
            {text.close}
          </Button>
        ) : null}
      </div>
      {message ? (
        <p role={message.ok ? "status" : "alert"} className={message.ok ? "text-sm text-success-fg" : "text-sm text-danger-fg"}>
          {message.text}
        </p>
      ) : null}
    </div>
  );
}

/** Copies the original builder's forms into this model, or removes the copies. */
export function LegacyConversion({ text }: { text: FormsV2Text }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function run(direction: "convert" | "revert") {
    setBusy(true);
    const result = await convertLegacyForms(direction);
    setBusy(false);
    if (!result.ok) {
      setMessage({ ok: false, text: result.error });
      return;
    }
    const count = result.data?.count ?? 0;
    setMessage({ ok: true, text: fill(direction === "convert" ? text.converted : text.reverted, { count }) });
    router.refresh();
  }

  return (
    <div className="space-y-2">
      <p className="meta max-w-prose">{text.convertHelp}</p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" disabled={busy} onClick={() => run("convert")}>
          {text.convert}
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => run("revert")}>
          {text.revert}
        </Button>
      </div>
      {message ? (
        <p role={message.ok ? "status" : "alert"} className={message.ok ? "text-sm text-success-fg" : "text-sm text-danger-fg"}>
          {message.text}
        </p>
      ) : null}
    </div>
  );
}
