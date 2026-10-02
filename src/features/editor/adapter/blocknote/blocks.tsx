"use client";

import * as React from "react";
import { createReactBlockSpec } from "@blocknote/react";
import { AlertTriangle, CheckCircle2, ExternalLink, Info, Link2, OctagonAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { EditorT } from "@/features/editor/i18n";
import { embedFor, safeBookmarkUrl } from "@/features/editor/adapter/embeds";
import { framed } from "./block-frame";

/**
 * Workspace blocks BlockNote does not ship: callout, bookmark and embed.
 * Built with a translator so their controls follow the page's language; the
 * schema is rebuilt when the language changes.
 */

export const calloutTones = ["info", "success", "warning", "danger"] as const;
type CalloutTone = (typeof calloutTones)[number];

const toneStyle: Record<CalloutTone, { box: string; Icon: typeof Info }> = {
  info: { box: "border-info bg-info/10", Icon: Info },
  success: { box: "border-success bg-success/10", Icon: CheckCircle2 },
  warning: { box: "border-warning bg-warning/10", Icon: AlertTriangle },
  danger: { box: "border-danger bg-danger/10", Icon: OctagonAlert },
};

/** Keeps typing inside a block's own form away from the editor's key handling. */
const isolateKeys = (event: React.KeyboardEvent) => event.stopPropagation();

function UrlForm({
  label,
  placeholder,
  submitLabel,
  validate,
  onSubmit,
}: {
  label: string;
  placeholder: string;
  submitLabel: string;
  validate: (value: string) => string | null;
  onSubmit: (value: string) => void;
}) {
  const [value, setValue] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const id = React.useId();
  return (
    <form
      className="flex w-full flex-wrap items-end gap-2 rounded-(--radius-sm) border border-dashed border-line p-3"
      onKeyDown={isolateKeys}
      onSubmit={(event) => {
        event.preventDefault();
        const problem = validate(value);
        if (problem) {
          setError(problem);
          return;
        }
        onSubmit(value.trim());
      }}
    >
      <div className="min-w-0 flex-1">
        <label htmlFor={id} className="mb-1 block text-caption font-medium text-ink">
          {label}
        </label>
        <Input
          id={id}
          type="url"
          inputMode="url"
          value={value}
          placeholder={placeholder}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          onChange={(event) => {
            setValue(event.target.value);
            setError(null);
          }}
        />
        {error ? (
          <p id={`${id}-error`} className="mt-1 text-caption text-danger-fg">
            {error}
          </p>
        ) : null}
      </div>
      <Button type="submit" size="sm" variant="secondary">
        {submitLabel}
      </Button>
    </form>
  );
}

export function createWorkspaceBlocks(t: EditorT) {
  const callout = createReactBlockSpec(
    {
      type: "callout",
      propSchema: { tone: { default: "info" as CalloutTone, values: calloutTones } },
      content: "inline",
    },
    framed("callout", {
      render: ({ block, editor, contentRef }) => {
        const tone = (calloutTones as readonly string[]).includes(block.props.tone)
          ? (block.props.tone as CalloutTone)
          : "info";
        const { box, Icon } = toneStyle[tone];
        return (
          <div role="note" aria-label={t(`callout.${tone}`)} className={cn("flex w-full gap-3 rounded-(--radius-sm) border-l-4 p-3", box)}>
            <Icon className="mt-0.5 size-5 shrink-0 text-ink" aria-hidden />
            <div className="min-w-0 flex-1" ref={contentRef} />
            {editor.isEditable ? (
              <div contentEditable={false} onKeyDown={isolateKeys} className="shrink-0">
                <Select
                  aria-label={t("callout.tone")}
                  value={tone}
                  className="h-8 w-auto text-caption"
                  onChange={(event) => editor.updateBlock(block, { props: { tone: event.target.value as CalloutTone } })}
                >
                  {calloutTones.map((value) => (
                    <option key={value} value={value}>
                      {t(`callout.${value}`)}
                    </option>
                  ))}
                </Select>
              </div>
            ) : null}
          </div>
        );
      },
    }),
  );

  const bookmark = createReactBlockSpec(
    { type: "bookmark", propSchema: { url: { default: "" } }, content: "none" },
    framed("bookmark", {
      render: ({ block, editor }) => {
        const url = safeBookmarkUrl(block.props.url);
        if (!url) {
          if (!editor.isEditable) return <span />;
          return (
            <UrlForm
              label={t("bookmark.inputLabel")}
              placeholder={t("bookmark.placeholder")}
              submitLabel={t("bookmark.add")}
              validate={(value) => (safeBookmarkUrl(value) ? null : t("bookmark.invalid"))}
              onSubmit={(value) => editor.updateBlock(block, { props: { url: safeBookmarkUrl(value)! } })}
            />
          );
        }
        const parsed = new URL(url);
        return (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer nofollow"
            aria-label={t("bookmark.open", { url: parsed.hostname })}
            className="flex w-full items-center gap-3 rounded-(--radius-sm) border border-line bg-surface p-3 text-ink no-underline hover:bg-surface-soft"
          >
            <Link2 className="size-5 shrink-0 text-muted" aria-hidden />
            <span className="min-w-0">
              <span className="block truncate font-medium">{parsed.hostname}</span>
              <span className="block truncate text-caption text-muted">{url}</span>
            </span>
            <ExternalLink className="ml-auto size-4 shrink-0 text-muted" aria-hidden />
          </a>
        );
      },
    }),
  );

  const embed = createReactBlockSpec(
    { type: "embed", propSchema: { url: { default: "" } }, content: "none" },
    framed("embed", {
      render: ({ block, editor }) => {
        const raw = block.props.url;
        if (!raw) {
          if (!editor.isEditable) return <span />;
          return (
            <UrlForm
              label={t("embed.inputLabel")}
              placeholder={t("embed.placeholder")}
              submitLabel={t("embed.add")}
              validate={(value) => (embedFor(value) ? null : t("embed.unsupported"))}
              onSubmit={(value) => editor.updateBlock(block, { props: { url: value } })}
            />
          );
        }
        const target = embedFor(raw);
        if (!target) {
          return (
            <p role="note" className="w-full rounded-(--radius-sm) border border-line p-3 text-body-sm text-muted">
              {t("embed.unsupported")}
            </p>
          );
        }
        const provider = { youtube: "YouTube", vimeo: "Vimeo", google: "Google", loom: "Loom" }[target.provider];
        return (
          <figure className="w-full">
            <div className="aspect-video w-full overflow-hidden rounded-(--radius-sm) border border-line bg-surface-soft">
              <iframe
                src={target.src}
                title={t("embed.frameTitle", { provider })}
                className="size-full"
                loading="lazy"
                referrerPolicy="strict-origin-when-cross-origin"
                sandbox="allow-scripts allow-same-origin allow-popups allow-presentation"
                allow="fullscreen; picture-in-picture"
              />
            </div>
            <figcaption className="mt-1 text-caption">
              <a href={raw} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex min-h-6 items-center text-muted underline hover:text-ink">
                {t("embed.openOriginal")}
              </a>
            </figcaption>
          </figure>
        );
      },
    }),
  );

  return { callout, bookmark, embed };
}
