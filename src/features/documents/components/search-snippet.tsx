"use client";

import { useT } from "@/lib/i18n/client";
import { splitSnippet } from "@/features/documents/text-extract/text";

/**
 * A passage from inside a file with the matched words marked. The passage is
 * rendered as text nodes only: whatever the file said, it is never markup.
 */
export function SearchSnippet({ snippet }: { snippet: string }) {
  const t = useT();
  return (
    <span className="meta block max-w-xl whitespace-pre-line">
      <span className="sr-only">{t("documents.foundInside")}</span>
      {splitSnippet(snippet).map((part, index) =>
        part.match ? (
          <mark key={index} className="rounded-sm bg-brand-soft px-0.5 font-semibold text-ink">
            {part.text}
          </mark>
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
    </span>
  );
}
