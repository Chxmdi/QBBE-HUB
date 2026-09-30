"use client";

import { useLocale } from "@/lib/i18n/client";
import { fill } from "../i18n";
import { collabText } from "../messages";
import { initials, orderPresence, type PresenceEntry } from "../presence";

/**
 * Avatars of everyone on the object, and where each person's cursor is
 * (V1-17). The list is not a live region: heartbeats would make a screen
 * reader repeat it constantly. People can read it when they want.
 */
export function PresenceBar({
  entries,
  me,
  blockName,
  live,
}: {
  entries: PresenceEntry[];
  me: string;
  blockName: (blockId: string) => string;
  live: boolean;
}) {
  const m = collabText(useLocale()).presence;
  const people = orderPresence(entries, me);
  const others = people.filter((entry) => entry.userId !== me);
  const label = (entry: PresenceEntry) =>
    fill(entry.editing ? m.editing : m.viewing, { name: entry.userId === me ? m.you : entry.name });

  return (
    <section aria-label={m.label} className="mb-4">
      <ul className="flex flex-wrap items-center gap-1.5">
        {people.map((entry) => (
          <li key={entry.userId} className="flex items-center">
            <span
              aria-hidden
              title={label(entry)}
              className={
                entry.editing
                  ? "inline-flex size-8 items-center justify-center rounded-full border-2 border-brand bg-brand-soft text-[12px] font-semibold text-brand-fg"
                  : "inline-flex size-8 items-center justify-center rounded-full border-2 border-line bg-surface-soft text-[12px] font-semibold text-ink"
              }
            >
              {initials(entry.userId === me ? entry.name || m.you : entry.name)}
            </span>
            <span className="sr-only">{label(entry)}</span>
          </li>
        ))}
      </ul>
      <p className="meta mt-1">
        {others.length === 0 ? m.alone : others.map(label).join(", ")}
      </p>
      {others.some((entry) => entry.cursor) ? (
        <ul className="meta mt-1 space-y-0.5">
          {others
            .filter((entry) => entry.cursor)
            .map((entry) => (
              <li key={entry.userId}>
                {entry.cursor!.length
                  ? fill(m.selecting, { name: entry.name, length: entry.cursor!.length, block: blockName(entry.cursor!.blockId) })
                  : fill(m.cursor, { name: entry.name, offset: entry.cursor!.offset, block: blockName(entry.cursor!.blockId) })}
              </li>
            ))}
        </ul>
      ) : null}
      {!live ? <p className="sr-only">{m.offline}</p> : null}
    </section>
  );
}
