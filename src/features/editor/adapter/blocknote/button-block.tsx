"use client";

import * as React from "react";
import Link from "next/link";
import { createPortal } from "react-dom";
import { createReactBlockSpec } from "@blocknote/react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input, Select } from "@/components/ui/input";
import type { EditorT } from "@/features/editor/i18n";
import type { ButtonActionKey } from "@/features/editor/adapter/types";
import type { HandlersBox } from "./semantic-blocks";

/**
 * The button block (U5b): runs one action from the action registry (plan
 * A8). Only the registry's actions can be chosen, each with its own fixed
 * arguments; the server checks both again and runs the action as the person
 * who clicks, so the capability check, the change set and its undo are the
 * registry's.
 */

export const buttonActionKeys = ["task.create", "object.set_property"] as const satisfies readonly ButtonActionKey[];

/** Actions that change something, and so ask before running. Every one today. */
const SIDE_EFFECTS: Record<ButtonActionKey, boolean> = { "task.create": true, "object.set_property": true };

const actionLabel = { "task.create": "button.actions.taskCreate", "object.set_property": "button.actions.setProperty" } as const;

const isolateKeys = (event: React.KeyboardEvent) => event.stopPropagation();

type Args = Record<string, string>;

function parseArgs(value: string): Args {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
    );
  } catch {
    return {};
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function complete(actionKey: string, args: Args): actionKey is ButtonActionKey {
  if (actionKey === "task.create") return Boolean(args.title?.trim());
  if (actionKey === "object.set_property") return UUID.test(args.objectId ?? "") && /^[a-z][a-z0-9_]*$/.test(args.property ?? "");
  return false;
}

export function createButtonBlockSpec(t: EditorT, handlers: HandlersBox) {
  return createReactBlockSpec(
    {
      type: "button",
      propSchema: {
        label: { default: "" },
        actionKey: { default: "" },
        args: { default: "{}" },
      },
      content: "none",
    },
    {
      render: ({ block, editor }) => (
        <ButtonBlock
          label={block.props.label}
          actionKey={block.props.actionKey}
          args={parseArgs(block.props.args)}
          editable={editor.isEditable}
          onSave={(label, actionKey, args) => editor.updateBlock(block, { props: { label, actionKey, args: JSON.stringify(args) } })}
          t={t}
          handlers={handlers}
        />
      ),
    },
  );
}

type Outcome =
  | { kind: "done"; message: string; href: string | null; changeSetId: string | null }
  | { kind: "error"; message: string }
  | { kind: "undone" }
  | { kind: "undoFailed" };

function ButtonBlock({
  label,
  actionKey,
  args,
  editable,
  onSave,
  t,
  handlers,
}: {
  label: string;
  actionKey: string;
  args: Args;
  editable: boolean;
  onSave: (label: string, actionKey: string, args: Args) => void;
  t: EditorT;
  handlers: HandlersBox;
}) {
  const ready = Boolean(label.trim()) && complete(actionKey, args);
  const [configuring, setConfiguring] = React.useState(false);
  const [confirming, setConfirming] = React.useState(false);
  /** The title of the item a set-property button changes, read when asking. */
  const [target, setTarget] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [outcome, setOutcome] = React.useState<Outcome | null>(null);

  if (editable && (!ready || configuring)) {
    return (
      <ButtonSettings
        label={label}
        actionKey={actionKey}
        args={args}
        t={t}
        handlers={handlers}
        onSave={(...next) => {
          setConfiguring(false);
          onSave(...next);
        }}
      />
    );
  }
  if (!ready) {
    return (
      <p role="note" className="w-full rounded-(--radius-sm) border border-line p-2 text-body-sm text-muted" contentEditable={false}>
        {t("button.unconfigured")}
      </p>
    );
  }

  const run = async () => {
    const api = handlers.current?.actions;
    setConfirming(false);
    if (!api) {
      setOutcome({ kind: "error", message: t("button.errors.failed") });
      return;
    }
    setBusy(true);
    const result = await api.run(actionKey as ButtonActionKey, args).catch(() => null);
    setBusy(false);
    if (!result) setOutcome({ kind: "error", message: t("button.errors.failed") });
    else if (result.ok) setOutcome({ kind: "done", message: result.message, href: result.href, changeSetId: result.changeSetId });
    else setOutcome({ kind: "error", message: result.error });
  };

  const confirmText =
    actionKey === "task.create"
      ? t("button.confirmTask", { title: args.title ?? "" })
      : t("button.confirmProperty", { property: args.property ?? "", value: args.value ?? "", item: target });

  const ask = async () => {
    if (actionKey !== "object.set_property") {
      setConfirming(true);
      return;
    }
    // Name the item before anyone agrees to change it; one the clicker
    // cannot see cannot be changed by them either.
    setBusy(true);
    const title = await handlers.current?.actions?.describe(args.objectId ?? "").catch(() => null);
    setBusy(false);
    if (!title) {
      setOutcome({ kind: "error", message: t("button.errors.forbidden") });
      return;
    }
    setTarget(title);
    setConfirming(true);
  };

  return (
    <div className="flex w-full flex-col gap-1.5" contentEditable={false} onKeyDown={isolateKeys}>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="secondary"
          loading={busy}
          onClick={() => void (SIDE_EFFECTS[actionKey as ButtonActionKey] ? ask() : run())}
        >
          {label}
        </Button>
        {editable ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => setConfiguring(true)}>
            {t("button.configure")}
          </Button>
        ) : null}
      </div>
      <div role="status" className="text-caption" data-testid="button-result">
        {outcome?.kind === "done" ? (
          <span className="flex flex-wrap items-center gap-2 text-ink">
            {outcome.message}
            {outcome.href ? (
              <Link href={outcome.href} className="text-muted underline hover:text-ink">
                {t("button.open")}
              </Link>
            ) : null}
            {outcome.changeSetId ? (
              <button
                type="button"
                className="inline-flex min-h-6 items-center text-muted underline hover:text-ink"
                onClick={async () => {
                  const id = outcome.changeSetId;
                  const ok = id ? await handlers.current?.actions?.undo(id).catch(() => false) : false;
                  setOutcome(ok ? { kind: "undone" } : { kind: "undoFailed" });
                }}
              >
                {t("button.undo")}
              </button>
            ) : null}
          </span>
        ) : outcome?.kind === "error" ? (
          <span className="text-danger-fg">{outcome.message}</span>
        ) : outcome?.kind === "undone" ? (
          <span className="text-muted">{t("button.undone")}</span>
        ) : outcome?.kind === "undoFailed" ? (
          <span className="text-danger-fg">{t("button.undoFailed")}</span>
        ) : null}
      </div>
      {confirming
        ? createPortal(
            <Dialog open onClose={() => setConfirming(false)} title={t("button.confirmTitle", { label })}>
              <p className="text-body-sm text-ink">{confirmText}</p>
              <div className="mt-5 flex flex-wrap justify-end gap-2">
                <Button variant="secondary" onClick={() => setConfirming(false)}>
                  {t("button.cancel")}
                </Button>
                <Button onClick={() => void run()}>{t("button.confirmRun")}</Button>
              </div>
            </Dialog>,
            document.body,
          )
        : null}
    </div>
  );
}

function ButtonSettings({
  label,
  actionKey,
  args,
  t,
  handlers,
  onSave,
}: {
  label: string;
  actionKey: string;
  args: Args;
  t: EditorT;
  handlers: HandlersBox;
  onSave: (label: string, actionKey: string, args: Args) => void;
}) {
  const [draftLabel, setDraftLabel] = React.useState(label);
  const [draftKey, setDraftKey] = React.useState(actionKey);
  const [draftArgs, setDraftArgs] = React.useState<Args>(args);
  const [projects, setProjects] = React.useState<{ id: string; name: string }[]>([]);
  const id = React.useId();

  React.useEffect(() => {
    const api = handlers.current;
    if (draftKey !== "task.create" || !api) return;
    let active = true;
    void api
      .projects()
      .then((rows) => {
        if (!active) return;
        setProjects(rows);
        setDraftArgs((current) =>
          current.projectId !== undefined ? current : { ...current, projectId: api.defaultProjectId ?? rows[0]?.id ?? "" },
        );
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [draftKey, handlers]);

  const set = (key: string) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setDraftArgs((current) => ({ ...current, [key]: event.target.value }));
  // The label sits beside its control, not around it, so the control's own
  // text (a select's chosen option) is not read as part of its name.
  const field = (key: string, text: string, control: React.ReactNode) => (
    <div className="flex flex-col gap-1">
      <label htmlFor={`${id}-${key}`} className="text-caption font-medium text-ink">
        {text}
      </label>
      {control}
    </div>
  );
  const valid = Boolean(draftLabel.trim()) && complete(draftKey, draftArgs);

  return (
    <div
      className="flex w-full flex-col gap-2 rounded-(--radius-sm) border border-dashed border-line p-3"
      contentEditable={false}
      onKeyDown={isolateKeys}
    >
      {field("label", t("button.label"), <Input id={`${id}-label`} value={draftLabel} onChange={(event) => setDraftLabel(event.target.value)} />)}
      {field(
        "action",
        t("button.action"),
        <Select
          id={`${id}-action`}
          value={draftKey}
          onChange={(event) => {
            setDraftKey(event.target.value);
            setDraftArgs({});
          }}
        >
          <option value="">{t("button.chooseAction")}</option>
          {buttonActionKeys.map((key) => (
            <option key={key} value={key}>
              {t(actionLabel[key])}
            </option>
          ))}
        </Select>,
      )}
      {draftKey === "task.create" ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {field("title", t("button.title"), <Input id={`${id}-title`} value={draftArgs.title ?? ""} onChange={set("title")} />)}
          {field(
            "projectId",
            t("button.project"),
            <Select id={`${id}-projectId`} value={draftArgs.projectId ?? ""} onChange={set("projectId")}>
              <option value="">{t("button.noProject")}</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </Select>,
          )}
        </div>
      ) : null}
      {draftKey === "object.set_property" ? (
        <div className="grid gap-2 sm:grid-cols-3">
          {field("objectId", t("button.objectId"), <Input id={`${id}-objectId`} value={draftArgs.objectId ?? ""} onChange={set("objectId")} />)}
          {field("property", t("button.property"), <Input id={`${id}-property`} value={draftArgs.property ?? ""} onChange={set("property")} />)}
          {field("value", t("button.value"), <Input id={`${id}-value`} value={draftArgs.value ?? ""} onChange={set("value")} />)}
        </div>
      ) : null}
      {!valid && draftKey && draftLabel.trim() ? <p className="text-caption text-muted">{t("button.errors.invalid")}</p> : null}
      <div>
        <Button type="button" size="sm" disabled={!valid} onClick={() => onSave(draftLabel.trim(), draftKey, draftArgs)}>
          {t("button.save")}
        </Button>
      </div>
    </div>
  );
}
