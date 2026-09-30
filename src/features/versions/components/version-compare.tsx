"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/lib/i18n/client";
import { fill } from "@/features/collab/i18n";
import type { SnapshotDiff, TextPart } from "../diff";
import { versionsText, type VersionsText } from "../messages";
import { restoreFromVersion } from "../services/restore.commands";

type Compare = VersionsText["compare"];

function Parts({ parts, side, m }: { parts: TextPart[]; side: "before" | "after"; m: Compare }) {
  return (
    <>
      {parts.map((part, index) => {
        if (part.kind === "same") return <span key={index}>{part.text}</span>;
        if (part.kind === "removed" && side === "before") {
          return (
            <del key={index} className="rounded-sm bg-danger/15 text-danger-fg">
              <span className="sr-only">[{m.removedText}: </span>
              {part.text}
              <span className="sr-only">]</span>
            </del>
          );
        }
        if (part.kind === "added" && side === "after") {
          return (
            <ins key={index} className="rounded-sm bg-success/15 text-success-fg no-underline">
              <span className="sr-only">[{m.addedText}: </span>
              {part.text}
              <span className="sr-only">]</span>
            </ins>
          );
        }
        return null;
      })}
    </>
  );
}

function show(value: unknown, m: Compare): string {
  if (value === null || value === undefined || value === "") return m.empty;
  return typeof value === "string" ? value : JSON.stringify(value);
}

/**
 * Two versions side by side (M16b). The restore buttons act on the older
 * side's version (`restoreVersionId`) and are only offered to people who can
 * edit; the server checks again.
 */
export function VersionCompare({
  diff,
  restoreVersionId,
  canRestore,
  olderLabel,
  newerLabel,
}: {
  diff: SnapshotDiff;
  restoreVersionId: string | null;
  canRestore: boolean;
  olderLabel: string;
  newerLabel: string;
}) {
  const t = versionsText(useLocale());
  const m = t.compare;
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const restoring = canRestore && restoreVersionId !== null;

  async function restore(key: string, request: { scope: "all" } | { scope: "block" | "property"; key: string }) {
    if (!restoreVersionId) return;
    setBusy(key);
    setMessage(null);
    const result = await restoreFromVersion({ ...request, versionId: restoreVersionId });
    setBusy(null);
    setMessage(result.ok ? { ok: true, text: m.restored } : { ok: false, text: result.error ?? t.errors.failed });
    if (result.ok) router.refresh();
  }

  const propertyName = (key: string) => (m.propertyNames as Record<string, string>)[key] ?? key;
  const statusOf = (kind: string) =>
    kind === "added" ? m.added : kind === "removed" ? m.removed : kind === "changed" ? m.changed : m.unchanged;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <p className="meta" role="status">
          {diff.changedCount === 0 ? m.noChanges : fill(m.changes, { count: diff.changedCount })}
        </p>
        {restoring ? (
          <Button
            loading={busy === "all"}
            onClick={() => {
              if (window.confirm(m.confirmAll)) void restore("all", { scope: "all" });
            }}
          >
            {m.restoreAll}
          </Button>
        ) : null}
      </div>
      {message ? (
        <p role={message.ok ? "status" : "alert"} className={message.ok ? "meta mb-3" : "mb-3 text-sm text-danger-fg"}>
          {message.text}
        </p>
      ) : null}

      <h2 className="section-heading mb-2">{m.content}</h2>
      <div className="card mb-6 overflow-x-auto">
        <table className="w-full table-fixed text-left text-[13.5px]">
          <caption className="sr-only">{m.content}</caption>
          <thead>
            <tr className="border-b border-line">
              <th scope="col" className="w-28 px-3 py-2 font-medium">{m.changed}</th>
              <th scope="col" className="px-3 py-2 font-medium">{olderLabel}</th>
              <th scope="col" className="px-3 py-2 font-medium">{newerLabel}</th>
              {restoring ? <th scope="col" className="w-40 px-3 py-2"><span className="sr-only">{m.restoreBlock}</span></th> : null}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {diff.blocks.map((block) => (
              <tr key={block.id} className="align-top">
                <td className="px-3 py-2">{statusOf(block.kind)}</td>
                <td className="px-3 py-2 whitespace-pre-wrap">
                  {block.kind === "changed" ? (
                    <Parts parts={block.parts} side="before" m={m} />
                  ) : block.kind === "added" ? (
                    <span className="meta">{m.empty}</span>
                  ) : block.kind === "removed" ? (
                    <del className="rounded-sm bg-danger/15 text-danger-fg">{block.before.text}</del>
                  ) : (
                    block.before.text
                  )}
                </td>
                <td className="px-3 py-2 whitespace-pre-wrap">
                  {block.kind === "changed" ? (
                    <Parts parts={block.parts} side="after" m={m} />
                  ) : block.kind === "removed" ? (
                    <span className="meta">{m.empty}</span>
                  ) : block.kind === "added" ? (
                    <ins className="rounded-sm bg-success/15 text-success-fg no-underline">{block.after.text}</ins>
                  ) : (
                    block.after.text
                  )}
                </td>
                {restoring ? (
                  <td className="px-3 py-2">
                    {block.kind === "changed" || block.kind === "removed" ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        loading={busy === `block:${block.id}`}
                        onClick={() => void restore(`block:${block.id}`, { scope: "block", key: block.id })}
                      >
                        {m.restoreBlock}
                      </Button>
                    ) : null}
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="section-heading mb-2">{m.properties}</h2>
      <div className="card overflow-x-auto">
        <table className="w-full text-left text-[13.5px]">
          <caption className="sr-only">{m.properties}</caption>
          <thead>
            <tr className="border-b border-line">
              <th scope="col" className="px-3 py-2 font-medium">{m.property}</th>
              <th scope="col" className="px-3 py-2 font-medium">{olderLabel}</th>
              <th scope="col" className="px-3 py-2 font-medium">{newerLabel}</th>
              {restoring ? <th scope="col" className="px-3 py-2"><span className="sr-only">{m.restoreAll}</span></th> : null}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {diff.properties.map((property) => (
              <tr key={property.key} className={property.changed ? "bg-surface-soft" : undefined}>
                <th scope="row" className="px-3 py-2 font-medium">
                  {propertyName(property.key)}
                  {property.changed ? <span className="sr-only"> ({m.changed})</span> : null}
                </th>
                <td className="px-3 py-2">{show(property.before, m)}</td>
                <td className="px-3 py-2">{show(property.after, m)}</td>
                {restoring ? (
                  <td className="px-3 py-2">
                    {property.changed ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        loading={busy === `property:${property.key}`}
                        onClick={() => void restore(`property:${property.key}`, { scope: "property", key: property.key })}
                      >
                        {fill(m.restoreProperty, { property: propertyName(property.key) })}
                      </Button>
                    ) : null}
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
