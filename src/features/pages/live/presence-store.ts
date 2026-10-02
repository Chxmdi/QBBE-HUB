"use client";

import * as React from "react";
import type { PagePresencePerson } from "@/features/pages/services/page-presence";

/**
 * What the page header and the editor share about one open page (wave 2,
 * C1). The header (c1-page-presence.tsx) is only rendered when both switches
 * are on: it records who the reader is and who else is here. The editor's
 * live session (units/c1-presence.tsx) starts only once the reader is known,
 * so with a switch off it never starts, and records who it is editing with.
 */

export interface PresenceMe {
  userId: string;
  name: string;
  colour: string;
}

export interface PageLiveState {
  me: PresenceMe | null;
  /** Everyone the server says has the page open (the reader included). */
  people: PagePresencePerson[];
  /** People whose changes this editor receives live (user ids). */
  livePeers: string[];
}

const EMPTY: PageLiveState = Object.freeze({ me: null, people: [], livePeers: [] }) as PageLiveState;

const states = new Map<string, PageLiveState>();
const listeners = new Map<string, Set<() => void>>();

export function readPageLive(pageId: string): PageLiveState {
  return states.get(pageId) ?? EMPTY;
}

export function updatePageLive(pageId: string, change: Partial<PageLiveState>): void {
  const current = readPageLive(pageId);
  const next = { ...current, ...change };
  if (
    next.me === current.me &&
    next.people === current.people &&
    sameIds(next.livePeers, current.livePeers)
  ) {
    return;
  }
  states.set(pageId, next);
  listeners.get(pageId)?.forEach((listener) => listener());
}

/** Forgets the page once nothing shows it any more. */
export function clearPageLive(pageId: string): void {
  if (!states.has(pageId)) return;
  states.delete(pageId);
  listeners.get(pageId)?.forEach((listener) => listener());
}

export function subscribePageLive(pageId: string, listener: () => void): () => void {
  const set = listeners.get(pageId) ?? new Set<() => void>();
  set.add(listener);
  listeners.set(pageId, set);
  return () => {
    set.delete(listener);
    if (set.size === 0) listeners.delete(pageId);
  };
}

export function usePageLive(pageId: string | null): PageLiveState {
  const subscribe = React.useCallback(
    (listener: () => void) => (pageId ? subscribePageLive(pageId, listener) : () => {}),
    [pageId],
  );
  const read = React.useCallback(() => (pageId ? readPageLive(pageId) : EMPTY), [pageId]);
  return React.useSyncExternalStore(subscribe, read, () => EMPTY);
}

function sameIds(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}
