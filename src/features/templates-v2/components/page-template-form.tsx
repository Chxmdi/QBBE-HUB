"use client";

import { useRouter } from "next/navigation";
import { useId, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { FieldHint, Input, Label, Select } from "@/components/ui/input";
import { fill, type TemplatesV2Text } from "@/features/templates-v2/messages";
import { applyPageTemplateV2 } from "@/features/templates-v2/services/templates-v2.commands";
import { PAGE_VARIABLES, renderPageBody, type PageBody, type PageVariableName, type PageVariables } from "@/features/templates-v2/template";

/** A page the person may put the new page inside. */
export interface ParentOption {
  id: string;
  title: string;
  visibility: "workspace" | "private";
}

/**
 * Creates a page from a page template: where it goes, its title, the
 * template's variables and the start date its offsets count from. The
 * preview is the same rendering the database writes (renderPageBody), so
 * what the person sees is what the page will say. Used on the template's
 * own screen and in the pages sidebar.
 */
export function PageTemplateForm({
  template,
  text,
  locale,
  today,
  parents,
  canCreateWorkspace,
  submitLabel,
  untitled,
}: {
  template: { id: string; body: PageBody };
  text: TemplatesV2Text;
  locale: "en" | "fr-CA";
  today: string;
  parents: ParentOption[];
  canCreateWorkspace: boolean;
  submitLabel: string;
  /** What a page with no title is called in the list of places. */
  untitled: string;
}) {
  const id = useId();
  const router = useRouter();
  const [start, setStart] = useState(today);
  const [language, setLanguage] = useState<"en" | "fr-CA">(locale);
  const [where, setWhere] = useState(canCreateWorkspace ? "workspace" : "");
  const [title, setTitle] = useState("");
  const [variables, setVariables] = useState<PageVariables>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const asked = useMemo(
    () => PAGE_VARIABLES.filter((name) => template.body.variables?.includes(name)),
    [template.body.variables],
  );
  const rendered = useMemo(() => renderPageBody(template.body, variables, start, language), [template.body, variables, start, language]);
  const kindLabel = (type: string | undefined) =>
    type === "heading" ? text.kindLabels.heading : type === "checkListItem" ? text.kindLabels.todo : text.kindLabels.paragraph;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!where) {
      setError(text.errors.destination);
      return;
    }
    setBusy(true);
    const result = await applyPageTemplateV2({
      templateId: template.id,
      parentPageId: where === "workspace" ? null : where,
      title,
      start,
      locale: language,
      variables,
    });
    if (!result.ok) {
      setBusy(false);
      setError(result.error);
      return;
    }
    router.push(`/pages/${result.data?.pageId}`);
    router.refresh();
  }

  const setVariable = (name: PageVariableName, value: string) => setVariables((all) => ({ ...all, [name]: value }));

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <form onSubmit={handleSubmit} className="card space-y-4 p-5" noValidate data-testid="page-template-form">
        <div>
          <Label htmlFor={`${id}-where`}>{text.pageForm.where}</Label>
          <Select
            id={`${id}-where`}
            value={where}
            onChange={(e) => setWhere(e.target.value)}
            aria-describedby={`${id}-where-hint`}
            required
          >
            {!canCreateWorkspace || parents.length === 0 ? <option value="">{text.pageForm.chooseWhere}</option> : null}
            {canCreateWorkspace ? <option value="workspace">{text.pageForm.workspace}</option> : null}
            {parents.map((p) => (
              <option key={p.id} value={p.id}>
                {fill(text.pageForm.insidePage, { title: p.title || untitled })}
              </option>
            ))}
          </Select>
          <p id={`${id}-where-hint`} className="mt-1 text-[12.5px] text-muted">
            {text.pageForm.whereHint}
          </p>
        </div>
        <div>
          <Label htmlFor={`${id}-title`}>{text.pageForm.title}</Label>
          <Input
            id={`${id}-title`}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={500}
            placeholder={rendered.title}
            aria-describedby={`${id}-title-hint`}
          />
          <p id={`${id}-title-hint`} className="mt-1 text-[12.5px] text-muted">
            {text.pageForm.titleHint}
          </p>
        </div>
        <div>
          <Label htmlFor={`${id}-start`}>{text.startDate}</Label>
          <Input
            id={`${id}-start`}
            type="date"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            aria-describedby={`${id}-start-hint`}
            required
          />
          <p id={`${id}-start-hint`} className="mt-1 text-[12.5px] text-muted">
            {text.startHint}
          </p>
        </div>
        <fieldset>
          <legend className="mb-1.5 text-[13px] font-medium text-ink">{text.language}</legend>
          <div className="flex gap-6 text-sm">
            {(["en", "fr-CA"] as const).map((value) => (
              <label key={value} className="flex items-center gap-2">
                <input
                  type="radio"
                  name={`${id}-language`}
                  value={value}
                  checked={language === value}
                  onChange={() => setLanguage(value)}
                  className="size-4 accent-(--color-brand)"
                />
                {value === "en" ? text.english : text.french}
              </label>
            ))}
          </div>
        </fieldset>
        {asked.length > 0 ? (
          <fieldset className="space-y-3">
            <legend className="text-[13px] font-medium text-ink">{text.pageForm.variables}</legend>
            {asked.map((name) => (
              <div key={name}>
                <Label htmlFor={`${id}-${name}`}>{text.pageForm[name]}</Label>
                <Input
                  id={`${id}-${name}`}
                  type={name === "due" ? "date" : "text"}
                  value={variables[name] ?? ""}
                  onChange={(e) => setVariable(name, e.target.value)}
                  maxLength={500}
                />
              </div>
            ))}
          </fieldset>
        ) : null}
        <Button type="submit" loading={busy}>
          {submitLabel}
        </Button>
        {error ? (
          <p role="alert" className="text-sm text-danger-fg">
            {error}
          </p>
        ) : null}
        {!canCreateWorkspace && parents.length === 0 ? <FieldHint>{text.errors.notAllowed}</FieldHint> : null}
      </form>

      <section aria-labelledby={`${id}-preview`} className="card p-5">
        <h2 id={`${id}-preview`} className="mb-3 text-[15px] font-semibold">
          {text.preview}
        </h2>
        <ul className="space-y-2" aria-live="polite">
          <li>
            <span className="meta mr-2">{text.kindLabels.page}</span>
            <span className="font-medium">{title.trim() || rendered.title}</span>
          </li>
          {rendered.blocks.map((block, index) => (
            <li key={index} className="ml-5 border-l border-line pl-3">
              <span className="meta mr-2">{kindLabel(block.type)}</span>
              <span>{Array.isArray(block.content) ? (block.content[0] as { text?: string })?.text ?? "" : ""}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
