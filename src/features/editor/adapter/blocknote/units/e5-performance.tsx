"use client";

import "./e5-performance.css";
import * as React from "react";
import { useBlockNoteContext } from "@blocknote/react";
import { useEditorT } from "@/features/editor/i18n/client";
import {
  LAZY_ROOT_MARGIN_PX,
  findableText,
  placeholderHeight,
  readHeights,
  rememberHeight,
  shouldWait,
  writeHeights,
  type LazyBlockInfo,
  type LazyBlockType,
} from "@/features/editor/adapter/performance/lazy";
import { EDITOR_MARKS, markEditor } from "@/features/editor/adapter/performance/timings";
import {
  NO_OPTIONS,
  NO_SPECS,
  type EditorUnitBlockSpecs,
  type EditorUnitCreateContext,
  type EditorUnitOptions,
  type EditorUnitProps,
} from "./types";

/**
 * Wave 2 unit E5: speed on long pages. Only E5 edits this file and e5-performance.css.
 *
 * - View blocks and embeds wait until they are near the screen, keeping their
 *   last measured height (or an estimate) so nothing jumps, and showing their
 *   title or address, so the browser's find in page still reaches them (the
 *   match scrolls the block near the screen, and it renders).
 * - The editor marks when it opened and when typing works (see
 *   ../../performance/timings.ts).
 */

export const useE5Options: (ctx: EditorUnitCreateContext) => EditorUnitOptions = () => NO_OPTIONS;

export const e5BlockSpecs: EditorUnitBlockSpecs = () => NO_SPECS;

/** The longest the editor stays hidden waiting for its custom blocks. */
const READY_CAP_MS = 1_000;

/**
 * Holds the editor's text invisible (but laid out) until its custom blocks
 * have rendered, then marks the open and interactive times once per editor.
 *
 * BlockNote paints plain text one frame before the blocks it renders with
 * React (table of contents, views, embeds), which then push the text down:
 * a visible jump on every page that has one near the top.
 */
export function E5InView({ editor, containerRef, editable, objectPath }: EditorUnitProps) {
  React.useEffect(() => {
    let cancelled = false;
    const frames: number[] = [];
    const timers: ReturnType<typeof setTimeout>[] = [];
    let idle: number | null = null;
    const started = performance.now();
    const detail = () => ({ objectPath: objectPath ?? "", blocks: editor.document.length });

    const markInteractive = () => {
      if (cancelled || !editor.isEditable) return;
      markEditor(performance, EDITOR_MARKS.interactive, detail());
    };
    // The first idle moment after the blocks are painted: a key pressed then
    // is handled at once, not queued behind the rest of the page's work.
    const afterOpen = () => {
      if (!editable) return;
      if (typeof window.requestIdleCallback === "function") idle = window.requestIdleCallback(markInteractive, { timeout: 5_000 });
      else timers.push(setTimeout(markInteractive, 0));
    };
    const open = (root: HTMLElement) => {
      root.setAttribute(READY_ATTRIBUTE, "");
      // The next frame paints the blocks; mark just after it.
      frames.push(
        requestAnimationFrame(() => {
          timers.push(
            setTimeout(() => {
              if (cancelled) return;
              markEditor(performance, EDITOR_MARKS.open, detail());
              afterOpen();
            }, 0),
          );
        }),
      );
    };
    // Child effects run before BlockNote mounts the document, so wait for its
    // first block and for every custom block's view, frame by frame.
    const waitForBlocks = () => {
      if (cancelled) return;
      const root = containerRef.current;
      const ready =
        root?.querySelector(".bn-editor .bn-block-outer") && !root.querySelector(".bn-editor .react-renderer:empty");
      if (root && (ready || performance.now() - started > READY_CAP_MS)) open(root);
      else frames.push(requestAnimationFrame(waitForBlocks));
    };
    waitForBlocks();
    return () => {
      cancelled = true;
      frames.forEach((frame) => cancelAnimationFrame(frame));
      timers.forEach((timer) => clearTimeout(timer));
      if (idle !== null) window.cancelIdleCallback?.(idle);
    };
  }, [editor, containerRef, editable, objectPath]);
  return null;
}

/** Set on the editor's container once its blocks have all rendered (see the CSS). */
const READY_ATTRIBUTE = "data-blocks-ready";

/** How long a table of contents jump holds its heading in place. */
const HOLD_MS = 2_000;

/**
 * After a table of contents link is followed, keeps its heading where it
 * landed while the view blocks and embeds around it render (they change
 * height, and the browser's own scroll anchoring does not always pick the
 * heading). Anything the person does (scroll, click, key) ends the hold.
 */
export function E5Outside({ containerRef }: EditorUnitProps) {
  React.useEffect(() => {
    let stop: (() => void) | null = null;
    const hold = (target: HTMLElement) => {
      stop?.();
      let frame = requestAnimationFrame(() => {
        const landed = target.getBoundingClientRect().top;
        const until = performance.now() + HOLD_MS;
        const keep = () => {
          if (!target.isConnected || performance.now() > until) return release();
          const drift = target.getBoundingClientRect().top - landed;
          if (Math.abs(drift) > 1) window.scrollBy(0, drift);
          frame = requestAnimationFrame(keep);
        };
        frame = requestAnimationFrame(keep);
      });
      const release = () => {
        cancelAnimationFrame(frame);
        for (const type of RELEASE_EVENTS) window.removeEventListener(type, release, true);
        stop = null;
      };
      for (const type of RELEASE_EVENTS) window.addEventListener(type, release, { capture: true, passive: true });
      stop = release;
    };
    // After the link's own handler (or the browser's #anchor jump) has scrolled.
    const onClick = (event: MouseEvent) => {
      const link = (event.target as Element | null)?.closest?.<HTMLAnchorElement>("a.qbbe-toc-link");
      if (!link || !containerRef.current?.contains(link)) return;
      const id = decodeURIComponent(link.hash.slice(1));
      const target = id ? document.getElementById(id) : null;
      if (target) hold(target);
    };
    document.addEventListener("click", onClick);
    return () => {
      document.removeEventListener("click", onClick);
      stop?.();
    };
  }, [containerRef]);
  return null;
}

const RELEASE_EVENTS = ["wheel", "touchstart", "keydown", "pointerdown"] as const;

// --- Lazy blocks (used by ../block-frame.tsx for every custom block) --------

/** Blocks already shown in this tab render at once when they mount again. */
const shownBlocks = new Set<string>();
let heights: Map<string, number> | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function sessionStore(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function rememberedHeights(): Map<string, number> {
  heights ??= readHeights(sessionStore());
  return heights;
}

function remember(blockId: string, height: number) {
  if (!rememberHeight(rememberedHeights(), blockId, height) || saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    writeHeights(sessionStore(), rememberedHeights());
  }, 500);
}

function canObserve(): boolean {
  return typeof window !== "undefined" && typeof window.IntersectionObserver === "function";
}

/** The block's type and props, read from the editor around the block. */
function useBlockInfo(type: string, blockId: string): LazyBlockInfo | null {
  const context = useBlockNoteContext();
  const editor = context?.editor as { getBlock(id: string): { type: string; props: Record<string, unknown> } | undefined } | undefined;
  if (!editor) return { type };
  try {
    const block = editor.getBlock(blockId);
    return block ? { type: block.type, props: block.props } : { type };
  } catch {
    return { type };
  }
}

/**
 * Wraps every custom block's view. View blocks and embeds wait until they are
 * within LAZY_ROOT_MARGIN_PX of the screen; while they wait they keep their
 * space and show their title or address. Everything else renders at once.
 */
export function LazyBlock({ type, blockId, children }: { type: string; blockId: string; children: React.ReactNode }) {
  const block = useBlockInfo(type, blockId);
  const wait = shouldWait(block, canObserve());
  const [shown, setShown] = React.useState(() => !wait || shownBlocks.has(blockId));
  const placeholderRef = React.useRef<HTMLDivElement>(null);
  // The element the block's view renders into, measured once it is shown.
  const hostRef = React.useRef<HTMLElement | null>(null);

  const reveal = React.useCallback(() => {
    shownBlocks.add(blockId);
    setShown(true);
  }, [blockId]);

  // A block already near the screen when it mounts renders before the first
  // paint, so it never shows as waiting. One drawn outside the page (BlockNote
  // draws blocks off-page for the HTML it puts on the clipboard) renders at
  // once: nothing would ever scroll it near the screen.
  React.useLayoutEffect(() => {
    const placeholder = placeholderRef.current;
    if (shown || !wait || !placeholder) return;
    if (!placeholder.isConnected) {
      setShown(true);
      return;
    }
    hostRef.current = placeholder.parentElement;
    const rect = placeholder.getBoundingClientRect();
    if (rect.height > 0 && rect.bottom >= -LAZY_ROOT_MARGIN_PX && rect.top <= window.innerHeight + LAZY_ROOT_MARGIN_PX) reveal();
  }, [shown, wait, reveal]);

  React.useEffect(() => {
    if (shown || !wait) return;
    const placeholder = placeholderRef.current;
    if (!placeholder) return;
    hostRef.current = placeholder.parentElement;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) reveal();
      },
      { rootMargin: `${LAZY_ROOT_MARGIN_PX}px 0px` },
    );
    observer.observe(placeholder);
    return () => observer.disconnect();
  }, [shown, wait, reveal]);

  // Remember the shown block's height for the next time it waits.
  React.useEffect(() => {
    const host = hostRef.current;
    if (!shown || !host || typeof ResizeObserver !== "function") return;
    // The content box: the placeholder's min-height fills the same box.
    const observer = new ResizeObserver((entries) => {
      const height = entries.at(-1)?.contentRect.height;
      if (height) remember(blockId, height);
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, [shown, blockId]);

  if (shown || !wait || !block) return children;
  return <LazyPlaceholder ref={placeholderRef} block={block} blockId={blockId} />;
}

function LazyPlaceholder({ ref, block, blockId }: { ref: React.Ref<HTMLDivElement>; block: LazyBlockInfo; blockId: string }) {
  const t = useEditorT();
  const type = block.type as LazyBlockType;
  const text = findableText(block);
  return (
    <div
      ref={ref}
      className="qbbe-lazy-block"
      data-lazy-block={type}
      data-lazy-id={blockId}
      contentEditable={false}
      style={{ minHeight: placeholderHeight(type, rememberedHeights().get(blockId)) }}
    >
      {text ? <span className="qbbe-lazy-name">{text}</span> : null}
      <span className="qbbe-lazy-label">{t(`units.e5.waiting.${type}`)}</span>
    </div>
  );
}
