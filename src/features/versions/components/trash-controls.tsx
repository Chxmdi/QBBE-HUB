"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { useFormatters, useLocale } from "@/lib/i18n/client";
import type { ObjectRef } from "@/lib/objects/contracts";
import { fill } from "@/features/collab/i18n";
import { versionsText } from "../messages";
import { restoreObject, trashObject } from "../services/version.commands";
import type { TrashEntry } from "../services/version.queries";
import { daysLeft } from "../trash";

/** "Move to trash" for an object the person can manage. */
export function DeleteObjectButton({ object, title }: { object: ObjectRef; title: string }) {
  const m = versionsText(useLocale());
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      <Button
        variant="danger"
        loading={busy}
        onClick={async () => {
          if (!window.confirm(fill(m.trash.confirmDelete, { title }))) return;
          setBusy(true);
          setError(null);
          const result = await trashObject(object);
          setBusy(false);
          if (result.ok) router.push("/collab/trash");
          else setError(result.error ?? m.errors.failed);
        }}
      >
        {m.trash.delete}
      </Button>
      {error ? (
        <p role="alert" className="mt-1 text-sm text-danger-fg">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** The trash as a table, with a restore button on each row. */
export function TrashTable({ entries }: { entries: TrashEntry[] }) {
  const m = versionsText(useLocale());
  const format = useFormatters();
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  if (entries.length === 0) return <p className="meta">{m.trash.none}</p>;
  const typeName = (type: string) => (m.types as Record<string, string>)[type] ?? m.types.object;

  return (
    <>
      {message ? (
        <p role={message.ok ? "status" : "alert"} className={message.ok ? "meta mb-3" : "mb-3 text-sm text-danger-fg"}>
          {message.text}
        </p>
      ) : null}
      <div className="card overflow-x-auto">
        <table className="w-full text-left text-[13.5px]">
          <caption className="sr-only">{m.trash.title}</caption>
          <thead>
            <tr className="border-b border-line">
              <th scope="col" className="px-4 py-2 font-medium">{m.trash.columns.item}</th>
              <th scope="col" className="px-4 py-2 font-medium">{m.trash.columns.type}</th>
              <th scope="col" className="px-4 py-2 font-medium">{m.trash.columns.deleted}</th>
              <th scope="col" className="px-4 py-2 font-medium">{m.trash.columns.remaining}</th>
              <th scope="col" className="px-4 py-2 font-medium">{m.trash.columns.actions}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {entries.map((entry) => {
              const left = daysLeft(entry.purgeAfter);
              return (
                <tr key={entry.objectId}>
                  <th scope="row" className="px-4 py-2 font-medium">{entry.title}</th>
                  <td className="px-4 py-2">{typeName(entry.objectType)}</td>
                  <td className="px-4 py-2">
                    {fill(m.trash.deletedBy, {
                      name: entry.deletedByName ?? m.history.formerMember,
                      date: format.dateTime(entry.deletedAt),
                    })}
                  </td>
                  <td className="px-4 py-2">{left === 0 ? m.trash.lastDay : fill(m.trash.daysLeft, { count: left })}</td>
                  <td className="px-4 py-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={busy === entry.objectId}
                      aria-label={fill(m.trash.restoreNamed, { title: entry.title })}
                      onClick={async () => {
                        setBusy(entry.objectId);
                        setMessage(null);
                        const result = await restoreObject(entry.objectId);
                        setBusy(null);
                        // The restored row (and with the last one, the table)
                        // leaves on refresh, so success goes to the page-level toast.
                        if (result.ok) {
                          toast(m.trash.restored);
                          router.refresh();
                        } else {
                          setMessage({ ok: false, text: result.error ?? m.errors.failed });
                        }
                      }}
                    >
                      {m.trash.restore}
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
