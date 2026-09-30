"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useFormatters, useLocale } from "@/lib/i18n/client";
import type { ObjectRef } from "@/lib/objects/contracts";
import { versionsText } from "../messages";
import { saveNamedVersion } from "../services/version.commands";
import type { VersionSummary } from "../services/version.queries";

/**
 * The list of an object's versions, newest first, with "Save version" for
 * people who can edit it. Compare and restore (M16b) hang off each row.
 */
export function VersionHistory({
  object,
  versions,
  canEdit,
  renderActions,
}: {
  object: ObjectRef;
  versions: VersionSummary[];
  canEdit: boolean;
  renderActions?: (version: VersionSummary) => React.ReactNode;
}) {
  const m = versionsText(useLocale()).history;
  const errors = versionsText(useLocale()).errors;
  const format = useFormatters();
  const router = useRouter();
  const headingId = useId();
  const nameId = useId();
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  return (
    <section aria-labelledby={headingId} className="mt-8">
      <h2 id={headingId} className="section-heading mb-3">
        {m.heading}
      </h2>
      {canEdit ? (
        <form
          className="mb-4 flex flex-wrap items-end gap-2"
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            setMessage(null);
            const result = await saveNamedVersion({ object, label });
            setBusy(false);
            if (result.ok) {
              setLabel("");
              setMessage({ ok: true, text: m.saved });
              router.refresh();
            } else {
              setMessage({ ok: false, text: result.error ?? errors.failed });
            }
          }}
        >
          <div className="min-w-56 flex-1">
            <label htmlFor={nameId} className="text-[13px] font-medium">
              {m.nameLabel}
            </label>
            <Input id={nameId} value={label} maxLength={120} onChange={(event) => setLabel(event.target.value)} />
          </div>
          <Button type="submit" loading={busy}>
            {m.saveNamed}
          </Button>
        </form>
      ) : null}
      {message ? (
        <p role={message.ok ? "status" : "alert"} className={message.ok ? "meta mb-3" : "mb-3 text-sm text-danger-fg"}>
          {message.text}
        </p>
      ) : null}
      {versions.length === 0 ? (
        <p className="meta">{m.none}</p>
      ) : (
        <ol className="card divide-y divide-line">
          {versions.map((version) => (
            <li key={version.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
              <div>
                <p className="text-[13.5px] font-medium">
                  {version.label ?? (version.kind === "manual" ? m.untitled : m.kinds[version.kind])}
                </p>
                <p className="meta">
                  <time dateTime={version.createdAt}>{format.dateTime(version.createdAt)}</time>
                  {" · "}
                  {version.createdByName ?? m.formerMember}
                  {version.label ? ` · ${m.kinds[version.kind]}` : ""}
                </p>
              </div>
              {renderActions ? <div className="flex gap-1">{renderActions(version)}</div> : null}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
