import * as Y from "yjs";

/**
 * Which copies of a page may be merged live (wave 2, C1).
 *
 * Yjs merges two copies correctly only when they grew from the same saved
 * state. A page whose body was never saved from the editor is converted from
 * its JSON in every browser separately, each with its own history; merging
 * two such copies would repeat the whole page. So every copy carries a
 * lineage, and copies only exchange changes with copies of the same lineage:
 *
 * - a copy loaded from a state that already has a lineage keeps it;
 * - a copy loaded from a saved state without one takes a hash of that exact
 *   state, so every browser that loaded the same save agrees on it;
 * - a copy converted from JSON (or empty) has a history no other browser
 *   shares, so its hash is its own.
 *
 * The lineage is written into the document, so it travels with every later
 * save and everyone who opens the page afterwards shares it.
 */

const MAP = "c1-live";
const KEY = "lineage";

export function readLineage(doc: Y.Doc): string | null {
  const value = doc.getMap(MAP).get(KEY);
  return typeof value === "string" && /^[0-9a-z-]{8,64}$/.test(value) ? value : null;
}

/** The lineage of a copy as it was loaded: read before the editor touches it. */
export function lineageOf(doc: Y.Doc): string {
  const stored = readLineage(doc);
  if (stored) return stored;
  if (doc.store.clients.size === 0) return `new-${randomPart()}`;
  return `s-${hashBytes(Y.encodeStateAsUpdate(doc))}`;
}

/** Records the lineage in the document when it has none yet. */
export function stampLineage(doc: Y.Doc, lineage: string): void {
  if (readLineage(doc)) return;
  doc.transact(() => doc.getMap(MAP).set(KEY, lineage), "c1-lineage");
}

/** A 64-bit hash (two 32-bit FNV-1a lanes), as 16 hex digits. */
export function hashBytes(bytes: Uint8Array): string {
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ 0x9e3779b9;
  for (let i = 0; i < bytes.length; i++) {
    a = Math.imul(a ^ bytes[i], 0x01000193) >>> 0;
    b = Math.imul(b ^ bytes[i] ^ (i & 0xff), 0x01000193) >>> 0;
  }
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}

function randomPart(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * Merges the server's saved state into a live copy when they share a
 * lineage. Returns false, changing nothing, when the state is missing,
 * damaged or of another lineage (a restore, or a copy converted elsewhere):
 * that save conflict is then the person's to resolve.
 */
export function mergeSavedState(doc: Y.Doc, lineage: string, state: Uint8Array | null): boolean {
  if (!state || state.length === 0) return false;
  const saved = new Y.Doc();
  try {
    Y.applyUpdate(saved, state);
  } catch {
    return false;
  }
  if (readLineage(saved) !== lineage) return false;
  Y.applyUpdate(doc, state, "c1-save-merge");
  return true;
}
