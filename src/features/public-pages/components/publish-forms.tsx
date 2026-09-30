"use client";

import { useActionState, useId } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox, Input, Textarea } from "@/components/ui/input";
import { useLocale } from "@/lib/i18n/client";
import { usePublicPagesT } from "../i18n/client";
import { requestPublication, reviewPublication, unpublish, type PublishActionState } from "../services/publication.commands";
import { fieldLabel, fieldValue, toSlug, type PublishedField } from "../services/publication";

const initial: PublishActionState = { ok: false, message: null };

function Status({ state }: { state: PublishActionState }) {
  return (
    <p
      role={state.ok ? "status" : "alert"}
      aria-live={state.ok ? "polite" : "assertive"}
      className={state.ok ? "text-[13px] text-success-fg" : "text-[13px] text-danger-fg"}
    >
      {state.message ?? ""}
    </p>
  );
}

/** Step two of asking: which fields, at which address. */
export function AskToPublishForm({ sourceId, sourceLabel, candidates }: {
  sourceId: string;
  sourceLabel: string;
  candidates: PublishedField[];
}) {
  const t = usePublicPagesT();
  const locale = useLocale();
  const id = useId();
  const [state, action, pending] = useActionState(requestPublication, initial);
  return (
    <form action={action} className="grid gap-3">
      <input type="hidden" name="sourceId" value={sourceId} />
      <fieldset className="grid gap-1.5" aria-describedby={`${id}-fields-help`}>
        <legend className="text-[13px] font-medium text-ink">{t("ask.fields")}</legend>
        <p id={`${id}-fields-help`} className="text-[12.5px] text-muted">
          {t("ask.fieldsHelp")}
        </p>
        {candidates.map((field) => (
          <label key={field.key} className="flex items-start gap-2 text-[13.5px] text-ink">
            <Checkbox name="fields" value={field.key} defaultChecked={field.key === "title"} className="mt-0.5" />
            <span>
              <span className="font-medium">{fieldLabel(field, locale)}</span>
              <span className="text-muted"> — {fieldValue(field, locale) ?? t("ask.empty")}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <div className="grid max-w-md gap-1">
        <label htmlFor={`${id}-slug`} className="text-[13px] font-medium text-ink">
          {t("ask.slug")}
        </label>
        <Input
          id={`${id}-slug`}
          name="slug"
          required
          minLength={3}
          maxLength={80}
          pattern="[a-z0-9][a-z0-9\-]{2,79}"
          defaultValue={toSlug(sourceLabel)}
          aria-describedby={`${id}-slug-help`}
          autoComplete="off"
        />
        <p id={`${id}-slug-help`} className="text-[12.5px] text-muted">
          {t("ask.slugHelp")}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" loading={pending}>
          {t("ask.submit")}
        </Button>
        <Status state={state} />
      </div>
    </form>
  );
}

export function ReviewForm({ publicationId, mine }: { publicationId: string; mine: boolean }) {
  const t = usePublicPagesT();
  const id = useId();
  const [state, action, pending] = useActionState(reviewPublication, initial);
  if (mine) return <p className="text-[13px] text-muted">{t("review.yours")}</p>;
  return (
    <form action={action} className="grid gap-2">
      <input type="hidden" name="publicationId" value={publicationId} />
      <div className="grid max-w-md gap-1">
        <label htmlFor={`${id}-note`} className="text-[13px] font-medium text-ink">
          {t("review.note")}
        </label>
        <Textarea id={`${id}-note`} name="note" maxLength={1000} className="min-h-14" />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" name="decision" value="approve" loading={pending}>
          {t("review.approve")}
        </Button>
        <Button type="submit" name="decision" value="reject" variant="secondary" disabled={pending}>
          {t("review.reject")}
        </Button>
        <Status state={state} />
      </div>
    </form>
  );
}

export function UnpublishButton({ publicationId, label }: { publicationId: string; label: string }) {
  const [state, action, pending] = useActionState(unpublish, initial);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="publicationId" value={publicationId} />
      <Button type="submit" size="sm" variant="danger" loading={pending} aria-label={label}>
        {label.split(" — ")[0]}
      </Button>
      <Status state={state} />
    </form>
  );
}
