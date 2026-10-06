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
 * people who can edit it. Each row links to the compare screen (M16b).
 */
export function VersionHistory({
  object,
  versions,
  canEdit,
  compareBase,
}: {
  object: ObjectRef;
  versions: VersionSummary[];
  canEdit: boolean;
  /** The compare screen's address with `?type=`; each row links to it with this version and the current state. */
  compareBase?: string;
}) {
  const m = versionsText(useLocale()).history;
  const errors = versionsText(useLocale()).errors;
  const compare = versionsText(useLocale()).compare;
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
              {compareBase ? (
                <a
                  href={`${compareBase}&from=${version.id}&to=current`}
                  className="text-[13px] font-medium text-brand-fg hover:underline"
                >
                  {compare.compareWithCurrent}
                  <span className="sr-only">
                    {" "}
                    ({version.label ?? m.kinds[version.kind]}, {format.dateTime(version.createdAt)})
                  </span>
                </a>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
