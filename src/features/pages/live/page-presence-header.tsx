"use client";

import * as React from "react";
import { usePagesT } from "@/features/pages/i18n/client";
import {
  othersOnPage,
  presenceColour,
  presenceInitials,
  PRESENCE_HEARTBEAT_MS,
  type PagePresencePerson,
} from "@/features/pages/services/page-presence";
import { touchPagePresence, type PresenceResult } from "@/features/pages/services/page-presence.commands";
import { clearPageLive, updatePageLive, type PresenceMe } from "./presence-store";

/** How many chips the header shows before "+N". */
const MAX_CHIPS = 3;

/**
 * Who else has this page open (wave 2, C1): a chip in each person's colour,
 * and a list with their names that opens from it. Each tab announces itself
 * every few seconds, reading the list back with the same request, and leaves
 * when it closes (a beacon the browser delivers during unload). Not a live
 * region: heartbeats would make a screen reader repeat the list.
 */
export function PagePresenceHeader({ pageId, me: given, canEdit }: { pageId: string; me: PresenceMe; canEdit: boolean }) {
  const t = usePagesT();
  const { userId, name, colour } = given;
  const me = React.useMemo<PresenceMe>(() => ({ userId, name, colour }), [userId, name, colour]);
  const [people, setPeople] = React.useState<PagePresencePerson[] | null>(null);
  const [state, setState] = React.useState<"loading" | "ready" | "error" | "refused">("loading");
  const [retrying, setRetrying] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const listId = React.useId();
  // One per open tab, so closing one of two tabs keeps the person present.
  const [tabId] = React.useState(() => crypto.randomUUID());
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);

  // The editor's live session starts once it knows who the reader is.
  React.useEffect(() => {
    updatePageLive(pageId, { me });
    return () => clearPageLive(pageId);
  }, [pageId, me]);

  const apply = React.useCallback(
    (result: PresenceResult) => {
      if (result.ok) {
        setPeople(result.people);
        setState("ready");
        updatePageLive(pageId, { people: result.people });
        return;
      }
      if (result.reason === "refused" || result.reason === "off") {
        setPeople([]);
        setState("refused");
        updatePageLive(pageId, { people: [] });
        return;
      }
      // A rate limit or a passing failure keeps what was shown, unless nothing was.
      setState((current) => (current === "loading" || current === "error" ? "error" : current));
    },
    [pageId],
  );

  const beat = React.useCallback(async () => {
    try {
      apply(await touchPagePresence({ pageId, tabId, editing: canEdit }));
    } catch {
      apply({ ok: false, reason: "failed" });
    }
  }, [apply, canEdit, pageId, tabId]);

  React.useEffect(() => {
    const first = setTimeout(() => void beat(), 0);
    const heartbeat = setInterval(() => void beat(), PRESENCE_HEARTBEAT_MS);
    const url = `/api/pages/${pageId}/presence?tab=${tabId}`;
    // Delivered even as the tab unloads; a server action's request is not.
    const goodbye = () => {
      if (typeof navigator.sendBeacon === "function" && navigator.sendBeacon(url)) return;
      void fetch(url, { method: "POST", keepalive: true }).catch(() => undefined);
    };
    // Back from the back-forward cache: announce again.
    const shown = (event: PageTransitionEvent) => {
      if (event.persisted) void beat();
    };
    window.addEventListener("pagehide", goodbye);
    window.addEventListener("pageshow", shown);
    return () => {
      clearTimeout(first);
      clearInterval(heartbeat);
      window.removeEventListener("pagehide", goodbye);
      window.removeEventListener("pageshow", shown);
      // Moving to another page inside the app.
      void fetch(url, { method: "DELETE", keepalive: true }).catch(() => undefined);
    };
  }, [beat, pageId, tabId]);

  // The list closes on Escape (focus back on the button) and on a click elsewhere.
  React.useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    };
    const onPointer = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!panelRef.current?.contains(target) && !triggerRef.current?.contains(target)) setOpen(false);
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("mousedown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("mousedown", onPointer);
    };
  }, [open]);

  if (state === "error") {
    return (
      <div className="flex items-center gap-1.5 text-caption text-muted" data-testid="page-presence-error">
        <span role="status">{t("units.c1.presence.unavailable")}</span>
        <button
          type="button"
          className="min-h-6 rounded-(--radius-sm) px-1.5 text-ink underline hover:bg-surface-soft focus-visible:outline-2 focus-visible:outline-brand"
          disabled={retrying}
          onClick={async () => {
            setRetrying(true);
            await beat();
            setRetrying(false);
          }}
        >
          {retrying ? t("units.c1.presence.retrying") : t("units.c1.presence.retry")}
        </button>
      </div>
    );
  }

  const others = othersOnPage(people ?? [], me.userId);
  // Loading, alone, or not allowed: nothing to show.
  if (state !== "ready" || others.length === 0) return null;

  const nameOf = (person: PagePresencePerson) => person.name || t("units.c1.presence.someone");
  const describe = (person: PagePresencePerson) =>
    t(person.editing ? "units.c1.presence.editing" : "units.c1.presence.viewing", { name: nameOf(person) });
  const summary =
    others.length === 1
      ? t("units.c1.presence.othersOne")
      : t("units.c1.presence.othersMany", { count: others.length });
  const shown = others.slice(0, MAX_CHIPS);
  const extra = others.length - shown.length;

  return (
    <div className="relative" data-testid="page-presence">
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={`${summary}: ${others.map(describe).join(", ")}`}
        title={others.map(describe).join(", ")}
        onClick={() => setOpen((value) => !value)}
        className="flex min-h-8 items-center rounded-full px-1 hover:bg-surface-soft focus-visible:outline-2 focus-visible:outline-brand"
      >
        <span className="flex -space-x-1.5" aria-hidden>
          {shown.map((person) => (
            <span
              key={person.userId}
              data-presence-user={person.userId}
              className="c1-presence-chip inline-flex size-7 items-center justify-center rounded-full border-2 border-surface text-[11px] font-semibold text-white"
              style={{ backgroundColor: presenceColour(person.userId) }}
            >
              {presenceInitials(nameOf(person))}
            </span>
          ))}
          {extra > 0 ? (
            <span className="inline-flex size-7 items-center justify-center rounded-full border-2 border-surface bg-surface-soft text-[11px] font-semibold text-ink">
              +{extra}
            </span>
          ) : null}
        </span>
      </button>
      {open ? (
        <div
          ref={panelRef}
          id={listId}
          role="region"
          aria-label={t("units.c1.presence.label")}
          className="absolute right-0 z-(--z-overlay) mt-1 w-64 max-w-[calc(100vw-2rem)] rounded-(--radius-md) border border-line bg-surface p-3 shadow-lg"
        >
          <p className="eyebrow mb-2">{t("units.c1.presence.listTitle")}</p>
          <ul className="space-y-1.5" data-testid="page-presence-list">
            {others.map((person) => (
              <li key={person.userId} className="flex items-center gap-2 text-body-sm text-ink">
                <span
                  aria-hidden
                  className="inline-flex size-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white"
                  style={{ backgroundColor: presenceColour(person.userId) }}
                >
                  {presenceInitials(nameOf(person))}
                </span>
                <span className="min-w-0 break-words">{describe(person)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
