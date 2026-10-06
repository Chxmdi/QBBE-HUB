"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/lib/i18n/client";
import { dismissCapture, fileCapture } from "../actions";
import { captureT } from "../i18n";

export interface FileChoice {
  key: string;
  label: string;
  /** Why it is suggested, in words; shown after the label. */
  because: string | null;
  input: { as: "task" | "document" | "interaction"; projectId?: string; contactId?: string };
  primary: boolean;
}

/** One tap to file (M18): each suggestion is a button that files the item at once. */
export function FileButtons({ itemId, title, choices }: { itemId: string; title: string; choices: FileChoice[] }) {
  const t = captureT(useLocale());
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  function run(action: () => Promise<{ ok: boolean; error?: string }>, done: string) {
    start(async () => {
      const result = await action();
      setMessage(result.ok ? { ok: true, text: done } : { ok: false, text: result.error ?? t("errors.saveFailed") });
      if (result.ok) router.refresh();
    });
  }

  return (
    <div className="mt-2">
      <div role="group" aria-label={t("inbox.fileActions", { title })} className="flex flex-wrap gap-2">
        {choices.map((choice) => (
          <Button
            key={choice.key}
            size="sm"
            variant={choice.primary ? "primary" : "secondary"}
            disabled={pending}
            onClick={() => run(() => fileCapture({ itemId, ...choice.input }), t("inbox.filed"))}
          >
            {choice.label}
            {choice.because ? <span className="sr-only"> ({choice.because})</span> : null}
          </Button>
        ))}
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => dismissCapture(itemId), t("inbox.dismissed"))}>
          {t("inbox.dismiss")}
        </Button>
      </div>
      <p role="status" className={message?.ok === false ? "mt-1 text-sm text-danger-fg" : "mt-1 text-sm text-muted"}>
        {message?.text ?? ""}
      </p>
    </div>
  );
}
