import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import type { BroadcastTransport, ProviderStatus } from "./yjs-broadcast-provider";

/**
 * W0-6 spike: carries the Yjs provider's messages over one private Supabase
 * Realtime broadcast channel per document.
 *
 * Private channels are authorised by row-level security on
 * `realtime.messages` when the channel is joined, so only people allowed to
 * see the document can join its channel (the spike's policy is in
 * sql/spike-schema.sql; the real one would call `app.can`).
 */
export function supabaseBroadcastTransport(client: SupabaseClient, topic: string): BroadcastTransport {
  let channel: RealtimeChannel | null = null;
  let messageHandler: (event: string, payload: Record<string, unknown>) => void = () => {};
  let statusHandler: (status: ProviderStatus) => void = () => {};
  let joined = false;

  // The browser knows about a lost network long before a WebSocket does: a
  // socket with no traffic is only declared dead after Realtime's heartbeat
  // (25 s) goes unanswered. Stop sending at once when the browser goes
  // offline, and reconnect and re-handshake as soon as it is back.
  const onOffline = () => statusHandler("disconnected");
  const onOnline = () => {
    if (!channel) return;
    if (joined) statusHandler("connected");
    else client.realtime.connect();
  };

  return {
    onMessage(handler) {
      messageHandler = handler;
    },
    onStatus(handler) {
      statusHandler = handler;
    },
    send(event, payload) {
      // Sent only while joined. Otherwise the client falls back to the REST
      // endpoint, which the handshake on reconnect makes unnecessary, and a
      // REST send cut off by leaving the page rejected with nothing to catch
      // it (WebKit reports that as a page error). A send that fails anyway is
      // dropped for the same reason: the next handshake carries the state.
      if (!channel || !joined) return;
      channel.send({ type: "broadcast", event, payload }).catch(() => {});
    },
    connect() {
      if (channel) return;
      statusHandler("connecting");
      if (typeof window !== "undefined") {
        window.addEventListener("offline", onOffline);
        window.addEventListener("online", onOnline);
      }
      channel = client.channel(topic, {
        config: { private: true, broadcast: { self: false, ack: false } },
      });
      channel.on("broadcast", { event: "*" }, (message) => {
        messageHandler(String(message.event), (message.payload ?? {}) as Record<string, unknown>);
      });
      // Called again on every rejoin after the socket reconnects.
      channel.subscribe((status) => {
        joined = status === "SUBSCRIBED";
        if (joined && typeof navigator !== "undefined" && navigator.onLine === false) return;
        statusHandler(joined ? "connected" : "disconnected");
      });
    },
    disconnect() {
      if (!channel) return;
      const current = channel;
      channel = null;
      joined = false;
      if (typeof window !== "undefined") {
        window.removeEventListener("offline", onOffline);
        window.removeEventListener("online", onOnline);
      }
      statusHandler("disconnected");
      void client.removeChannel(current);
    },
  };
}
