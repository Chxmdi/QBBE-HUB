"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Save, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";
import { TabPanel, Tabs } from "@/components/ui/tabs";
import type { Locale } from "@/lib/i18n/config";
import * as edit from "../editor-state";
import { errorText, fill, pick, type BlueprintsMessages } from "../i18n";
import { planBlueprint } from "../plan";
import { previewBlueprint } from "../preview";
import { blueprintSchema, validateBlueprint, type Blueprint, type BlueprintIssue } from "../schema";
import {
  approveBlueprint,
  buildBlueprint,
  deleteBlueprint,
  saveBlueprint,
  undoBlueprintBuild,
} from "../services/blueprint.commands";
import type { BlueprintBuildRow, BlueprintStatus } from "../services/blueprint.queries";
import { BlueprintCanvas } from "./blueprint-canvas";
import { BlueprintPreview } from "./blueprint-preview";
import { RelationEditor } from "./relation-editor";
import { TypeListEditor } from "./type-list-editor";

/** Reads a saved definition into the editor's shape, filling what a draft left out. */
function toEditable(definition: unknown): Blueprint {
  const parsed = blueprintSchema.innerType().safeParse(definition);
  if (parsed.success) return parsed.data;
  const base = edit.addType(
    { version: 1, key: "new_blueprint", name: { en: "", fr: "" }, description: { en: "", fr: "" }, types: [], relations: [], lenses: [], forms: [], workflows: [] },
    { en: "Item", fr: "Élément" },
  );
  return { ...base, ...(definition as Partial<Blueprint>) };
}

function describePath(path: (string | number)[], blueprint: Blueprint, locale: Locale): string {
  const [group, index] = path;
  if (group === "types" && typeof index === "number") {
    const type = blueprint.types[index];
    const propertyIndex = path[2] === "properties" ? path[3] : undefined;
    const property = typeof propertyIndex === "number" ? type?.properties[propertyIndex] : undefined;
    return [type && pick(type.name, locale), property && pick(property.name, locale)].filter(Boolean).join(" › ");
  }
  if (group === "relations" && typeof index === "number") {
    const relation = blueprint.relations[index];
    return relation ? pick(relation.name, locale) : "";
  }
  return path.filter((p) => typeof p === "string").join(" › ");
}

export function BlueprintDesigner({
  id,
  initial,
  status,
  approvedAt,
  build,
  canEdit,
  messages,
  locale,
}: {
  id: string;
  initial: unknown;
  status: BlueprintStatus;
  approvedAt: string | null;
  build: BlueprintBuildRow | null;
  canEdit: boolean;
  messages: BlueprintsMessages;
  locale: Locale;
}) {
  const router = useRouter();
  const [blueprint, setBlueprint] = React.useState<Blueprint>(() => toEditable(initial));
  const [dirty, setDirty] = React.useState(false);
  const [tab, setTab] = React.useState("design");
  const [notice, setNotice] = React.useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [confirming, setConfirming] = React.useState<"build" | "undo" | "delete" | null>(null);
  const [pending, startTransition] = React.useTransition();

  const locked = status === "built";
  const readOnly = !canEdit || locked;
  const validation = React.useMemo(() => validateBlueprint(blueprint), [blueprint]);
  const issues: BlueprintIssue[] = validation.ok ? [] : validation.issues;
  const plan = React.useMemo(() => (validation.ok ? planBlueprint(validation.blueprint, () => "preview") : null), [validation]);
  const when = (iso: string | null) =>
    iso ? new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso)) : "";

  function change(next: (bp: Blueprint) => Blueprint) {
    setBlueprint((bp) => next(bp));
    setDirty(true);
    setNotice(null);
  }

  function run(action: () => Promise<{ ok: boolean; error?: string }>, success: string) {
    setConfirming(null);
    startTransition(async () => {
      const result = await action();
      setNotice(result.ok ? { tone: "ok", text: success } : { tone: "error", text: result.error ?? messages.errors.failed });
      if (result.ok) router.refresh();
    });
  }

  async function save() {
    const result = await saveBlueprint(id, blueprint);
    if (result.ok) setDirty(false);
    return result;
  }

  const addType = () => change((bp) => edit.addType(bp, messages.newType));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/builder" className="inline-flex items-center gap-1.5 text-[13px] text-brand-fg hover:underline">
          <ArrowLeft className="size-4" aria-hidden />
          {messages.back}
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={status === "built" ? "success" : status === "approved" ? "info" : "neutral"}>
            <span data-testid="blueprint-status">{messages.status[status]}</span>
          </Badge>
          {dirty ? <Badge tone="warning">{messages.unsaved}</Badge> : null}
          {readOnly ? null : (
            <Button type="button" size="sm" loading={pending} onClick={() => run(save, messages.saved)}>
              <Save className="size-4" aria-hidden />
              {messages.save}
            </Button>
          )}
        </div>
      </div>

      {!canEdit ? <p className="text-[13px] text-muted">{messages.readOnly}</p> : null}
      {canEdit && locked ? <p className="text-[13px] text-muted">{messages.errors.locked}</p> : null}

      <div role="status" aria-live="polite" className="min-h-5">
        {notice ? (
          <p className={notice.tone === "ok" ? "text-[13.5px] text-success-fg" : "text-[13.5px] text-danger-fg"}>{notice.text}</p>
        ) : null}
      </div>

      {issues.length ? (
        <section aria-labelledby="blueprint-issues" className="rounded-(--radius-md) border border-warning/40 bg-warning/8 p-3">
          <h2 id="blueprint-issues" className="text-[13.5px] font-semibold text-warning-fg">
            {fill(messages.problems, { count: issues.length })}
          </h2>
          <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-[13px] text-ink">
            {issues.slice(0, 12).map((issue, i) => {
              const where = describePath(issue.path, blueprint, locale);
              const text = issue.message ? pick(issue.message, locale) : errorText(messages, issue.code);
              return <li key={i}>{where ? `${where}: ` : ""}{text}</li>;
            })}
          </ul>
        </section>
      ) : null}

      <Tabs
        tabs={[
          { id: "design", label: messages.steps.design },
          { id: "preview", label: messages.steps.preview },
          { id: "approve", label: messages.steps.approve },
        ]}
        active={tab}
        onChange={setTab}
      />

      <TabPanel id="design" active={tab}>
        <div className="space-y-8">
          <fieldset className="grid gap-3 sm:grid-cols-2" disabled={readOnly}>
            <legend className="mb-2 text-[15px] font-semibold text-ink">{messages.details.heading}</legend>
            <div>
              <Label htmlFor="bp-name-en">{messages.details.nameEn}</Label>
              <Input id="bp-name-en" value={blueprint.name.en} onChange={(e) => change((bp) => ({ ...bp, name: { ...bp.name, en: e.target.value } }))} />
            </div>
            <div>
              <Label htmlFor="bp-name-fr">{messages.details.nameFr}</Label>
              <Input id="bp-name-fr" lang="fr-CA" value={blueprint.name.fr} onChange={(e) => change((bp) => ({ ...bp, name: { ...bp.name, fr: e.target.value } }))} />
            </div>
            <div>
              <Label htmlFor="bp-key">{messages.details.key}</Label>
              <Input id="bp-key" aria-describedby="bp-key-hint" spellCheck={false} value={blueprint.key} onChange={(e) => change((bp) => ({ ...bp, key: e.target.value }))} />
              <p id="bp-key-hint" className="mt-1 text-[12.5px] text-muted">{messages.details.keyHint}</p>
            </div>
            <div className="sm:col-span-2 grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="bp-desc-en">{messages.details.descriptionEn}</Label>
                <Textarea id="bp-desc-en" value={blueprint.description.en} onChange={(e) => change((bp) => ({ ...bp, description: { ...bp.description, en: e.target.value } }))} />
              </div>
              <div>
                <Label htmlFor="bp-desc-fr">{messages.details.descriptionFr}</Label>
                <Textarea id="bp-desc-fr" lang="fr-CA" value={blueprint.description.fr} onChange={(e) => change((bp) => ({ ...bp, description: { ...bp.description, fr: e.target.value } }))} />
              </div>
            </div>
          </fieldset>

          <BlueprintCanvas
            blueprint={blueprint}
            messages={messages}
            locale={locale}
            readOnly={readOnly}
            onMove={(key, x, y) => change((bp) => edit.moveType(bp, key, x, y))}
            onConnect={(from, to) => change((bp) => edit.addRelation(bp, from, to, messages.relations.newName, messages.relations.newReverse))}
            onAddType={addType}
          />

          <TypeListEditor
            blueprint={blueprint}
            issues={issues}
            messages={messages}
            locale={locale}
            readOnly={readOnly}
            onAddType={addType}
            onUpdateType={(key, patch) => change((bp) => edit.updateType(bp, key, patch))}
            onRemoveType={(key) => change((bp) => edit.removeType(bp, key))}
            onAddProperty={(key) => change((bp) => edit.addProperty(bp, key, messages.newProperty))}
            onUpdateProperty={(type, property, patch) => change((bp) => edit.updateProperty(bp, type, property, patch))}
            onRemoveProperty={(type, property) => change((bp) => edit.removeProperty(bp, type, property))}
            onMoveProperty={(type, property, offset) => change((bp) => edit.moveProperty(bp, type, property, offset))}
          />

          <RelationEditor
            blueprint={blueprint}
            messages={messages}
            locale={locale}
            readOnly={readOnly}
            onAdd={() =>
              change((bp) => edit.addRelation(bp, bp.types[0].key, bp.types[bp.types.length - 1].key, messages.relations.newName, messages.relations.newReverse))
            }
            onUpdate={(key, patch) => change((bp) => edit.updateRelation(bp, key, patch))}
            onRemove={(key) => change((bp) => edit.removeRelation(bp, key))}
          />
        </div>
      </TabPanel>

      <TabPanel id="preview" active={tab}>
        {validation.ok && plan ? (
          <BlueprintPreview preview={previewBlueprint(validation.blueprint)} messages={messages} locale={locale} total={plan.changes.length} />
        ) : (
          <p className="text-[13.5px] text-muted">{messages.approve.fixFirst}</p>
        )}
      </TabPanel>

      <TabPanel id="approve" active={tab}>
        <section aria-labelledby="approve-heading" className="max-w-2xl space-y-4">
          <h2 id="approve-heading" className="text-[15px] font-semibold text-ink">{messages.approve.heading}</h2>
          {!canEdit ? (
            <p className="text-[13.5px] text-muted">{messages.approve.needsAdmin}</p>
          ) : status === "draft" ? (
            <>
              <p className="text-[13.5px] text-muted">{validation.ok ? messages.approve.draftIntro : messages.approve.fixFirst}</p>
              <Button
                type="button"
                disabled={!validation.ok}
                loading={pending}
                onClick={() =>
                  run(async () => {
                    const saved = dirty ? await save() : { ok: true as const };
                    return saved.ok ? approveBlueprint(id) : saved;
                  }, messages.results.approved)
                }
              >
                {messages.approve.approveButton}
              </Button>
            </>
          ) : status === "approved" ? (
            <>
              <p className="text-[13.5px] text-muted">{fill(messages.approve.approvedIntro, { when: when(approvedAt) })}</p>
              {dirty ? <p className="text-[13.5px] text-warning-fg">{messages.approve.draftIntro}</p> : null}
              {confirming === "build" ? (
                <div className="flex flex-wrap items-center gap-2" role="group" aria-label={messages.approve.buildButton}>
                  <p className="text-[13.5px] text-ink">{fill(messages.approve.confirmBuild, { count: plan?.changes.length ?? 0 })}</p>
                  <Button type="button" loading={pending} onClick={() => run(() => buildBlueprint(id), fill(messages.results.built, { count: plan?.changes.length ?? 0 }))}>
                    {messages.approve.buildButton}
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => setConfirming(null)}>{messages.cancel}</Button>
                </div>
              ) : (
                <Button type="button" disabled={dirty || !validation.ok} onClick={() => setConfirming("build")}>
                  {messages.approve.buildButton}
                </Button>
              )}
            </>
          ) : (
            <>
              <p className="text-[13.5px] text-muted">{fill(messages.approve.builtIntro, { when: when(build?.builtAt ?? null) })}</p>
              {build ? (
                confirming === "undo" ? (
                  <div className="flex flex-wrap items-center gap-2" role="group" aria-label={messages.approve.undoButton}>
                    <p className="text-[13.5px] text-ink">{messages.approve.confirmUndo}</p>
                    <Button type="button" variant="danger" loading={pending} onClick={() => run(() => undoBlueprintBuild(id, build.changeSetId), messages.results.undone)}>
                      {messages.approve.undoButton}
                    </Button>
                    <Button type="button" variant="ghost" onClick={() => setConfirming(null)}>{messages.cancel}</Button>
                  </div>
                ) : (
                  <Button type="button" variant="secondary" onClick={() => setConfirming("undo")}>{messages.approve.undoButton}</Button>
                )
              ) : null}
            </>
          )}
        </section>
      </TabPanel>

      {canEdit && !locked ? (
        <div className="border-t border-line pt-4">
          {confirming === "delete" ? (
            <div className="flex flex-wrap items-center gap-2" role="group" aria-label={messages.delete}>
              <p className="text-[13.5px] text-ink">{messages.confirmDelete}</p>
              <Button
                type="button"
                variant="danger"
                loading={pending}
                onClick={() =>
                  startTransition(async () => {
                    const result = await deleteBlueprint(id);
                    if (result.ok) router.push("/builder");
                    else setNotice({ tone: "error", text: result.error });
                  })
                }
              >
                {messages.delete}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setConfirming(null)}>{messages.cancel}</Button>
            </div>
          ) : (
            <Button type="button" variant="ghost" onClick={() => setConfirming("delete")}>
              <Trash2 className="size-4" aria-hidden />
              {messages.delete}
            </Button>
          )}
        </div>
      ) : null}
    </div>
  );
}
