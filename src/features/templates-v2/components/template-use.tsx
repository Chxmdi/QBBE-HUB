"use client";

import Link from "next/link";
import { useId, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { FieldHint, Input, Label, Select } from "@/components/ui/input";
import { fill, type TemplatesV2Text } from "@/features/templates-v2/messages";
import { applyTemplateV2 } from "@/features/templates-v2/services/templates-v2.commands";
import { destinationFor, planTemplate, type PageBody, type TemplateRecord } from "@/features/templates-v2/template";
import { PageTemplateForm, type ParentOption } from "./page-template-form";

/**
 * Preview and use a template. The preview recalculates as the start date or
 * language changes, so people see every real date before anything is made.
 * A page template shows the page form instead (U8), which creates the page
 * and opens it.
 */
export function TemplateUse({
  template,
  text,
  locale,
  today,
  programs,
  projects,
  pagesEnabled = false,
  parents = [],
  canCreateWorkspace = false,
  untitled = "",
}: {
  template: TemplateRecord;
  text: TemplatesV2Text;
  locale: "en" | "fr-CA";
  today: string;
  programs: { id: string; name: string }[];
  projects: { id: string; name: string }[];
  /** Whether the wos_pages switch is on; a page template is preview-only otherwise. */
  pagesEnabled?: boolean;
  /** Pages the person may put a new page inside. */
  parents?: ParentOption[];
  canCreateWorkspace?: boolean;
  untitled?: string;
}) {
  const id = useId();
  const [start, setStart] = useState(today);
  const [language, setLanguage] = useState<"en" | "fr-CA">(locale);
  const [destination, setDestination] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ type: string; id: string }[] | null>(null);
  const plan = useMemo(() => planTemplate(template, start, language), [template, start, language]);
  const where = destinationFor(template);
  const dateText = (value: string) =>
    new Intl.DateTimeFormat(locale === "fr-CA" ? "fr-CA" : "en-CA", { dateStyle: "medium", timeZone: "UTC" }).format(
      new Date(`${value}T00:00:00Z`),
    );

  if (template.scope === "page" && pagesEnabled) {
    return (
      <PageTemplateForm
        template={{ id: template.id, body: template.body as PageBody }}
        text={text}
        locale={locale}
        today={today}
        parents={parents}
        canCreateWorkspace={canCreateWorkspace}
        submitLabel={text.pageForm.useTemplate}
        untitled={untitled}
      />
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const result = await applyTemplateV2({
      templateId: template.id,
      start,
      locale: language,
      programId: where === "program" && destination ? destination : null,
      projectId: where === "project" && destination ? destination : null,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setCreated(result.data?.created ?? []);
  }

  const firstProject = created?.find((c) => c.type === "project");
  const firstTask = created?.find((c) => c.type === "task");

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <form onSubmit={handleSubmit} className="card space-y-4 p-5" noValidate>
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
                  name="language"
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
        {where === "program" ? (
          <div>
            <Label htmlFor={`${id}-dest`}>{text.program}</Label>
            <Select id={`${id}-dest`} value={destination} onChange={(e) => setDestination(e.target.value)}>
              <option value="">{text.noProgram}</option>
              {programs.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </div>
        ) : where === "project" ? (
          <div>
            <Label htmlFor={`${id}-dest`}>{text.project}</Label>
            <Select id={`${id}-dest`} value={destination} onChange={(e) => setDestination(e.target.value)}>
              <option value="">{text.noProject}</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </div>
        ) : null}
        {where === "none" ? (
          <FieldHint>{text.pagesOff}</FieldHint>
        ) : (
          <Button type="submit" loading={busy} disabled={created !== null}>
            {text.use}
          </Button>
        )}
        {error ? (
          <p role="alert" className="text-sm text-danger-fg">
            {error}
          </p>
        ) : null}
        {created ? (
          <p role="status" className="text-sm text-success-fg">
            {fill(text.created, { count: created.length })}{" "}
            {firstProject ? (
              <Link href={`/projects/${firstProject.id}`} className="text-brand-fg underline">
                {text.open}
              </Link>
            ) : firstTask ? (
              <Link href={`/my-work?task=${firstTask.id}`} className="text-brand-fg underline">
                {text.open}
              </Link>
            ) : null}
          </p>
        ) : null}
      </form>

      <section aria-labelledby={`${id}-preview`} className="card p-5">
        <h2 id={`${id}-preview`} className="mb-3 text-[15px] font-semibold">
          {text.preview}
        </h2>
        <ul className="space-y-2" aria-live="polite">
          {plan.map((item, index) => (
            <li key={index} className={item.depth > 0 ? "ml-5 border-l border-line pl-3" : ""}>
              <span className="meta mr-2">{text.kindLabels[item.kind]}</span>
              <span className={item.kind === "project" || item.kind === "page" ? "font-medium" : ""}>{item.title}</span>
              {item.start || item.due ? (
                <span className="meta block text-[12.5px]">
                  {[item.start ? fill(text.starts, { date: dateText(item.start) }) : null, item.due ? fill(text.due, { date: dateText(item.due) }) : null]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
