"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";
import { usePagesT } from "@/features/pages/i18n/client";
import { renamePage } from "@/features/pages/services/page.commands";

/**
 * The page's title as an inline field: typing edits it, leaving the field or
 * pressing Enter saves, and Enter carries on into the page body, as in a
 * document. Readers without edit rights see a plain heading.
 * The parent keys it on the saved title, so a rename elsewhere resets it.
 */
export function PageTitle({ pageId, title, canEdit }: { pageId: string; title: string; canEdit: boolean }) {
  const t = usePagesT();
  const router = useRouter();
  const { toast } = useToast();
  const [value, setValue] = React.useState(title);
  const saved = React.useRef(title);
  const [, startTransition] = React.useTransition();

  if (!canEdit) {
    return <h1 className="page-title break-words">{title || t("page.untitled")}</h1>;
  }

  function save() {
    const next = value.trim();
    if (next === saved.current) return;
    startTransition(async () => {
      const result = await renamePage({ pageId, title: next });
      if (!result.ok) {
        toast(result.error ?? t("errors.failed"), { tone: "error" });
        setValue(saved.current);
        return;
      }
      saved.current = next;
      router.refresh();
    });
  }

  return (
    <h1 className="page-title">
      <input
        aria-label={t("page.titleLabel")}
        value={value}
        maxLength={500}
        placeholder={t("page.titlePlaceholder")}
        onChange={(e) => setValue(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.nativeEvent.isComposing) {
            e.preventDefault();
            save();
            // Without this, what someone types next lands in the title too
            // (staging audit B6: "QA audit page# Heading test- [ ] checklist").
            focusBody(e.currentTarget);
          } else if (e.key === "Escape") {
            setValue(saved.current);
          }
        }}
        // .page-title paints its gradient through transparent text, which the
        // field inherits; the hover and focus background hides that gradient,
        // so the field draws its own text then (staging audit B5).
        className="w-full rounded-(--radius-sm) bg-transparent px-1 -mx-1 text-brand-fg placeholder:text-muted/70 placeholder:[-webkit-text-fill-color:currentColor] hover:bg-surface-soft hover:[-webkit-text-fill-color:currentColor] focus:bg-surface-soft focus:[-webkit-text-fill-color:currentColor]"
      />
    </h1>
  );
}

/** Moves the caret into the page's editor, when this page has one the reader can edit. */
function focusBody(title: HTMLElement) {
  const body = title.closest("article")?.querySelector<HTMLElement>('.ProseMirror[contenteditable="true"]');
  body?.focus();
}
