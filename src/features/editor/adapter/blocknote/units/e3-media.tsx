"use client";

import * as React from "react";
import {
  audioParse,
  createAudioBlockConfig,
  createFileBlockConfig,
  createImageBlockConfig,
  createVideoBlockConfig,
  fileParse,
  imageParse,
  videoParse,
} from "@blocknote/core";
import { FilePanelExtension } from "@blocknote/core/extensions";
import {
  createReactBlockSpec,
  ResizableFileBlockWrapper,
  useDictionary,
  useExtension,
  useUploadLoading,
  type ReactCustomBlockRenderProps,
} from "@blocknote/react";
import { AudioLines, File as FileIcon, Image as ImageIcon, Video } from "lucide-react";
import type { EditorT } from "@/features/editor/i18n";
import { framed } from "../block-frame";
import { mediaAddress, mediaName, needsAltText, type MediaKind } from "./e3-helpers";

/**
 * Unit E3: image, video, audio and file blocks. Each one has a caption and an
 * accessible name, an image asks for alt text until it has some, and an empty,
 * refused, unavailable or broken file shows its own readable message instead
 * of an empty box (or breaking the page). The types and props are BlockNote's
 * own, plus `alt` on images, so saved pages open unchanged.
 */

// The image gains its own alt text; the file name is not a description.
const imageConfig = (() => {
  const base = createImageBlockConfig({});
  return { ...base, propSchema: { ...base.propSchema, alt: { default: "" as const } } } as const;
})();
const videoConfig = createVideoBlockConfig({});
const audioConfig = createAudioBlockConfig({});
const fileConfig = createFileBlockConfig();

interface MediaBlockProps {
  url: string;
  name: string;
  caption: string;
  alt?: string;
  showPreview?: boolean;
  previewWidth?: number;
}

type AnyMediaProps = Omit<ReactCustomBlockRenderProps<typeof fileConfig>, "contentRef" | "block"> & {
  block: { id: string; type: string; props: MediaBlockProps };
};

const ICONS: Record<MediaKind, typeof ImageIcon> = { image: ImageIcon, video: Video, audio: AudioLines, file: FileIcon };

/** Keeps typing in the block's own fields away from the editor's key handling. */
const isolateKeys = (event: React.KeyboardEvent) => event.stopPropagation();

type Resolved = { state: "loading" } | { state: "ready"; src: string } | { state: "unavailable" } | { state: "failed" };

/** What the server hands back is a signed web address (plain http only on a local stack). */
function servable(src: string): boolean {
  try {
    const { protocol } = new URL(src);
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}

/** The address to show: a library file once its scan has passed, or the secure link itself. */
function useResolvedAddress(editor: AnyMediaProps["editor"], url: string, attempt: number): Resolved {
  const key = `${attempt}:${url}`;
  const [resolved, setResolved] = React.useState<{ key: string; result: Resolved } | null>(null);
  React.useEffect(() => {
    let live = true;
    const resolve = editor.resolveFileUrl;
    const kind = mediaAddress(url);
    if (kind !== "library" && kind !== "link") return;
    void (async () => {
      let result: Resolved;
      try {
        // Resolved as checked: without the spaces a pasted address may carry.
        const address = url.trim();
        const src = resolve ? await resolve(address) : kind === "link" ? address : "";
        result = src && servable(src) ? { state: "ready", src } : { state: "unavailable" };
      } catch {
        result = { state: "failed" };
      }
      if (live) setResolved({ key, result });
    })();
    return () => {
      live = false;
    };
  }, [editor, url, key]);
  // A new address or a retry shows "loading" until its own answer arrives.
  return resolved?.key === key ? resolved.result : { state: "loading" };
}

/** A text field that saves when it loses focus or on Enter (keyed by its saved value, so it follows changes from elsewhere). */
function BlockField({
  label,
  value,
  placeholder,
  describedBy,
  onSave,
}: {
  label: string;
  value: string;
  placeholder: string;
  describedBy?: string;
  onSave: (value: string) => void;
}) {
  const [draft, setDraft] = React.useState(value);
  const id = React.useId();
  const save = () => {
    if (draft.trim() !== value) onSave(draft.trim());
  };
  return (
    <div className="qbbe-media-field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="text"
        value={draft}
        maxLength={500}
        placeholder={placeholder}
        aria-describedby={describedBy}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={save}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Enter") {
            event.preventDefault();
            save();
          }
          if (event.key === "Escape") setDraft(value);
        }}
      />
    </div>
  );
}

/** The button that opens BlockNote's upload and link panel, as a real button. */
function AddFileButton({ block, editor, label }: { block: AnyMediaProps["block"]; editor: AnyMediaProps["editor"]; label: string }) {
  const filePanel = useExtension(FilePanelExtension);
  return (
    <button
      type="button"
      className="qbbe-media-add"
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => editor.transact(() => filePanel.showMenu(block.id))}
    >
      {label}
    </button>
  );
}

function MediaPreview({ kind, src, props, name, t, onError }: { kind: MediaKind; src: string; props: AnyMediaProps; name: string; t: EditorT; onError: () => void }) {
  const p = props.block.props;
  if (kind === "file" || p.showPreview === false) {
    const Icon = ICONS[kind];
    return (
      <a className="qbbe-media-file" href={src} target="_blank" rel="noopener noreferrer nofollow" aria-label={t("units.e3.media.open", { name: typeof p.name === "string" && p.name.trim() ? p.name : name })}>
        <Icon className="size-5 shrink-0" aria-hidden />
        <span className="min-w-0 truncate">{p.name || src}</span>
      </a>
    );
  }
  if (kind === "audio") return <audio className="qbbe-media-audio" controls src={src} aria-label={name} onError={onError} />;
  // Images and videos keep BlockNote's resize handles. The caption is shown below.
  const block = { ...props.block, props: { ...p, caption: "" } };
  return (
    <ResizableFileBlockWrapper editor={props.editor as never} block={block as never}>
      {kind === "image" ? (
        // eslint-disable-next-line @next/next/no-img-element -- a signed library address, not a static asset
        <img className="bn-visual-media" src={src} alt={p.alt || p.caption || ""} width={p.previewWidth} draggable={false} contentEditable={false} onError={onError} />
      ) : (
        <video className="bn-visual-media" controls src={src} width={p.previewWidth} aria-label={name} contentEditable={false} onError={onError} />
      )}
    </ResizableFileBlockWrapper>
  );
}

function MediaBlockView(props: AnyMediaProps & { kind: MediaKind; t: EditorT }) {
  const { block, editor, kind, t } = props;
  const p = block.props;
  const editable = editor.isEditable;
  const dict = useDictionary();
  const uploading = useUploadLoading(block.id);
  const [attempt, setAttempt] = React.useState(0);
  // A load failure belongs to one address and attempt: a replaced file or a retry starts clean.
  const loadKey = `${attempt}:${p.url}`;
  const [brokenKey, setBrokenKey] = React.useState<string | null>(null);
  const broken = brokenKey === loadKey;
  const address = mediaAddress(p.url);
  const resolved = useResolvedAddress(editor, p.url, attempt);
  const name = mediaName(kind, p, t);
  const altHintId = React.useId();
  const retry = () => {
    setAttempt((n) => n + 1);
  };
  const update = (next: Partial<MediaBlockProps>) => editor.updateBlock(block.id, { props: next } as never);

  let body: React.ReactNode;
  if (uploading) {
    body = <p role="status" className="qbbe-media-note">{t("units.e3.media.uploading")}</p>;
  } else if (address === "empty") {
    body = (
      <div className="qbbe-media-empty">
        {editable ? (
          <>
            <AddFileButton block={block} editor={editor} label={dict.file_blocks.add_button_text[kind] ?? dict.file_blocks.add_button_text.file} />
            <p className="qbbe-media-note">{t(`units.e3.media.emptyHint.${kind}`)}</p>
          </>
        ) : (
          <p className="qbbe-media-note">{t(`units.e3.media.emptyReadOnly.${kind}`)}</p>
        )}
      </div>
    );
  } else if (address === "unsupported") {
    body = <p role="note" className="qbbe-media-note qbbe-media-problem">{t("units.e3.media.unsupported")}</p>;
  } else if (resolved.state === "loading") {
    body = <p role="status" className="qbbe-media-note">{t("units.e3.media.loading")}</p>;
  } else if (resolved.state === "ready" && !broken) {
    body = <MediaPreview kind={kind} src={resolved.src} props={props} name={name} t={t} onError={() => setBrokenKey(loadKey)} />;
  } else {
    body = (
      <div role="note" className="qbbe-media-note qbbe-media-problem">
        <span>{resolved.state === "unavailable" ? t("units.e3.media.unavailable") : t(`units.e3.media.failed.${kind}`)}</span>
        <button type="button" className="qbbe-media-retry" onClick={retry}>
          {t("units.e3.media.retry")}
        </button>
      </div>
    );
  }

  const hasFile = address !== "empty" && !uploading;
  return (
    <figure className="qbbe-media" data-media-kind={kind} aria-label={name}>
      {body}
      {hasFile && editable ? (
        <div className="qbbe-media-fields" contentEditable={false} onKeyDown={isolateKeys}>
          {kind === "image" ? (
            <>
              {needsAltText(p) ? (
                <p id={altHintId} role="note" className="qbbe-media-note qbbe-media-alt-missing">
                  {t("units.e3.media.altMissing")}
                </p>
              ) : null}
              <BlockField
                key={`alt:${p.alt ?? ""}`}
                label={t("units.e3.media.alt")}
                value={p.alt ?? ""}
                placeholder={t("units.e3.media.altPlaceholder")}
                describedBy={needsAltText(p) ? altHintId : undefined}
                onSave={(alt) => update({ alt })}
              />
            </>
          ) : null}
          <BlockField key={`caption:${p.caption}`} label={t("units.e3.media.caption")} value={p.caption} placeholder={t("units.e3.media.captionPlaceholder")} onSave={(caption) => update({ caption })} />
        </div>
      ) : null}
      {hasFile && !editable && p.caption ? <figcaption className="qbbe-media-caption">{p.caption}</figcaption> : null}
    </figure>
  );
}

/** A file block's view as a framed render, so a broken one shows the fallback. */
function mediaRender(kind: MediaKind, t: EditorT) {
  const Render = (props: object) => <MediaBlockView {...(props as AnyMediaProps)} kind={kind} t={t} />;
  Render.displayName = `MediaBlock(${kind})`;
  return Render;
}

/** What copy and export see: the file as a link or picture, with its caption. */
function mediaExternal(kind: MediaKind) {
  const External = ({ block }: { block: { props: MediaBlockProps } }) => {
    const p = block.props;
    if (!p.url) return <p />;
    const inner =
      kind === "image" ? (
        // eslint-disable-next-line @next/next/no-img-element -- exported HTML, not rendered by Next
        <img src={p.url} alt={p.alt || p.caption || ""} width={p.previewWidth} />
      ) : kind === "video" ? (
        <video src={p.url} controls />
      ) : kind === "audio" ? (
        <audio src={p.url} controls />
      ) : (
        <a href={p.url}>{p.name || p.url}</a>
      );
    return p.caption ? (
      <figure>
        {inner}
        <figcaption>{p.caption}</figcaption>
      </figure>
    ) : (
      inner
    );
  };
  External.displayName = `MediaExternal(${kind})`;
  return External;
}

/** Each media block's framed implementation (exported for its test). */
export function mediaImplementations(t: EditorT) {
  return {
    image: framed<typeof imageConfig>("image", {
      meta: { fileBlockAccept: ["image/*"] },
      parse: (element) => {
        const parsed = imageParse({})(element);
        // An imported image keeps its alt text as alt text.
        const img = element.tagName === "IMG" ? element : element.querySelector("img");
        return parsed ? { ...parsed, alt: img?.getAttribute("alt") ?? "" } : undefined;
      },
      render: mediaRender("image", t),
      toExternalHTML: mediaExternal("image") as never,
      runsBefore: ["file"],
    }),
    video: framed<typeof videoConfig>("video", {
      meta: { fileBlockAccept: ["video/*"] },
      parse: videoParse({}),
      render: mediaRender("video", t),
      toExternalHTML: mediaExternal("video") as never,
      runsBefore: ["file"],
    }),
    audio: framed<typeof audioConfig>("audio", {
      meta: { fileBlockAccept: ["audio/*"] },
      parse: audioParse({}),
      render: mediaRender("audio", t),
      toExternalHTML: mediaExternal("audio") as never,
      runsBefore: ["file"],
    }),
    file: framed<typeof fileConfig>("file", {
      meta: { fileBlockAccept: ["*/*"] },
      parse: fileParse(),
      render: mediaRender("file", t),
      toExternalHTML: mediaExternal("file") as never,
    }),
  };
}

export function createMediaBlocks(t: EditorT) {
  const views = mediaImplementations(t);
  return {
    image: createReactBlockSpec(imageConfig, views.image)(),
    video: createReactBlockSpec(videoConfig, views.video)(),
    audio: createReactBlockSpec(audioConfig, views.audio)(),
    file: createReactBlockSpec(fileConfig, views.file)(),
  };
}
