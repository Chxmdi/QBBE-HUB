"use client";

import "@blocknote/ariakit/style.css";
import "./editor-spike.css";
import { useEffect, useMemo, useRef, useState } from "react";
import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import type { PartialBlock } from "@blocknote/core";
import { withCollaboration } from "@blocknote/core/yjs";
import { en, fr } from "@blocknote/core/locales";
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/ariakit";
import { useLocale } from "@/lib/i18n/client";
import { authorizeRealtime, createSupabaseBrowserClient } from "@/lib/supabase/client";
import { applyRandomEdit, seededRandom, tokensIn } from "./fuzz";
import { SupabaseYjsPersistence } from "./supabase-persistence";
import { supabaseBroadcastTransport } from "./supabase-transport";
import { toBase64, YjsBroadcastProvider, type ProviderStatus } from "./yjs-broadcast-provider";

/**
 * W0-5 / W0-6 spike page body. Never shipped: see ./enabled.ts.
 *
 * Without `docId` it is a single-user editor with sample content, for the
 * accessibility checks. With `docId` it joins that shared document over
 * Supabase Realtime and stores it in the local spike table.
 */

const COPY = {
  en: {
    title: "Editor spike",
    intro: "Wave 0 experiment. Not a product page; never served in production.",
    shared: "Shared document",
    solo: "Single-user document with sample content",
    status: { connecting: "Connecting…", connected: "Connected", disconnected: "Offline — changes are kept and sent on reconnect" },
    loading: "Loading the document…",
    editorLabel: "Document content",
    keyboardHint:
      "Type / for blocks. Alt+F10 moves to the formatting toolbar. Escape, then Tab, leaves the editor. Ctrl+Shift+Up or Down moves a block.",
  },
  "fr-CA": {
    title: "Essai de l’éditeur",
    intro: "Expérience de la vague 0. Ce n’est pas une page du produit; elle n’est jamais servie en production.",
    shared: "Document partagé",
    solo: "Document à une personne, avec du contenu d’exemple",
    status: { connecting: "Connexion…", connected: "Connecté", disconnected: "Hors ligne — les modifications sont gardées et envoyées au retour" },
    loading: "Chargement du document…",
    editorLabel: "Contenu du document",
    keyboardHint:
      "Tapez / pour les blocs. Alt+F10 mène à la barre de mise en forme. Échap, puis Tab, quitte l’éditeur. Ctrl+Maj+Haut ou Bas déplace un bloc.",
  },
} as const;

const SAMPLE: Record<"en" | "fr-CA", PartialBlock[]> = {
  en: [
    { type: "heading", props: { level: 2 }, content: "Board meeting notes" },
    { type: "paragraph", content: "Type / for the block menu. Select text for formatting." },
    { type: "bulletListItem", content: "Review the budget" },
    { type: "checkListItem", content: "Send the minutes" },
  ],
  "fr-CA": [
    { type: "heading", props: { level: 2 }, content: "Notes de la réunion du conseil" },
    { type: "paragraph", content: "Tapez / pour le menu des blocs. Sélectionnez du texte pour la mise en forme." },
    { type: "bulletListItem", content: "Réviser le budget" },
    { type: "checkListItem", content: "Envoyer le procès-verbal" },
  ],
};

// Collaborator cursor colours, from the design tokens so both themes work.
const COLORS = [
  "var(--color-brand-fg)",
  "var(--color-success-fg)",
  "var(--color-danger-fg)",
  "var(--color-info-fg)",
  "var(--color-accent-fg)",
];

function useDocumentTheme(): "light" | "dark" {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  useEffect(() => {
    const root = document.documentElement;
    const read = () => setTheme(root.classList.contains("dark") ? "dark" : "light");
    read();
    const observer = new MutationObserver(read);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  return theme;
}

/**
 * Keyboard mitigations (W0-5), on a capture listener around the editor so
 * they run before ProseMirror sees the key:
 *
 * - Alt+F10 moves focus into the formatting toolbar (the WAI-ARIA toolbar
 *   convention); Escape there returns to the text. Without it the toolbar is
 *   mouse-only.
 * - Escape (with no menu open) arms the next Tab or Shift+Tab to leave the
 *   editor, as CodeMirror does. BlockNote otherwise keeps Tab for nesting,
 *   table cells and code indentation, and from a nestable block no key
 *   leaves the editor (WCAG 2.1.2 No Keyboard Trap).
 */
function useKeyboardMitigations(enabled: boolean) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const root = ref.current;
    if (!enabled || !root) return;
    let leaveArmed = false;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const editorEl = root.querySelector<HTMLElement>(".bn-editor");
      const inEditor = Boolean(editorEl?.contains(target));
      const inToolbar = Boolean(target.closest?.("[role=toolbar]"));
      if (event.key === "F10" && event.altKey && inEditor) {
        const first = document.querySelector<HTMLElement>(
          ".bn-formatting-toolbar button:not([disabled]), .bn-formatting-toolbar [role=combobox]",
        );
        if (first) {
          event.preventDefault();
          event.stopPropagation();
          first.focus();
        }
        return;
      }
      if (event.key === "Escape" && inToolbar) {
        event.preventDefault();
        editorEl?.focus();
        return;
      }
      if (event.key === "Escape" && inEditor && editorEl?.getAttribute("aria-expanded") !== "true") {
        leaveArmed = true;
        return;
      }
      if (event.key === "Tab" && inEditor && leaveArmed) {
        // Let the browser move focus; keep ProseMirror from indenting.
        event.stopPropagation();
        leaveArmed = false;
        return;
      }
      if (!["Shift", "Control", "Alt", "Meta"].includes(event.key)) leaveArmed = false;
    };
    // The toolbar is portalled outside the editor, so listen on the document.
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [enabled]);
  return ref;
}

export default function EditorSpikeInner({
  docId,
  raw = false,
  flushMs,
}: {
  docId: string | null;
  raw?: boolean;
  flushMs?: number;
}) {
  const locale = useLocale();
  const copy = COPY[locale];
  const theme = useDocumentTheme();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [doc] = useState(() => new Y.Doc());
  const [awareness] = useState(() => new Awareness(doc));
  const [status, setStatus] = useState<ProviderStatus>("connecting");
  const [loaded, setLoaded] = useState(docId === null);

  const dictionary = locale === "fr-CA" ? fr : en;
  const sectionRef = useKeyboardMitigations(!raw);
  const domAttributes = raw
    ? undefined
    : { editor: { "aria-label": copy.editorLabel, "aria-describedby": "editor-spike-hint" } };
  const editor = useCreateBlockNote(
    docId
      ? withCollaboration({
          dictionary,
          domAttributes,
          collaboration: {
            fragment: doc.getXmlFragment("document-store"),
            provider: { awareness },
            user: { name: "…", color: COLORS[doc.clientID % COLORS.length] },
          },
        })
      : { dictionary, domAttributes, initialContent: SAMPLE[locale] },
    [docId, locale, raw],
  );

  useEffect(() => {
    if (!docId) {
      exposeForTests({ editor, doc, provider: null, persistence: null });
      return;
    }
    let cancelled = false;
    let provider: YjsBroadcastProvider | null = null;
    let persistence: SupabaseYjsPersistence | null = null;
    let unsubscribe = () => {};

    (async () => {
      await authorizeRealtime(supabase);
      const { data } = await supabase.auth.getUser();
      if (cancelled) return;
      awareness.setLocalStateField("user", {
        name: data.user?.email ?? "?",
        color: COLORS[doc.clientID % COLORS.length],
      });
      persistence = new SupabaseYjsPersistence(doc, supabase, docId);
      await persistence.load();
      if (cancelled) return;
      setLoaded(true);
      provider = new YjsBroadcastProvider(doc, supabaseBroadcastTransport(supabase, `yjs-spike:${docId}`), { flushMs }, awareness);
      persistence.ignoreOrigin(provider);
      unsubscribe = provider.onStatusChange(setStatus);
      exposeForTests({ editor, doc, provider, persistence });
    })().catch((error) => console.error("[editor-spike]", error));

    return () => {
      cancelled = true;
      unsubscribe();
      provider?.destroy();
      void persistence?.flush().finally(() => persistence?.destroy());
    };
  }, [docId, doc, awareness, editor, supabase, flushMs]);

  return (
    <main id="main" className="mx-auto w-full max-w-3xl px-4 py-8">
      <h1 className="text-2xl font-semibold text-ink">{copy.title}</h1>
      <p className="mt-1 text-sm text-muted">{copy.intro}</p>
      <p className="mt-3 text-sm text-ink" role="status" data-testid="spike-status">
        {docId ? `${copy.shared} “${docId}” — ${copy.status[status]}` : copy.solo}
      </p>
      {raw ? null : (
        <p id="editor-spike-hint" className="mt-2 text-sm text-muted">
          {copy.keyboardHint}
        </p>
      )}
      <section
        ref={sectionRef}
        aria-label={copy.title}
        className={`mt-6 rounded-(--radius-sm) border border-line bg-surface py-4${raw ? "" : " qbbe-editor"}`}
      >
        {loaded ? <BlockNoteView editor={editor} theme={theme} /> : <p className="px-4">{copy.loading}</p>}
      </section>
    </main>
  );
}

type SpikeHandles = {
  editor: ReturnType<typeof useCreateBlockNote>;
  doc: Y.Doc;
  provider: YjsBroadcastProvider | null;
  persistence: SupabaseYjsPersistence | null;
};

/** Hooks the browser tests drive; the page has no other API. */
function exposeForTests({ editor, doc, provider, persistence }: SpikeHandles) {
  const fragment = doc.getXmlFragment("document-store");
  const random = { current: seededRandom(1) };
  // Diagnostics for W0-6: every transaction that deletes a whole element
  // (a block, not just characters), and where the transaction came from.
  const deletedElements: { at: number; names: string[]; local: boolean; fromPeer: boolean }[] = [];
  doc.on("afterTransaction", (tr: Y.Transaction) => {
    const names = new Set<string>();
    Y.iterateDeletedStructs(tr, tr.deleteSet, (struct) => {
      if (struct instanceof Y.Item && struct.content instanceof Y.ContentType) {
        const type = struct.content.type;
        names.add(type instanceof Y.XmlElement ? type.nodeName : type.constructor.name);
      }
    });
    if (names.size) deletedElements.push({ at: Date.now(), names: [...names], local: tr.local, fromPeer: tr.origin === provider });
  });
  (window as unknown as { __editorSpike: unknown }).__editorSpike = {
    editor,
    doc,
    provider,
    persistence,
    ready: () => Boolean(provider?.synced) || provider === null,
    seed: (value: number) => {
      random.current = seededRandom(value);
    },
    edit: (side: "A" | "B", n: number, allowTurnInto = false) =>
      applyRandomEdit(editor, side, n, random.current, { allowTurnInto }),
    tokens: () => tokensIn(editor),
    docBytes: () => Y.encodeStateAsUpdate(doc).length,
    snapshot: () => ({
      stateVector: toBase64(Y.encodeStateVector(doc)),
      xml: fragment.toString(),
      blocks: JSON.stringify(editor.document),
    }),
    /** Inserts `text` at the end of the first block and returns the time just before. */
    stamp: (text: string) => {
      const first = editor.document[0];
      const at = Date.now();
      editor.insertBlocks([{ type: "paragraph", content: text }], first, "before");
      return at;
    },
    /** Resolves with the time `text` first appears in this editor. */
    waitFor: (text: string) =>
      new Promise<number>((resolve) => {
        const check = () => {
          if (editor.prosemirrorState.doc.textContent.includes(text)) {
            doc.off("afterTransaction", check);
            resolve(Date.now());
            return true;
          }
          return false;
        };
        if (!check()) doc.on("afterTransaction", check);
      }),
    stats: () => ({
      sent: provider?.sent ?? [],
      receiveDelaysMs: provider?.receiveDelaysMs ?? [],
      writes: persistence?.writes ?? [],
      unsaved: persistence?.unsavedChanges ?? 0,
      status: provider?.status ?? null,
      deletedElements,
    }),
  };
}
