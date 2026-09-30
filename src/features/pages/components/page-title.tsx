"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";
import { usePagesT } from "@/features/pages/i18n/client";
import { renamePage } from "@/features/pages/services/page.commands";

/**
 * The page's title as an inline field: typing edits it, leaving the field or
 * pressing Enter saves. Readers without edit rights see a plain heading.
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
          if (e.key === "Enter") {
            e.preventDefault();
            save();
          } else if (e.key === "Escape") {
            setValue(saved.current);
          }
        }}
        className="w-full rounded-(--radius-sm) bg-transparent px-1 -mx-1 text-ink placeholder:text-muted/70 hover:bg-surface-soft focus:bg-surface-soft"
      />
    </h1>
  );
}
