/* Wave 2 unit C1: presence and live co-editing. Only C1 edits this file. */
"use client";

import * as React from "react";
import type * as Y from "yjs";
import { Awareness, removeAwarenessStates } from "y-protocols/awareness";
import { authorizeRealtime, createSupabaseBrowserClient } from "@/lib/supabase/client";
import { CONTENT_VERSION, type EditorBlock } from "@/features/editor/adapter/content";
import { bytesToBase64 } from "@/features/editor/adapter/state";
import type { EditorT } from "@/features/editor/i18n";
import { supabaseBroadcastTransport } from "@/features/editor/spike/supabase-transport";
import { YjsBroadcastProvider } from "@/features/editor/spike/yjs-broadcast-provider";
import { othersOnlyAwareness } from "@/features/editor/live/cursor-awareness";
import { lineageOf, stampLineage } from "@/features/editor/live/lineage";
import { lineageTransport } from "@/features/editor/live/lineage-transport";
import { registerLiveCopy } from "@/features/editor/live/live-save";
import { updatePageLive, usePageLive } from "@/features/pages/live/presence-store";
import { encodeStateAsUpdate } from "yjs";
import {
  NO_SPECS,
  type EditorUnitBlockSpecs,
  type EditorUnitCreateContext,
  type EditorUnitOptions,
  type EditorUnitProps,
} from "./types";

/**
 * Wave 2 unit C1: live co-editing on pages (switches wos_pages + wos_editor).
 *
 * People who can edit a page share its Yjs document over the page's private
 * Realtime channel (page-edit:<id>, joinable only by its editors), see each
 * other's cursors with names and colours, and save without conflicts
 * (editor/live/live-save.ts). Copies that cannot be merged safely (lineage.ts)
 * stay apart, and the editor says who else is editing so nobody is surprised
 * by the conflict that may follow.
 *
 * The session starts only once the page header (c1-page-presence.tsx), which
 * is rendered with both switches on, has said who the reader is: with either
 * switch off nothing is sent, joined or shown. (The editor of a page is still
 * created with an idle awareness object and BlockNote's cursor plugin, since
 * the editor's options are fixed when it is created, before the switches are
 * known; with nobody to show, both stay inert.)
 */

/** Live changes are batched this long (the W0-6 spike's production advice). */
const FLUSH_MS = 100;
/** Someone editing a copy of another lineage counts as present this long after their last message. */
const APART_MS = 40_000;
/** Someone editing who has not joined this copy live after this long is editing apart. */
const NOT_LIVE_GRACE_MS = 10_000;

interface LiveSetup {
  awareness: Awareness;
  lineage: string;
}

/** The live setup of each editor's document, made when the editor is created. */
const setups = new WeakMap<Y.Doc, LiveSetup>();

/** The page a document belongs to, from the editor's object path. */
export function pageIdFromPath(objectPath: string | undefined): string | null {
  const match = /^\/pages\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(objectPath ?? "");
  return match ? match[1].toLowerCase() : null;
}

/** Another person's cursor: a caret and a label in their colour, hidden from screen readers (the header lists people). */
export function renderLiveCursor(user: { name: string; color: string }): HTMLElement {
  const base = document.createElement("span");
  base.className = "bn-collaboration-cursor__base c1-cursor";
  base.setAttribute("aria-hidden", "true");
  base.dataset.c1Cursor = user.name;
  const caret = document.createElement("span");
  caret.setAttribute("contenteditable", "false");
  caret.className = "bn-collaboration-cursor__caret c1-cursor__caret";
  caret.style.backgroundColor = user.color;
  const label = document.createElement("span");
  label.className = "bn-collaboration-cursor__label c1-cursor__label";
  label.style.backgroundColor = user.color;
  label.textContent = user.name;
  caret.append(label);
  base.append(document.createTextNode("⁠"), caret, document.createTextNode("⁠"));
  return base;
}

/** Options added to the editor when it is created (memoize what you return). */
export const useC1Options: (ctx: EditorUnitCreateContext) => EditorUnitOptions = (ctx) => {
  const live = Boolean(pageIdFromPath(ctx.objectPath)) && ctx.editable;
  // Read before the editor touches the document: the lineage is the state as loaded.
  const [setup] = React.useState<LiveSetup | null>(() => {
    if (!live) return null;
    const existing = setups.get(ctx.doc);
    if (existing) return existing;
    const made = { awareness: new Awareness(ctx.doc), lineage: lineageOf(ctx.doc) };
    setups.set(ctx.doc, made);
    return made;
  });
  return React.useMemo<EditorUnitOptions>(
    () =>
      setup
        ? {
            collaboration: {
              // Only other people's changes redraw cursors: a redraw of this
              // copy's own cursor would add steps to the undo history.
              provider: { awareness: othersOnlyAwareness(setup.awareness) },
              user: { name: "", color: "var(--color-avatar-3)" },
              showCursorLabels: "always",
              renderCursor: renderLiveCursor,
            },
          }
        : {},
    [setup],
  );
};

/** Block specs added or replaced by type key. */
export const c1BlockSpecs: EditorUnitBlockSpecs = () => NO_SPECS;

/** Rendered inside BlockNoteView (menus, toolbars, controllers). */
export const C1InView: (props: EditorUnitProps) => React.ReactNode = () => null;

/** "A", "A and B", "A, B and C". */
export function joinNames(names: string[], t: EditorT): string {
  if (names.length <= 1) return names[0] ?? "";
  return t("units.c1.and", { first: names.slice(0, -1).join(", "), last: names[names.length - 1] });
}

/** Rendered after the editor, inside its container (dialogs, panels, live regions). */
export const C1Outside: (props: EditorUnitProps) => React.ReactNode = ({ editor, doc, editable, objectPath, t }) => {
  const pageId = pageIdFromPath(objectPath);
  const owned = setups.get(doc) ?? null;
  const setup = editable ? owned : null;
  const { me, people, livePeers } = usePageLive(setup ? pageId : null);
  const [apart, setApart] = React.useState<Record<string, number>>({});
  const [said, setSaid] = React.useState("");
  const userId = me?.userId ?? null;
  const name = me?.name ?? "";
  const colour = me?.colour ?? "";

  // The awareness lives as long as the editor (a remount makes a new one).
  // Destroyed a tick later, so a development double mount keeps it.
  const pendingDestroy = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  // Tied to the document, not to editing: a save refused for a moment turns
  // editing off and on again without a new editor.
  React.useEffect(() => {
    if (!owned) return;
    if (pendingDestroy.current) clearTimeout(pendingDestroy.current);
    pendingDestroy.current = null;
    return () => {
      pendingDestroy.current = setTimeout(() => owned.awareness.destroy(), 0);
    };
  }, [owned]);

  React.useEffect(() => {
    if (!setup || !pageId || !userId) return;
    const { awareness, lineage } = setup;
    stampLineage(doc, lineage);
    // Not setLocalStateField: it does nothing once the state was removed (on
    // leaving, or by an earlier run of this effect).
    const announce = () =>
      awareness.setLocalState({
        ...(awareness.getLocalState() ?? {}),
        user: { name: name || t("units.c1.someone"), color: colour, userId },
      });
    announce();

    const unregister = registerLiveCopy(pageId, {
      doc,
      lineage,
      snapshot: () => ({
        content: { version: CONTENT_VERSION, blocks: JSON.parse(JSON.stringify(editor.document)) as EditorBlock[] },
        state: bytesToBase64(encodeStateAsUpdate(doc)),
      }),
    });

    const readPeers = () => {
      const ids = new Set<string>();
      awareness.getStates().forEach((state, clientId) => {
        if (clientId === doc.clientID) return;
        const id = (state as { user?: { userId?: unknown } }).user?.userId;
        if (typeof id === "string" && id !== userId) ids.add(id);
      });
      updatePageLive(pageId, { livePeers: [...ids].sort() });
    };
    awareness.on("change", readPeers);

    const supabase = createSupabaseBrowserClient();
    let provider: YjsBroadcastProvider | null = null;
    let cancelled = false;
    void authorizeRealtime(supabase)
      .then(() => {
        if (cancelled) return;
        const transport = lineageTransport(
          supabaseBroadcastTransport(supabase, `page-edit:${pageId}`),
          lineage,
          userId,
          (other) => {
            if (other === userId) return;
            setApart((current) => {
              const at = Date.now();
              // Several messages a second can arrive; a fresh mark is enough.
              return at - (current[other] ?? 0) < 5_000 ? current : { ...current, [other]: at };
            });
          },
        );
        provider = new YjsBroadcastProvider(doc, transport, { flushMs: FLUSH_MS }, awareness);
      })
      .catch(() => undefined);

    // Leaving the page: say so at once rather than letting the cursor time
    // out. A page kept in the back-forward cache joins again when shown.
    const hide = () => {
      removeAwarenessStates(awareness, [doc.clientID], "local");
      provider?.disconnect();
    };
    const show = (event: PageTransitionEvent) => {
      if (!event.persisted || !provider) return;
      announce();
      provider.connect();
    };
    window.addEventListener("pagehide", hide);
    window.addEventListener("pageshow", show);
    return () => {
      cancelled = true;
      window.removeEventListener("pagehide", hide);
      window.removeEventListener("pageshow", show);
      awareness.off("change", readPeers);
      removeAwarenessStates(awareness, [doc.clientID], "local");
      provider?.destroy();
      provider = null;
      unregister();
      updatePageLive(pageId, { livePeers: [] });
    };
  }, [setup, pageId, userId, name, colour, doc, editor, t]);

  // Someone who left the page leaves the text too (their cursor), whatever
  // their connection did. Only people the list showed before and no longer
  // does: someone who just joined live may not be in the list yet.
  const wasPresent = React.useRef<Set<string>>(new Set());
  React.useEffect(() => {
    const present = new Set(people.map((person) => person.userId));
    const left = [...wasPresent.current].filter((id) => !present.has(id));
    wasPresent.current = present;
    if (!setup || left.length === 0) return;
    const gone: number[] = [];
    setup.awareness.getStates().forEach((state, clientId) => {
      const id = (state as { user?: { userId?: unknown } }).user?.userId;
      if (clientId !== doc.clientID && typeof id === "string" && left.includes(id)) gone.push(clientId);
    });
    if (gone.length > 0) removeAwarenessStates(setup.awareness, gone, "c1-presence");
  }, [people, setup, doc]);

  // Joins and leaves of the live session, said once to screen readers.
  const previous = React.useRef<string[]>([]);
  React.useEffect(() => {
    const before = previous.current;
    previous.current = livePeers;
    const nameOf = (id: string) => people.find((person) => person.userId === id)?.name || t("units.c1.someone");
    const joined = livePeers.filter((id) => !before.includes(id));
    const left = before.filter((id) => !livePeers.includes(id));
    if (joined.length > 0) setSaid(t("units.c1.joined", { name: joinNames(joined.map(nameOf), t) }));
    else if (left.length > 0) setSaid(t("units.c1.left", { name: joinNames(left.map(nameOf), t) }));
  }, [livePeers, people, t]);

  // Others editing whose changes do not reach this copy live: known to be
  // apart (another lineage), or still not live after a grace period (the
  // channel may be unreachable). Re-checked every few seconds.
  const [overdue, setOverdue] = React.useState<string[]>([]);
  const [now, setNow] = React.useState(() => Date.now());
  const notLiveSince = React.useRef<Record<string, number>>({});
  const others = userId
    ? people.filter((person) => person.editing && person.userId !== userId && !livePeers.includes(person.userId))
    : [];
  const othersKey = others.map((person) => person.userId).join(",");
  React.useEffect(() => {
    const since = notLiveSince.current;
    const ids = othersKey ? othersKey.split(",") : [];
    for (const id of Object.keys(since)) if (!ids.includes(id)) delete since[id];
    for (const id of ids) since[id] ??= Date.now();
    if (ids.length === 0) return;
    const check = () => {
      const at = Date.now();
      setNow(at);
      setOverdue((current) => {
        const next = ids.filter((id) => at - since[id] >= NOT_LIVE_GRACE_MS);
        return next.join(",") === current.join(",") ? current : next;
      });
    };
    const timer = setInterval(check, 2_000);
    return () => clearInterval(timer);
  }, [othersKey]);

  if (!setup || !userId) return null;

  const apartNow = others.filter((person) => {
    const heard = apart[person.userId];
    return (heard !== undefined && now - heard < APART_MS) || overdue.includes(person.userId);
  });
  const names = apartNow.map((person) => person.name || t("units.c1.someone"));

  return (
    <>
      {names.length > 0 ? (
        <p role="status" data-testid="c1-also-editing" className="c1-also-editing mt-2 text-caption">
          {t(names.length === 1 ? "units.c1.alsoEditingOne" : "units.c1.alsoEditingMany", { names: joinNames(names, t) })}
        </p>
      ) : null}
      <p className="sr-only" aria-live="polite" data-testid="c1-live-announcer">
        {said}
      </p>
    </>
  );
};
