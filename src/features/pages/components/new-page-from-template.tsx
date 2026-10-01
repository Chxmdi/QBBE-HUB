"use client";

import * as React from "react";
import { LayoutTemplate } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Label, Select } from "@/components/ui/input";
import { useLocale } from "@/lib/i18n/client";
import { usePagesT } from "@/features/pages/i18n/client";
import type { PageRow } from "@/features/pages/tree";
import { PageTemplateForm, type ParentOption } from "@/features/templates-v2/components/page-template-form";
import { templatesV2Text } from "@/features/templates-v2/messages";
import { listPageTemplatesV2, type PageTemplateSummary } from "@/features/templates-v2/services/templates-v2.commands";

/** Today as YYYY-MM-DD in this browser's calendar, for the start date's default. */
function todayHere(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/**
 * The sidebar's "New page from template": a dialog listing the published page
 * templates with the same form the template's own screen shows. The list is
 * fetched when the dialog first opens, so the sidebar does not load templates
 * for people who never use one.
 */
export function NewPageFromTemplate({
  pages,
  editableIds,
  canCreateWorkspace,
}: {
  pages: PageRow[];
  editableIds: string[];
  canCreateWorkspace: boolean;
}) {
  const t = usePagesT();
  const locale = useLocale();
  const text = React.useMemo(() => templatesV2Text(locale), [locale]);
  const id = React.useId();
  const [open, setOpen] = React.useState(false);
  const [templates, setTemplates] = React.useState<PageTemplateSummary[] | null>(null);
  const [chosen, setChosen] = React.useState("");
  const label = t("sidebar.newPageFromTemplate");

  const parents = React.useMemo<ParentOption[]>(() => {
    const editable = new Set(editableIds);
    return pages
      .filter((p) => editable.has(p.id))
      .map((p) => ({ id: p.id, title: p.title, visibility: p.visibility }))
      .sort((a, b) => a.title.localeCompare(b.title));
  }, [pages, editableIds]);

  React.useEffect(() => {
    if (!open || templates !== null) return;
    let cancelled = false;
    listPageTemplatesV2().then((rows) => {
      if (cancelled) return;
      setTemplates(rows);
      setChosen((current) => current || rows[0]?.id || "");
    });
    return () => {
      cancelled = true;
    };
  }, [open, templates]);

  const template = templates?.find((row) => row.id === chosen) ?? null;

  return (
    <>
      <button
        type="button"
        aria-label={label}
        title={label}
        onClick={() => setOpen(true)}
        className="rounded-(--radius-sm) p-1 text-muted hover:bg-surface-soft hover:text-ink"
      >
        <LayoutTemplate className="size-4" aria-hidden />
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title={label} className="lg:w-[min(900px,calc(100vw-2rem))]">
        <div className="space-y-4 p-5">
          {templates === null ? (
            <p className="text-sm text-muted" role="status">
              {text.pageForm.loading}
            </p>
          ) : templates.length === 0 ? (
            <p className="text-sm text-muted">{text.pageForm.noTemplates}</p>
          ) : (
            <>
              <div>
                <Label htmlFor={`${id}-template`}>{text.pageForm.chooseTemplate}</Label>
                <Select id={`${id}-template`} value={chosen} onChange={(e) => setChosen(e.target.value)}>
                  {templates.map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.name}
                    </option>
                  ))}
                </Select>
                {template?.description ? <p className="mt-1 text-[12.5px] text-muted">{template.description}</p> : null}
              </div>
              {template && open ? (
                <PageTemplateForm
                  key={template.id}
                  template={template}
                  text={text}
                  locale={locale}
                  today={todayHere()}
                  parents={parents}
                  canCreateWorkspace={canCreateWorkspace}
                  submitLabel={text.pageForm.create}
                  untitled={t("page.untitled")}
                />
              ) : null}
            </>
          )}
        </div>
      </Dialog>
    </>
  );
}
