"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { authorizeRealtime, createSupabaseBrowserClient } from "@/lib/supabase/client";
import { createThrottle, CURSOR_THROTTLE_MS, HEARTBEAT_MS, type PresenceCursor, type PresenceEntry } from "../presence";
import { leavePresence, listPresence, touchPresence } from "../services/collab.commands";

/**
 * Presence for one object (V1-17): announces the reader, keeps it fresh,
 * sends cursor moves (throttled) and keeps the list of others current, from
 * Realtime changes when they arrive and from a heartbeat poll otherwise.
 */
export function usePresence(objectId: string, editing: boolean) {
  const [entries, setEntries] = useState<PresenceEntry[]>([]);
  const [live, setLive] = useState(false);
  const cursorRef = useRef<PresenceCursor | null>(null);
  const editingRef = useRef(editing);

  const refresh = useCallback(async () => {
    setEntries(await listPresence(objectId));
  }, [objectId]);

  const beat = useCallback(async () => {
    await touchPresence(objectId, cursorRef.current, editingRef.current);
    await refresh();
  }, [objectId, refresh]);

  useEffect(() => {
    editingRef.current = editing;
  }, [editing]);

  useEffect(() => {
    const first = setTimeout(() => void beat(), 0);
    const timer = setInterval(() => void beat(), HEARTBEAT_MS);
    const leave = () => void leavePresence(objectId);
    window.addEventListener("pagehide", leave);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
      window.removeEventListener("pagehide", leave);
      leave();
    };
  }, [beat, objectId]);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    void authorizeRealtime(supabase).then(() => {
      if (cancelled) return;
      channel = supabase
        .channel(`presence:${objectId}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "object_presence", filter: `object_id=eq.${objectId}` },
          () => void refresh(),
        )
        .subscribe((status) => setLive(status === "SUBSCRIBED"));
    });
    return () => {
      cancelled = true;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [objectId, refresh]);

  const sendRef = useRef<((cursor: PresenceCursor | null) => void) | null>(null);
  useEffect(() => {
    sendRef.current = createThrottle<PresenceCursor | null>((cursor) => {
      void touchPresence(objectId, cursor, editingRef.current);
    }, CURSOR_THROTTLE_MS);
  }, [objectId]);

  const moveCursor = useCallback((cursor: PresenceCursor | null) => {
    cursorRef.current = cursor;
    sendRef.current?.(cursor);
  }, []);

  return { entries, live, moveCursor, refresh };
}
