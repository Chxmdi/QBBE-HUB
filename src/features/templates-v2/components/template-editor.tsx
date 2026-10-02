"use client";

import { useRouter } from "next/navigation";
import { useId, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { BlockEditor } from "@/features/editor/adapter/block-editor";
import { CONTENT_VERSION, type EditorBlock, type EditorContent } from "@/features/editor/adapter/content";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { TabPanel, Tabs } from "@/components/ui/tabs";
import { fill, type TemplatesV2Text } from "@/features/templates-v2/messages";
import { updatePageTemplateV2 } from "@/features/templates-v2/services/template-versions.commands";
import {
  editableDocument,
  hubToDrafts,
  type DraftHubTask,
  type DraftMilestone,
  type PageBody,
} from "@/features/templates-v2/template";
import { useTemplateEditorHandlers } from "./template-editor-handlers";

/**
 * A page template in the real editor (T1): the page in English and in
 * French, with any block the editor offers, and the hub's milestones and
 * tasks. Saving makes the next version; pages already made keep theirs.
 */
export function TemplateEditor({
  templateId,
  version,
  body,
  name,
  description,
  text,
  onDone,
}: {
  templateId: string;
  /** The version being edited; saving over a newer one is refused. */
  version: number;
  body: PageBody;
  name: { en: string; fr: string };
  description: { en: string; fr: string };
  text: TemplatesV2Text;
  onDone: (savedVersion: number | null) => void;
}) {
  const id = useId();
  const router = useRouter();
  const semantic = useTemplateEditorHandlers();
  const initial = useMemo(() => editableDocument(body), [body]);
  const drafts = useMemo(() => hubToDrafts(body.hub), [body.hub]);
  const [names, setNames] = useState(name);
  const [titles, setTitles] = useState({ en: body.title.en, fr: body.title.fr });
  const [document, setDocument] = useState<{ en: EditorBlock[]; fr: EditorBlock[] }>(initial);
  const [language, setLanguage] = useState<"en" | "fr">("en");
  const [milestones, setMilestones] = useState<DraftMilestone[]>(drafts.milestones);
  const [tasks, setTasks] = useState<DraftHubTask[]>(drafts.tasks);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The editor reads its content when it mounts; switching language mounts
  // the other one with whatever was last typed there.
  const content = (lang: "en" | "fr"): EditorContent => ({ version: CONTENT_VERSION, blocks: document[lang] });

  async function save() {
    setError(null);
    setBusy(true);
    const result = await updatePageTemplateV2({
      id: templateId,
      version,
      name: names,
      description,
      title: titles,
      document,
      milestones,
      tasks,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    router.refresh();
    onDone(result.data.version);
  }

  const tabId = (lang: "en" | "fr") => `${id.replace(/:/g, "")}-${lang}`;

  return (
    <section aria-labelledby={`${id}-heading`} className="card space-y-5 p-5" data-testid="template-editor">
      <div>
        <h2 id={`${id}-heading`} className="text-[15px] font-semibold">
          {text.editor.title}
        </h2>
        <p className="text-[12.5px] text-muted">{text.editor.hint}</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <Label htmlFor={`${id}-nameEn`}>{text.nameEn}</Label>
          <Input id={`${id}-nameEn`} value={names.en} maxLength={200} lang="en" onChange={(e) => setNames({ ...names, en: e.target.value })} />
        </div>
        <div>
          <Label htmlFor={`${id}-nameFr`}>{text.nameFr}</Label>
          <Input id={`${id}-nameFr`} value={names.fr} maxLength={200} lang="fr" onChange={(e) => setNames({ ...names, fr: e.target.value })} />
        </div>
        <div>
          <Label htmlFor={`${id}-titleEn`}>{text.titleEn}</Label>
          <Input id={`${id}-titleEn`} value={titles.en} maxLength={200} lang="en" onChange={(e) => setTitles({ ...titles, en: e.target.value })} />
        </div>
        <div>
          <Label htmlFor={`${id}-titleFr`}>{text.titleFr}</Label>
          <Input id={`${id}-titleFr`} value={titles.fr} maxLength={200} lang="fr" onChange={(e) => setTitles({ ...titles, fr: e.target.value })} />
        </div>
      </div>
      <div>
        <Tabs
          tabs={[
            { id: tabId("en"), label: text.english },
            { id: tabId("fr"), label: text.french },
          ]}
          active={tabId(language)}
          onChange={(next) => setLanguage(next.endsWith("-fr") ? "fr" : "en")}
        />
        <p className="mt-2 text-[12.5px] text-muted">{text.editor.tokens}</p>
        {(["en", "fr"] as const).map((lang) => (
          <TabPanel key={lang} id={tabId(lang)} active={tabId(language)}>
            <div className="rounded-(--radius-sm) border border-line px-2" lang={lang}>
              <BlockEditor
                initialContent={content(lang)}
                editable
                semantic={semantic}
                label={lang === "en" ? text.editor.pageEn : text.editor.pageFr}
                onChange={(next) => setDocument((all) => ({ ...all, [lang]: next.blocks }))}
              />
            </div>
          </TabPanel>
        ))}
      </div>

      <fieldset className="space-y-3">
        <legend className="text-[15px] font-semibold">{text.editor.hubTitle}</legend>
        <p className="text-[12.5px] text-muted">{text.editor.hubHint}</p>
        <h3 className="text-[13px] font-medium text-ink">{text.editor.milestones}</h3>
        {milestones.map((row, index) => {
          const n = index + 1;
          const set = (change: Partial<DraftMilestone>) =>
            setMilestones((all) => all.map((m, i) => (i === index ? { ...m, ...change } : m)));
          return (
            <div key={index} className="grid gap-3 border-b border-line pb-3 md:grid-cols-[2fr_2fr_1fr]">
              <div>
                <Label htmlFor={`${id}-m${n}-en`}>{fill(text.editor.milestoneN, { n })} · {text.titleEn}</Label>
                <Input id={`${id}-m${n}-en`} value={row.en} lang="en" maxLength={200} onChange={(e) => set({ en: e.target.value })} />
              </div>
              <div>
                <Label htmlFor={`${id}-m${n}-fr`}>{fill(text.editor.milestoneN, { n })} · {text.titleFr}</Label>
                <Input id={`${id}-m${n}-fr`} value={row.fr} lang="fr" maxLength={200} onChange={(e) => set({ fr: e.target.value })} />
              </div>
              <div>
                <Label htmlFor={`${id}-m${n}-due`}>{fill(text.editor.milestoneN, { n })} · {text.duration}</Label>
                <Input id={`${id}-m${n}-due`} value={row.due} inputMode="numeric" maxLength={4} onChange={(e) => set({ due: e.target.value })} />
              </div>
            </div>
          );
        })}
        <Button type="button" variant="secondary" size="sm" onClick={() => setMilestones((all) => [...all, { en: "", fr: "", due: "" }])}>
          <Plus className="size-4" aria-hidden />
          {text.editor.addMilestone}
        </Button>
        <h3 className="text-[13px] font-medium text-ink">{text.editor.hubTasks}</h3>
        {tasks.map((row, index) => {
          const n = index + 1;
          const set = (change: Partial<DraftHubTask>) => setTasks((all) => all.map((t, i) => (i === index ? { ...t, ...change } : t)));
          return (
            <div key={index} className="grid gap-3 border-b border-line pb-3 md:grid-cols-[2fr_2fr_1fr_1fr]">
              <div>
                <Label htmlFor={`${id}-t${n}-en`}>{fill(text.editor.hubTaskN, { n })} · {text.titleEn}</Label>
                <Input id={`${id}-t${n}-en`} value={row.en} lang="en" maxLength={200} onChange={(e) => set({ en: e.target.value })} />
              </div>
              <div>
                <Label htmlFor={`${id}-t${n}-fr`}>{fill(text.editor.hubTaskN, { n })} · {text.titleFr}</Label>
                <Input id={`${id}-t${n}-fr`} value={row.fr} lang="fr" maxLength={200} onChange={(e) => set({ fr: e.target.value })} />
              </div>
              <div>
                <Label htmlFor={`${id}-t${n}-due`}>{fill(text.editor.hubTaskN, { n })} · {text.duration}</Label>
                <Input id={`${id}-t${n}-due`} value={row.due} inputMode="numeric" maxLength={4} onChange={(e) => set({ due: e.target.value })} />
              </div>
              <div>
                <Label htmlFor={`${id}-t${n}-milestone`}>{fill(text.editor.hubTaskN, { n })} · {text.editor.taskMilestone}</Label>
                <Input
                  id={`${id}-t${n}-milestone`}
                  value={row.milestone}
                  inputMode="numeric"
                  maxLength={2}
                  onChange={(e) => set({ milestone: e.target.value })}
                />
              </div>
            </div>
          );
        })}
        <Button type="button" variant="secondary" size="sm" onClick={() => setTasks((all) => [...all, { en: "", fr: "", due: "", milestone: "" }])}>
          <Plus className="size-4" aria-hidden />
          {text.editor.addHubTask}
        </Button>
      </fieldset>

      {error ? (
        <p role="alert" className="text-sm text-danger-fg">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="button" loading={busy} onClick={save}>
          {text.editor.save}
        </Button>
        <Button type="button" variant="secondary" onClick={() => onDone(null)} disabled={busy}>
          {text.editor.cancel}
        </Button>
      </div>
    </section>
  );
}
