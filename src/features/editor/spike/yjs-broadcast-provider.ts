import * as Y from "yjs";
import * as awarenessProtocol from "y-protocols/awareness";

/**
 * W0-6 spike: a small Yjs provider that syncs one Y.Doc between browsers over
 * a publish/subscribe channel (Supabase Realtime broadcast in the app, an
 * in-memory bus in the unit tests).
 *
 * Broadcast has no history and no delivery guarantee: a message sent while a
 * peer is disconnected is simply never delivered to it. Correctness therefore
 * does not rest on individual update messages arriving. It rests on the
 * state-vector handshake Yjs is designed around:
 *
 * - `y-update`  every local change, batched for `flushMs` and merged.
 *               The fast path; losing one is harmless.
 * - `y-sync1`   "here is my state vector". Sent on every (re)join and every
 *               `resyncMs`. Each peer answers with `y-sync2`: exactly what the
 *               sender is missing (plus the full delete set), and, unless the
 *               message was itself a reply, its own `y-sync1` so the sender
 *               can answer back with what the peer is missing.
 * - `y-aw`      awareness (cursors, names).
 * - `y-chunk`   one part of a message larger than `maxMessageChars`.
 *
 * Every Yjs update is idempotent and commutative, so duplicates and reordering
 * are safe.
 */

export type ProviderStatus = "connecting" | "connected" | "disconnected";

export interface BroadcastTransport {
  /** Sends one message to every other subscriber. Only called while connected. */
  send(event: string, payload: Record<string, unknown>): void;
  onMessage(handler: (event: string, payload: Record<string, unknown>) => void): void;
  onStatus(handler: (status: ProviderStatus) => void): void;
  connect(): void;
  disconnect(): void;
}

export interface SentMessageStat {
  event: string;
  /** Size of the JSON the transport sends, in bytes (UTF-8). */
  bytes: number;
  at: number;
}

export interface ProviderOptions {
  /** How long local changes are batched before sending. */
  flushMs?: number;
  /** Periodic re-handshake, the safety net for dropped messages. 0 turns it off. */
  resyncMs?: number;
  /** Messages whose JSON is longer than this are split into `y-chunk` parts. */
  maxMessageChars?: number;
}

const DEFAULTS: Required<ProviderOptions> = {
  flushMs: 25,
  resyncMs: 15_000,
  // Supabase's smallest plan caps a broadcast payload at 256 KB; staying far
  // below it leaves room for the envelope and for base64 growth.
  maxMessageChars: 64 * 1024,
};

export class YjsBroadcastProvider {
  readonly doc: Y.Doc;
  readonly awareness: awarenessProtocol.Awareness;
  readonly clientId: string;
  status: ProviderStatus = "connecting";
  /** True once this client has exchanged state with a peer, or waited alone. */
  synced = false;

  /** Every message this client sent, for the message-size measurements. */
  readonly sent: SentMessageStat[] = [];
  /** Transport-level delay of each received `y-update` (receive time minus send time). */
  readonly receiveDelaysMs: number[] = [];

  private readonly transport: BroadcastTransport;
  private readonly options: Required<ProviderOptions>;
  private pending: Uint8Array[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private resyncTimer: ReturnType<typeof setInterval> | null = null;
  private aloneTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly chunks = new Map<string, { parts: string[]; received: number; at: number }>();
  private chunkCounter = 0;
  private readonly statusListeners = new Set<(status: ProviderStatus) => void>();
  private destroyed = false;

  constructor(doc: Y.Doc, transport: BroadcastTransport, options: ProviderOptions = {}, awareness?: awarenessProtocol.Awareness) {
    this.doc = doc;
    this.transport = transport;
    this.options = { ...DEFAULTS };
    for (const [key, value] of Object.entries(options)) {
      if (value !== undefined) (this.options as Record<string, number>)[key] = value;
    }
    this.awareness = awareness ?? new awarenessProtocol.Awareness(doc);
    this.clientId = `${doc.clientID}-${Math.random().toString(36).slice(2, 8)}`;

    doc.on("update", this.onDocUpdate);
    this.awareness.on("update", this.onAwarenessUpdate);
    transport.onMessage(this.onMessage);
    transport.onStatus(this.onStatus);
    transport.connect();
  }

  onStatusChange(listener: (status: ProviderStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  /** Drops the connection, as a network failure would. For the recovery test. */
  disconnect(): void {
    this.transport.disconnect();
  }

  connect(): void {
    this.transport.connect();
  }

  /** Starts a handshake now instead of waiting for the periodic one. */
  resync(): void {
    if (this.status !== "connected") return;
    this.sendSync1(false);
    // Awareness entries expire after 30 s unless renewed.
    const update = awarenessProtocol.encodeAwarenessUpdate(this.awareness, [this.doc.clientID]);
    this.send("y-aw", { from: this.clientId, u: toBase64(update) });
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.doc.off("update", this.onDocUpdate);
    this.awareness.off("update", this.onAwarenessUpdate);
    awarenessProtocol.removeAwarenessStates(this.awareness, [this.doc.clientID], "local");
    if (this.flushTimer) clearTimeout(this.flushTimer);
    if (this.resyncTimer) clearInterval(this.resyncTimer);
    if (this.aloneTimer) clearTimeout(this.aloneTimer);
    this.transport.disconnect();
  }

  private readonly onDocUpdate = (update: Uint8Array, origin: unknown) => {
    // Changes this provider applied came from a peer; echoing them is waste.
    if (origin === this) return;
    this.pending.push(update);
    if (!this.flushTimer) this.flushTimer = setTimeout(this.flush, this.options.flushMs);
  };

  private readonly flush = () => {
    this.flushTimer = null;
    if (this.status !== "connected" || this.pending.length === 0) {
      // Offline: keep nothing. The handshake on reconnect sends the peers
      // everything they lack, including these changes, in one message.
      if (this.status !== "connected") this.pending = [];
      return;
    }
    const merged = this.pending.length === 1 ? this.pending[0] : Y.mergeUpdates(this.pending);
    this.pending = [];
    this.send("y-update", { from: this.clientId, u: toBase64(merged), t: Date.now() });
  };

  private readonly onAwarenessUpdate = (
    { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown,
  ) => {
    if (origin !== "local" || this.status !== "connected") return;
    const changed = added.concat(updated, removed);
    const update = awarenessProtocol.encodeAwarenessUpdate(this.awareness, changed);
    this.send("y-aw", { from: this.clientId, u: toBase64(update) });
  };

  private readonly onStatus = (status: ProviderStatus) => {
    if (this.destroyed) return;
    this.status = status;
    if (status === "connected") {
      this.sendSync1(false);
      const update = awarenessProtocol.encodeAwarenessUpdate(this.awareness, [this.doc.clientID]);
      this.send("y-aw", { from: this.clientId, u: toBase64(update) });
      if (this.options.resyncMs > 0 && !this.resyncTimer) {
        this.resyncTimer = setInterval(() => this.resync(), this.options.resyncMs);
      }
      // Nobody else in the room answers; that is a valid synced state.
      if (!this.synced && !this.aloneTimer) {
        this.aloneTimer = setTimeout(() => {
          this.aloneTimer = null;
          this.markSynced();
        }, 1_500);
      }
    }
    for (const listener of this.statusListeners) listener(status);
  };

  private markSynced() {
    this.synced = true;
    if (this.aloneTimer) {
      clearTimeout(this.aloneTimer);
      this.aloneTimer = null;
    }
  }

  private sendSync1(isReply: boolean, to?: string) {
    this.send("y-sync1", {
      from: this.clientId,
      to: to ?? null,
      sv: toBase64(Y.encodeStateVector(this.doc)),
      reply: isReply,
    });
  }

  private readonly onMessage = (event: string, payload: Record<string, unknown>) => {
    if (this.destroyed) return;
    if (event === "y-chunk") {
      this.receiveChunk(payload);
      return;
    }
    this.dispatch(event, payload);
  };

  private dispatch(event: string, payload: Record<string, unknown>) {
    // Peer input is untrusted: a malformed message must not take the editor down.
    try {
      if (payload.from === this.clientId) return;
      const to = payload.to as string | null | undefined;
      if (to && to !== this.clientId) return;

      switch (event) {
        case "y-update": {
          Y.applyUpdate(this.doc, fromBase64(String(payload.u)), this);
          if (typeof payload.t === "number") this.receiveDelaysMs.push(Date.now() - payload.t);
          break;
        }
        case "y-sync1": {
          const sv = fromBase64(String(payload.sv));
          const diff = Y.encodeStateAsUpdate(this.doc, sv);
          this.send("y-sync2", { from: this.clientId, to: payload.from, u: toBase64(diff) });
          if (!payload.reply) this.sendSync1(true, String(payload.from));
          break;
        }
        case "y-sync2": {
          Y.applyUpdate(this.doc, fromBase64(String(payload.u)), this);
          this.markSynced();
          break;
        }
        case "y-aw": {
          awarenessProtocol.applyAwarenessUpdate(this.awareness, fromBase64(String(payload.u)), this);
          break;
        }
      }
    } catch (error) {
      console.warn("[editor-spike] ignored a malformed collaboration message", event, error);
    }
  }

  private send(event: string, payload: Record<string, unknown>) {
    if (this.status !== "connected") return;
    const json = JSON.stringify(payload);
    if (json.length <= this.options.maxMessageChars) {
      this.record(event, json);
      this.transport.send(event, payload);
      return;
    }
    const id = `${this.clientId}:${++this.chunkCounter}`;
    const envelope = JSON.stringify({ event, payload });
    const size = this.options.maxMessageChars - 200;
    const count = Math.ceil(envelope.length / size);
    for (let i = 0; i < count; i++) {
      const part = { from: this.clientId, id, i, n: count, part: envelope.slice(i * size, (i + 1) * size) };
      this.record("y-chunk", JSON.stringify(part));
      this.transport.send("y-chunk", part);
    }
  }

  private record(event: string, json: string) {
    this.sent.push({ event, bytes: new TextEncoder().encode(json).length, at: Date.now() });
  }

  private receiveChunk(payload: Record<string, unknown>) {
    const id = String(payload.id);
    const n = Number(payload.n);
    const i = Number(payload.i);
    if (!Number.isInteger(n) || !Number.isInteger(i) || i < 0 || i >= n || n > 10_000) return;
    const now = Date.now();
    // Parts of a message whose other parts never arrived are dropped after
    // 30 s; the next handshake resends what they carried.
    for (const [key, entry] of this.chunks) if (now - entry.at > 30_000) this.chunks.delete(key);
    const entry = this.chunks.get(id) ?? { parts: new Array<string>(n), received: 0, at: now };
    if (entry.parts[i] === undefined) {
      entry.parts[i] = String(payload.part);
      entry.received++;
    }
    this.chunks.set(id, entry);
    if (entry.received < n) return;
    this.chunks.delete(id);
    try {
      const { event, payload: inner } = JSON.parse(entry.parts.join("")) as {
        event: string;
        payload: Record<string, unknown>;
      };
      this.dispatch(event, inner);
    } catch (error) {
      console.warn("[editor-spike] ignored a malformed chunked message", error);
    }
  }
}

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(binary);
}

export function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
