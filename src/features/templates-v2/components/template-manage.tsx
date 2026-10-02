"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useState } from "react";
import { Copy, Pencil } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { fill, type TemplatesV2Text } from "@/features/templates-v2/messages";
import {
  duplicateTemplateV2,
  templateDetailsV2,
  type TemplateDetails,
} from "@/features/templates-v2/services/template-versions.commands";
import type { PageBody } from "@/features/templates-v2/template";
import { TemplateEditor } from "./template-editor";

/**
 * A page template's version, its history and what the reader may do with it
 * (T1): edit it in the real editor (a new version), or duplicate it as their
 * own draft. Loaded after the screen renders, with loading and error states.
 */
export function TemplateManage({
  templateId,
  body,
  text,
  locale,
}: {
  templateId: string;
  body: PageBody;
  text: TemplatesV2Text;
  locale: "en" | "fr-CA";
}) {
  const id = useId();
  const router = useRouter();
  const [details, setDetails] = useState<TemplateDetails | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [editing, setEditing] = useState(false);
  const [duplicating, setDuplicating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    templateDetailsV2(templateId).then(
      (result) => {
        if (cancelled) return;
        if (result.ok) setDetails(result.data);
        else setFailed(result.error);
      },
      () => {
        if (!cancelled) setFailed(text.manage.loadFailed);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [templateId, attempt, text]);

  const retry = useCallback(() => {
    setFailed(null);
    setDetails(null);
    setAttempt((n) => n + 1);
  }, []);

  async function duplicate() {
    setError(null);
    setDuplicating(true);
    const result = await duplicateTemplateV2(templateId);
    if (!result.ok) {
      setDuplicating(false);
      setError(result.error);
      return;
    }
    router.push(`/templates-v2/${result.data.id}`);
  }

  const dateText = (value: string) =>
    new Intl.DateTimeFormat(locale === "fr-CA" ? "fr-CA" : "en-CA", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));

  if (failed) {
    return (
      <section aria-labelledby={`${id}-versions`} className="card p-5">
        <h2 id={`${id}-versions`} className="mb-2 text-[15px] font-semibold">
          {text.manage.versions}
        </h2>
        <div role="alert" className="text-sm text-danger-fg">
          <p>{failed === text.errors.generic ? text.manage.loadFailed : failed}</p>
          <Button type="button" variant="secondary" size="sm" className="mt-2" onClick={retry}>
            {text.manage.retry}
          </Button>
        </div>
      </section>
    );
  }

  if (!details) {
    return (
      <section aria-labelledby={`${id}-versions`} className="card p-5">
        <h2 id={`${id}-versions`} className="mb-2 text-[15px] font-semibold">
          {text.manage.versions}
        </h2>
        <p role="status" className="text-sm text-muted">
          {text.manage.loading}
        </p>
      </section>
    );
  }

  if (editing) {
    return (
      <TemplateEditor
        templateId={templateId}
        body={body}
        name={details.name}
        description={details.description}
        text={text}
        onDone={(version) => {
          setEditing(false);
          if (version !== null) {
            setMessage(fill(text.editor.saved, { n: version }));
            retry();
          }
        }}
      />
    );
  }

  return (
    <section aria-labelledby={`${id}-versions`} className="card space-y-4 p-5" data-testid="template-manage">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 id={`${id}-versions`} className="text-[15px] font-semibold">
            {text.manage.versions}
          </h2>
          <Badge tone="info">{fill(text.manage.version, { n: details.version })}</Badge>
        </div>
        <div role="group" aria-label={text.manage.toolbar} className="flex flex-wrap gap-2">
          {details.canEdit ? (
            <Button type="button" variant="secondary" size="sm" onClick={() => setEditing(true)}>
              <Pencil className="size-4" aria-hidden />
              {text.manage.edit}
            </Button>
          ) : null}
          {details.canDuplicate ? (
            <Button type="button" variant="secondary" size="sm" loading={duplicating} onClick={duplicate} aria-describedby={`${id}-dup`}>
              <Copy className="size-4" aria-hidden />
              {text.manage.duplicate}
            </Button>
          ) : null}
        </div>
      </div>
      {details.canDuplicate ? (
        <p id={`${id}-dup`} className="text-[12.5px] text-muted">
          {text.manage.duplicateHint}
        </p>
      ) : null}
      {message ? (
        <p role="status" className="text-sm text-success-fg">
          {message}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-danger-fg">
          {error}
        </p>
      ) : null}
      <ol className="divide-y divide-line" aria-label={text.manage.versions}>
        {details.versions.map((v) => (
          <li key={v.version} className="flex flex-wrap items-baseline justify-between gap-2 py-2 text-sm">
            <span>
              <span className="font-medium">{fill(text.manage.versionLine, { n: v.version })}</span>
              {v.version === details.version ? (
                <Badge tone="neutral" className="ml-2">
                  {text.manage.current}
                </Badge>
              ) : null}
              <span className="meta ml-2">{fill(text.manage.savedOn, { date: dateText(v.createdAt) })}</span>
            </span>
            <span className="meta">{v.pages > 0 ? fill(text.manage.pagesFrom, { count: v.pages }) : text.manage.noPages}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
