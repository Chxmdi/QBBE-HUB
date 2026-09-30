import * as Y from "yjs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fromBase64, toBase64 } from "./yjs-broadcast-provider";

/**
 * W0-6 spike: stores a Yjs document in Postgres as an append-only log of
 * updates (`spike_yjs_update`, local database only; see sql/spike-schema.sql).
 *
 * Each client writes only the changes it made itself (not ones it received
 * from peers), so every change is stored exactly once, by its author, and
 * two clients can never overwrite each other's snapshot. Loading reads the
 * whole log and merges it; Yjs updates commute, so order does not matter.
 *
 * `compact()` folds the log into one row inside a single SQL function call,
 * deleting only the rows it merged. Rows appended meanwhile have higher ids
 * and survive.
 */
export class SupabaseYjsPersistence {
  readonly doc: Y.Doc;
  /** Rows written, with the size of each, for the measurements. */
  readonly writes: { bytes: number; ok: boolean; at: number }[] = [];
  private readonly client: SupabaseClient;
  private readonly docId: string;
  private readonly ignoreOrigins: Set<unknown>;
  private readonly flushMs: number;
  private pending: Uint8Array[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight: Promise<void> | null = null;
  private destroyed = false;

  constructor(
    doc: Y.Doc,
    client: SupabaseClient,
    docId: string,
    { ignoreOrigins = [], flushMs = 1_000 }: { ignoreOrigins?: unknown[]; flushMs?: number } = {},
  ) {
    this.doc = doc;
    this.client = client;
    this.docId = docId;
    this.ignoreOrigins = new Set([this, ...ignoreOrigins]);
    this.flushMs = flushMs;
    doc.on("update", this.onUpdate);
  }

  /** Changes from a peer (the provider) are its author's to store, not ours. */
  ignoreOrigin(origin: unknown) {
    this.ignoreOrigins.add(origin);
  }

  async load(): Promise<{ rows: number; bytes: number }> {
    const rows: { id: number; update_b64: string }[] = [];
    const pageSize = 1_000;
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await this.client
        .from("spike_yjs_update")
        .select("id, update_b64")
        .eq("doc_id", this.docId)
        .order("id")
        .range(from, from + pageSize - 1);
      if (error) throw new Error(`Could not load the document: ${error.message}`);
      rows.push(...(data ?? []));
      if (!data || data.length < pageSize) break;
    }
    if (rows.length === 0) return { rows: 0, bytes: 0 };
    const updates = rows.map((row) => fromBase64(row.update_b64));
    Y.applyUpdate(this.doc, Y.mergeUpdates(updates), this);
    return { rows: rows.length, bytes: updates.reduce((sum, u) => sum + u.length, 0) };
  }

  /** Writes whatever is waiting now, and resolves once it is stored. */
  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    while (this.inFlight) await this.inFlight;
    if (this.pending.length === 0) return;
    const batch = this.pending;
    this.pending = [];
    const merged = batch.length === 1 ? batch[0] : Y.mergeUpdates(batch);
    const encoded = toBase64(merged);
    this.inFlight = (async () => {
      const { error } = await this.client
        .from("spike_yjs_update")
        .insert({ doc_id: this.docId, update_b64: encoded, client_id: this.doc.clientID });
      this.writes.push({ bytes: encoded.length, ok: !error, at: Date.now() });
      if (error) {
        // Offline or refused: keep the changes and try again later. Nothing
        // is dropped until the database has confirmed it.
        this.pending.unshift(merged);
        if (!this.destroyed) this.schedule(this.flushMs * 3);
      }
    })();
    try {
      await this.inFlight;
    } finally {
      this.inFlight = null;
    }
  }

  get unsavedChanges(): number {
    return this.pending.length;
  }

  async compact(): Promise<{ mergedRows: number }> {
    await this.flush();
    const { data, error } = await this.client
      .from("spike_yjs_update")
      .select("id, update_b64")
      .eq("doc_id", this.docId)
      .order("id");
    if (error) throw new Error(error.message);
    if (!data || data.length < 2) return { mergedRows: data?.length ?? 0 };
    const merged = Y.mergeUpdates(data.map((row) => fromBase64(row.update_b64)));
    const upto = data[data.length - 1].id;
    const { error: rpcError } = await this.client.rpc("spike_yjs_compact", {
      p_doc_id: this.docId,
      p_merged: toBase64(merged),
      p_upto: upto,
    });
    if (rpcError) throw new Error(rpcError.message);
    return { mergedRows: data.length };
  }

  destroy() {
    this.destroyed = true;
    this.doc.off("update", this.onUpdate);
    if (this.timer) clearTimeout(this.timer);
  }

  private readonly onUpdate = (update: Uint8Array, origin: unknown) => {
    if (this.ignoreOrigins.has(origin)) return;
    this.pending.push(update);
    this.schedule(this.flushMs);
  };

  private schedule(delay: number) {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, delay);
  }
}
