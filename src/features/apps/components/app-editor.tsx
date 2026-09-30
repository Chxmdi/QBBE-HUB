"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowLeft, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox, Input, Label, Select, Textarea } from "@/components/ui/input";
import type { Locale } from "@/lib/i18n/config";
import { workspaceCapabilities, type LocalizedText } from "@/lib/objects/contracts";
import { appErrorText, fill, pick, type AppsMessages } from "../i18n";
import {
  appCapabilities,
  appLensKinds,
  validateAppDefinition,
  type AppAction,
  type AppCapability,
  type AppDefinition,
  type AppScreen,
} from "../schema";
import { deleteApp, saveApp, saveRoleGrants, setAppPublished } from "../services/app.commands";
import type { RoleGrant } from "../services/app.queries";

const ROLES = ["owner", "admin", "leadership_viewer", "staff", "volunteer", "guest"] as const;
type Dashboard = Extract<AppScreen, { kind: "dashboard" }>;
type Widget = Dashboard["widgets"][number];

function uniqueKey(base: string, taken: string[]): string {
  let key = base;
  for (let n = 2; taken.includes(key); n += 1) key = `${base}_${n}`;
  return key;
}

/** Switching what a screen shows keeps its key, title and menu setting. */
function withKind(screen: AppScreen, kind: AppScreen["kind"], messages: AppsMessages): AppScreen {
  const base = { key: screen.key, title: screen.title, inNavigation: screen.inNavigation };
  if (kind === "lens") return { ...base, kind, lens: "table", type: "task" };
  if (kind === "page") return { ...base, kind, pageId: "" };
  if (kind === "form") return { ...base, kind, formKey: "form" };
  return { ...base, kind, widgets: [{ key: "tile", title: messages.manage.newTile, kind: "count", type: "task" }] };
}

export function AppEditor({
  app,
  grants,
  messages,
  locale,
}: {
  app: {
    id: string;
    slug: string;
    nameEn: string;
    nameFr: string;
    descriptionEn: string;
    descriptionFr: string;
    definition: AppDefinition;
    published: boolean;
  };
  grants: RoleGrant[];
  messages: AppsMessages;
  locale: Locale;
}) {
  const router = useRouter();
  const m = messages.manage;
  const [details, setDetails] = React.useState({
    nameEn: app.nameEn,
    nameFr: app.nameFr,
    descriptionEn: app.descriptionEn,
    descriptionFr: app.descriptionFr,
  });
  const [definition, setDefinition] = React.useState<AppDefinition>(app.definition);
  const [table, setTable] = React.useState<Record<string, AppCapability[]>>(() =>
    Object.fromEntries(ROLES.map((role) => [role, grants.find((g) => g.role === role)?.capabilities ?? []])),
  );
  const [notice, setNotice] = React.useState<{ ok: boolean; text: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [pending, startTransition] = React.useTransition();

  const validation = validateAppDefinition(definition);
  const issues = validation.ok ? [] : validation.issues;

  const setScreen = (i: number, next: AppScreen) =>
    setDefinition((d) => ({ ...d, screens: d.screens.map((s, j) => (j === i ? next : s)) }));
  const setAction = (i: number, next: AppAction) =>
    setDefinition((d) => ({ ...d, actions: d.actions.map((a, j) => (j === i ? next : a)) }));
  const moveScreen = (i: number, offset: -1 | 1) =>
    setDefinition((d) => {
      const screens = [...d.screens];
      const target = i + offset;
      if (target < 0 || target >= screens.length) return d;
      [screens[i], screens[target]] = [screens[target], screens[i]];
      return { ...d, screens };
    });

  function run(action: () => Promise<{ ok: boolean; error?: string }>, success: string) {
    startTransition(async () => {
      const result = await action();
      setNotice(result.ok ? { ok: true, text: success } : { ok: false, text: result.error ?? messages.errors.failed });
      if (result.ok) router.refresh();
    });
  }

  function save() {
    run(async () => {
      const saved = await saveApp(app.id, { ...details, definition });
      if (!saved.ok) return saved;
      return saveRoleGrants(app.id, ROLES.map((role) => ({ role, capabilities: table[role] })));
    }, m.saved);
  }

  const text = (id: string, label: string, value: LocalizedText, lang: "en" | "fr", onChange: (next: LocalizedText) => void) => (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} lang={lang === "fr" ? "fr-CA" : undefined} value={value[lang]} onChange={(e) => onChange({ ...value, [lang]: e.target.value })} />
    </div>
  );

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/apps" className="inline-flex items-center gap-1.5 text-[13px] text-brand-fg hover:underline">
          <ArrowLeft className="size-4" aria-hidden />
          {m.back}
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={app.published ? "success" : "neutral"}>{app.published ? messages.launcher.published : messages.launcher.draft}</Badge>
          <Button type="button" variant="secondary" size="sm" loading={pending} onClick={() => run(() => setAppPublished(app.id, !app.published), app.published ? m.unpublished : m.published)}>
            {app.published ? m.unpublish : m.publish}
          </Button>
          <Button type="button" size="sm" loading={pending} disabled={!validation.ok} onClick={save}>{m.save}</Button>
        </div>
      </div>

      <div role="status" aria-live="polite" className="min-h-5">
        {notice ? <p className={notice.ok ? "text-[13.5px] text-success-fg" : "text-[13.5px] text-danger-fg"}>{notice.text}</p> : null}
      </div>

      {issues.length ? (
        <section aria-labelledby="app-issues" className="rounded-(--radius-md) border border-warning/40 bg-warning/8 p-3">
          <h2 id="app-issues" className="text-[13.5px] font-semibold text-warning-fg">{fill(m.problems, { count: issues.length })}</h2>
          <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-[13px] text-ink">
            {issues.slice(0, 10).map((issue, i) => (
              <li key={i}>{issue.path.join(" › ")}: {appErrorText(messages, issue.code)}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <fieldset className="grid gap-3 sm:grid-cols-2">
        <legend className="mb-2 text-[15px] font-semibold text-ink">{m.details}</legend>
        <div>
          <Label htmlFor="app-name-en">{messages.create.nameEn}</Label>
          <Input id="app-name-en" value={details.nameEn} onChange={(e) => setDetails({ ...details, nameEn: e.target.value })} />
        </div>
        <div>
          <Label htmlFor="app-name-fr">{messages.create.nameFr}</Label>
          <Input id="app-name-fr" lang="fr-CA" value={details.nameFr} onChange={(e) => setDetails({ ...details, nameFr: e.target.value })} />
        </div>
        <div>
          <Label htmlFor="app-desc-en">{m.descriptionEn}</Label>
          <Textarea id="app-desc-en" value={details.descriptionEn} onChange={(e) => setDetails({ ...details, descriptionEn: e.target.value })} />
        </div>
        <div>
          <Label htmlFor="app-desc-fr">{m.descriptionFr}</Label>
          <Textarea id="app-desc-fr" lang="fr-CA" value={details.descriptionFr} onChange={(e) => setDetails({ ...details, descriptionFr: e.target.value })} />
        </div>
      </fieldset>

      <section aria-labelledby="app-screens" className="space-y-3">
        <h2 id="app-screens" className="text-[15px] font-semibold text-ink">{m.screens}</h2>
        <p className="max-w-2xl text-[13px] text-muted">{m.screensHint}</p>
        <ol className="space-y-3">
          {definition.screens.map((screen, i) => {
            const id = `screen-${i}`;
            const name = pick(screen.title, locale) || screen.key;
            return (
              <li key={i}>
                <fieldset className="rounded-(--radius-md) border border-line bg-surface p-4">
                  <legend className="px-1 text-[13px] font-semibold text-ink">{fill(m.screen, { n: i + 1 })}: {name}</legend>
                  <div className="grid gap-3 sm:grid-cols-4">
                    {text(`${id}-en`, m.screenTitleEn, screen.title, "en", (title) => setScreen(i, { ...screen, title }))}
                    {text(`${id}-fr`, m.screenTitleFr, screen.title, "fr", (title) => setScreen(i, { ...screen, title }))}
                    <div>
                      <Label htmlFor={`${id}-key`}>{m.key}</Label>
                      <Input id={`${id}-key`} spellCheck={false} value={screen.key} onChange={(e) => setScreen(i, { ...screen, key: e.target.value })} />
                    </div>
                    <div>
                      <Label htmlFor={`${id}-kind`}>{m.kind}</Label>
                      <Select id={`${id}-kind`} value={screen.kind} onChange={(e) => setScreen(i, withKind(screen, e.target.value as AppScreen["kind"], messages))}>
                        {(["lens", "page", "form", "dashboard"] as const).map((k) => <option key={k} value={k}>{messages.kinds[k]}</option>)}
                      </Select>
                    </div>
                  </div>

                  {screen.kind === "lens" ? (
                    <div className="mt-3 grid gap-3 sm:grid-cols-3">
                      <div>
                        <Label htmlFor={`${id}-lens`}>{m.lensKind}</Label>
                        <Select id={`${id}-lens`} value={screen.lens} onChange={(e) => setScreen(i, { ...screen, lens: e.target.value as typeof screen.lens })}>
                          {appLensKinds.map((k) => <option key={k} value={k}>{messages.lensKinds[k]}</option>)}
                        </Select>
                      </div>
                      <div>
                        <Label htmlFor={`${id}-type`}>{m.typeKey}</Label>
                        <Input id={`${id}-type`} spellCheck={false} value={screen.type} onChange={(e) => setScreen(i, { ...screen, type: e.target.value })} />
                      </div>
                      <div>
                        <Label htmlFor={`${id}-group`}>{m.groupBy}</Label>
                        <Input id={`${id}-group`} spellCheck={false} value={screen.groupBy ?? ""} onChange={(e) => setScreen(i, { ...screen, groupBy: e.target.value || undefined })} />
                      </div>
                    </div>
                  ) : screen.kind === "page" ? (
                    <div className="mt-3 max-w-md">
                      <Label htmlFor={`${id}-page`}>{m.pageId}</Label>
                      <Input id={`${id}-page`} spellCheck={false} value={screen.pageId} onChange={(e) => setScreen(i, { ...screen, pageId: e.target.value })} />
                    </div>
                  ) : screen.kind === "form" ? (
                    <div className="mt-3 max-w-md">
                      <Label htmlFor={`${id}-form`}>{m.formKey}</Label>
                      <Input id={`${id}-form`} spellCheck={false} value={screen.formKey} onChange={(e) => setScreen(i, { ...screen, formKey: e.target.value })} />
                    </div>
                  ) : (
                    <WidgetsEditor id={id} screen={screen} messages={messages} onChange={(widgets) => setScreen(i, { ...screen, widgets })} />
                  )}

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <label className="mr-2 inline-flex items-center gap-2 text-[13px] text-ink">
                      <Checkbox checked={screen.inNavigation} onChange={(e) => setScreen(i, { ...screen, inNavigation: e.target.checked })} />
                      {m.inMenu}
                    </label>
                    <Button type="button" size="sm" variant="ghost" disabled={i === 0} onClick={() => moveScreen(i, -1)} aria-label={fill(m.moveUp, { name })}>
                      <ArrowUp className="size-4" aria-hidden />
                    </Button>
                    <Button type="button" size="sm" variant="ghost" disabled={i === definition.screens.length - 1} onClick={() => moveScreen(i, 1)} aria-label={fill(m.moveDown, { name })}>
                      <ArrowDown className="size-4" aria-hidden />
                    </Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => setDefinition((d) => ({ ...d, screens: d.screens.filter((_, j) => j !== i) }))}>
                      <Trash2 className="size-4" aria-hidden />
                      {fill(m.removeScreen, { name })}
                    </Button>
                  </div>
                </fieldset>
              </li>
            );
          })}
        </ol>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() =>
            setDefinition((d) => ({
              ...d,
              screens: [
                ...d.screens,
                { key: uniqueKey("screen", d.screens.map((s) => s.key)), title: m.newScreen, kind: "lens", lens: "table", type: "task", inNavigation: true },
              ],
            }))
          }
        >
          <Plus className="size-4" aria-hidden />
          {m.addScreen}
        </Button>
      </section>

      <section aria-labelledby="app-actions" className="space-y-3">
        <h2 id="app-actions" className="text-[15px] font-semibold text-ink">{m.actions}</h2>
        <p className="max-w-2xl text-[13px] text-muted">{m.actionsHint}</p>
        <ol className="space-y-3">
          {definition.actions.map((action, i) => {
            const id = `action-${i}`;
            const name = pick(action.label, locale) || action.key;
            return (
              <li key={i}>
                <fieldset className="rounded-(--radius-md) border border-line bg-surface p-4">
                  <legend className="px-1 text-[13px] font-semibold text-ink">{fill(m.action, { n: i + 1 })}: {name}</legend>
                  <div className="grid gap-3 sm:grid-cols-4">
                    {text(`${id}-en`, m.labelEn, action.label, "en", (label) => setAction(i, { ...action, label }))}
                    {text(`${id}-fr`, m.labelFr, action.label, "fr", (label) => setAction(i, { ...action, label }))}
                    <div>
                      <Label htmlFor={`${id}-key`}>{m.actionKey}</Label>
                      <Input id={`${id}-key`} spellCheck={false} value={action.actionKey} onChange={(e) => setAction(i, { ...action, actionKey: e.target.value })} />
                    </div>
                    <div>
                      <Label htmlFor={`${id}-cap`}>{m.capability}</Label>
                      <Select id={`${id}-cap`} value={action.capability} onChange={(e) => setAction(i, { ...action, capability: e.target.value as AppAction["capability"] })}>
                        {workspaceCapabilities.map((c) => <option key={c} value={c}>{messages.capabilities[c]}</option>)}
                      </Select>
                    </div>
                  </div>
                  <fieldset className="mt-3">
                    <legend className="mb-1 text-[13px] font-medium text-ink">{m.onScreens}</legend>
                    <div className="flex flex-wrap gap-3">
                      {definition.screens.map((screen) => (
                        <label key={screen.key} className="inline-flex items-center gap-2 text-[13px] text-ink">
                          <Checkbox
                            checked={action.screens.includes(screen.key)}
                            onChange={(e) =>
                              setAction(i, {
                                ...action,
                                screens: e.target.checked ? [...action.screens, screen.key] : action.screens.filter((k) => k !== screen.key),
                              })
                            }
                          />
                          {pick(screen.title, locale)}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  <Button type="button" size="sm" variant="ghost" className="mt-3" onClick={() => setDefinition((d) => ({ ...d, actions: d.actions.filter((_, j) => j !== i) }))}>
                    <Trash2 className="size-4" aria-hidden />
                    {fill(m.removeAction, { name })}
                  </Button>
                </fieldset>
              </li>
            );
          })}
        </ol>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() =>
            setDefinition((d) => ({
              ...d,
              actions: [
                ...d.actions,
                { key: uniqueKey("action", d.actions.map((a) => a.key)), label: m.newAction, actionKey: "task.assign", capability: "run_workflow", screens: [] },
              ],
            }))
          }
        >
          <Plus className="size-4" aria-hidden />
          {m.addAction}
        </Button>
      </section>

      <section aria-labelledby="app-permissions" className="space-y-3">
        <h2 id="app-permissions" className="text-[15px] font-semibold text-ink">{m.permissions}</h2>
        <p className="max-w-2xl text-[13px] text-muted">{m.permissionsHint}</p>
        <div className="overflow-x-auto rounded-(--radius-md) border border-line bg-surface">
          <table className="w-full text-left text-[13.5px]">
            <caption className="sr-only">{m.permissions}</caption>
            <thead className="border-b border-line bg-surface-soft text-[12.5px] text-muted">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">{m.role}</th>
                {appCapabilities.map((c) => <th key={c} scope="col" className="px-3 py-2 font-medium">{messages.capabilities[c]}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {ROLES.map((role) => (
                <tr key={role}>
                  <th scope="row" className="px-3 py-2 font-medium text-ink">{messages.roles[role]}</th>
                  {appCapabilities.map((c) => (
                    <td key={c} className="px-3 py-2">
                      <Checkbox
                        aria-label={`${messages.roles[role]}: ${messages.capabilities[c]}`}
                        checked={table[role].includes(c)}
                        onChange={(e) =>
                          setTable((t) => ({
                            ...t,
                            [role]: e.target.checked ? [...t[role], c] : t[role].filter((x) => x !== c),
                          }))
                        }
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="border-t border-line pt-4">
        {confirmDelete ? (
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label={m.delete}>
            <p className="text-[13.5px] text-ink">{m.confirmDelete}</p>
            <Button
              type="button"
              variant="danger"
              loading={pending}
              onClick={() =>
                startTransition(async () => {
                  const result = await deleteApp(app.id);
                  if (result.ok) router.push("/apps");
                  else setNotice({ ok: false, text: result.error });
                })
              }
            >
              {m.delete}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setConfirmDelete(false)}>{m.cancel}</Button>
          </div>
        ) : (
          <Button type="button" variant="ghost" onClick={() => setConfirmDelete(true)}>
            <Trash2 className="size-4" aria-hidden />
            {m.delete}
          </Button>
        )}
      </div>
    </div>
  );
}

function WidgetsEditor({
  id,
  screen,
  messages,
  onChange,
}: {
  id: string;
  screen: Dashboard;
  messages: AppsMessages;
  onChange: (widgets: Widget[]) => void;
}) {
  const m = messages.manage;
  const set = (j: number, next: Widget) => onChange(screen.widgets.map((w, k) => (k === j ? next : w)));
  return (
    <fieldset className="mt-3 space-y-3">
      <legend className="mb-1 text-[13px] font-medium text-ink">{m.widgets}</legend>
      {screen.widgets.map((widget, j) => {
        const wid = `${id}-w${j}`;
        return (
          <div key={j} className="grid gap-3 rounded-(--radius-sm) border border-line/80 bg-surface-soft/50 p-3 sm:grid-cols-3">
            <div>
              <Label htmlFor={`${wid}-en`}>{m.screenTitleEn}</Label>
              <Input id={`${wid}-en`} value={widget.title.en} onChange={(e) => set(j, { ...widget, title: { ...widget.title, en: e.target.value } })} />
            </div>
            <div>
              <Label htmlFor={`${wid}-fr`}>{m.screenTitleFr}</Label>
              <Input id={`${wid}-fr`} lang="fr-CA" value={widget.title.fr} onChange={(e) => set(j, { ...widget, title: { ...widget.title, fr: e.target.value } })} />
            </div>
            <div>
              <Label htmlFor={`${wid}-kind`}>{m.widgetKind}</Label>
              <Select id={`${wid}-kind`} value={widget.kind} onChange={(e) => set(j, { ...widget, kind: e.target.value as Widget["kind"] })}>
                <option value="count">{messages.widgetKinds.count}</option>
                <option value="list">{messages.widgetKinds.list}</option>
              </Select>
            </div>
            <div>
              <Label htmlFor={`${wid}-type`}>{m.typeKey}</Label>
              <Input id={`${wid}-type`} spellCheck={false} value={widget.type} onChange={(e) => set(j, { ...widget, type: e.target.value })} />
            </div>
            <div>
              <Label htmlFor={`${wid}-fp`}>{m.filterProperty}</Label>
              <Input
                id={`${wid}-fp`}
                spellCheck={false}
                value={widget.filter?.property ?? ""}
                onChange={(e) => set(j, { ...widget, filter: e.target.value ? { property: e.target.value, value: widget.filter?.value ?? "" } : undefined })}
              />
            </div>
            <div>
              <Label htmlFor={`${wid}-fv`}>{m.filterValue}</Label>
              <Input
                id={`${wid}-fv`}
                spellCheck={false}
                disabled={!widget.filter}
                value={widget.filter?.value ?? ""}
                onChange={(e) => widget.filter && set(j, { ...widget, filter: { ...widget.filter, value: e.target.value } })}
              />
            </div>
            <div className="sm:col-span-3">
              <Button type="button" size="sm" variant="ghost" disabled={screen.widgets.length === 1} onClick={() => onChange(screen.widgets.filter((_, k) => k !== j))}>
                <Trash2 className="size-4" aria-hidden />
                {fill(m.removeWidget, { n: j + 1 })}
              </Button>
            </div>
          </div>
        );
      })}
      <Button
        type="button"
        size="sm"
        variant="secondary"
        onClick={() =>
          onChange([
            ...screen.widgets,
            { key: uniqueKey("tile", screen.widgets.map((w) => w.key)), title: m.newTile, kind: "count", type: "task" },
          ])
        }
      >
        <Plus className="size-4" aria-hidden />
        {m.addWidget}
      </Button>
    </fieldset>
  );
}
