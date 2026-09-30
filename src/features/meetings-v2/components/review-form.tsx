"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import type { SemanticBlockKind } from "../editor-adapter";
import type { ReviewChoice } from "../review";
import { applyMeetingReview } from "../services/meeting-v2.commands";
import { useMeetingsV2T } from "./use-mv2-t";

export interface OpenCapture {
  id: string;
  kind: SemanticBlockKind;
  body: string;
  ownerName: string | null;
  dueOn: string | null;
}

/** One approve-or-dismiss choice per open capture, applied together. */
export function ReviewForm({ meetingId, captures }: { meetingId: string; captures: OpenCapture[] }) {
  const t = useMeetingsV2T();
  const router = useRouter();
  const [choices, setChoices] = useState<Record<string, ReviewChoice>>(
    Object.fromEntries(captures.map((c) => [c.id, "approve" as const])),
  );
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    const result = await applyMeetingReview({ meetingId, choices });
    setSaving(false);
    setStatus({ ok: result.ok, text: result.ok ? (result.message ?? "") : (result.error ?? t("review.error")) });
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <ul className="space-y-3">
        {captures.map((capture) => (
          <li key={capture.id} className="card p-4">
            <fieldset>
              <legend className="text-sm font-medium text-ink">
                <span className="sr-only">{t("review.choiceFor", { body: capture.body })}</span>
                <span aria-hidden>{capture.body}</span>
              </legend>
              <p className="mt-1 text-[12.5px] text-muted">
                {t(`kind.${capture.kind}`)} · {t(`review.willBecome.${capture.kind}`)}
                {capture.ownerName ? ` · ${capture.ownerName}` : ""}
                {capture.dueOn ? ` · ${capture.dueOn}` : ""}
              </p>
              <div className="mt-3 flex flex-wrap gap-4">
                {(["approve", "dismiss"] as const).map((choice) => (
                  <label key={choice} className="flex min-h-6 items-center gap-2 text-sm text-ink">
                    <input
                      type="radio"
                      name={`choice-${capture.id}`}
                      value={choice}
                      checked={choices[capture.id] === choice}
                      onChange={() => setChoices((prev) => ({ ...prev, [capture.id]: choice }))}
                      className="size-4 accent-brand"
                    />
                    {t(`review.${choice}`)}
                  </label>
                ))}
              </div>
            </fieldset>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center justify-end gap-3">
        {status ? (
          <span role={status.ok ? "status" : "alert"} className={status.ok ? "text-[12.5px] text-success-fg" : "text-[12.5px] text-danger-fg"}>
            {status.text}
          </span>
        ) : null}
        <Button type="submit" loading={saving}>{t("review.apply")}</Button>
      </div>
    </form>
  );
}
