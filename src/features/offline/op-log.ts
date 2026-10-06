/**
 * Offline changes (V3-1): the operation log kept on the device and the rule
 * that settles it against the server when the device is back online.
 *
 * Only structured changes are queued: a task's status and a few properties,
 * and new tasks. Documents already merge offline through the editor (A12).
 *
 * The rule is latest-wins per field. An offline edit remembers the value it
 * started from (`base`) and when it was made. On sync, for each field:
 *   - if the server still holds `base`, nobody else changed it: apply;
 *   - if someone else changed it after the offline edit was made, theirs is
 *     later and stays; yours is shown for review as overwritten;
 *   - if someone else changed it before the offline edit, yours is later and
 *     is applied; theirs is shown for review as overwritten.
 * Clocks are the device's and the server's; a device clock that is badly
 * wrong can pick the wrong winner, which is why every overwrite is shown.
 */

import { isCalendarDate } from "@/lib/schema";

export const OFFLINE_FIELDS = ["status", "priority", "due_at", "start_at", "title"] as const;
export type OfflineField = (typeof OFFLINE_FIELDS)[number];

export const TASK_STATUSES = [
  "not_started",
  "ready",
  "in_progress",
  "waiting",
  "blocked",
  "in_review",
  "completed",
  "cancelled",
] as const;
export const TASK_PRIORITIES = ["low", "medium", "high", "critical"] as const;

export type FieldValue = string | null;

export type OfflineOperation =
  | {
      id: string;
      kind: "set_field";
      /** Device time the edit was made, ISO. */
      createdAt: string;
      taskId: string;
      taskTitle: string;
      field: OfflineField;
      value: FieldValue;
      /** The value the person saw when they made the edit. */
      base: FieldValue;
    }
  | {
      id: string;
      kind: "create_task";
      createdAt: string;
      /** Chosen on the device so a retry cannot create the task twice. */
      taskId: string;
      title: string;
      projectId: string | null;
    };

export type FieldDecision =
  | { action: "apply"; overwritten: FieldValue | null; changedByOthers: boolean }
  | { action: "already" }
  | { action: "keep_server"; overwritten: FieldValue };

/** Latest-wins for one field. `serverChangedAt` is when the server row last changed. */
export function decideField(
  op: { value: FieldValue; base: FieldValue; createdAt: string },
  server: { value: FieldValue; changedAt: string },
): FieldDecision {
  if (server.value === op.value) return { action: "already" };
  if (server.value === op.base) return { action: "apply", overwritten: null, changedByOthers: false };
  const serverLater = Date.parse(server.changedAt) > Date.parse(op.createdAt);
  return serverLater
    ? { action: "keep_server", overwritten: op.value }
    : { action: "apply", overwritten: server.value, changedByOthers: true };
}

/**
 * Several offline edits to one field become one: the last value, the first
 * base (what the server held before any of them) and the last time.
 */
export function compact(ops: OfflineOperation[]): OfflineOperation[] {
  const out: OfflineOperation[] = [];
  const byField = new Map<string, number>();
  for (const op of ops) {
    if (op.kind !== "set_field") {
      out.push(op);
      continue;
    }
    const key = `${op.taskId}\u0000${op.field}`;
    const at = byField.get(key);
    if (at === undefined) {
      byField.set(key, out.length);
      out.push(op);
      continue;
    }
    const first = out[at] as Extract<OfflineOperation, { kind: "set_field" }>;
    out[at] = { ...op, base: first.base };
  }
  // An edit whose value returned to where it started is no change at all.
  return out.filter((op) => op.kind !== "set_field" || op.value !== op.base);
}

export function isValidValue(field: OfflineField, value: FieldValue): boolean {
  if (field === "status") return value !== null && (TASK_STATUSES as readonly string[]).includes(value);
  if (field === "priority") return value !== null && (TASK_PRIORITIES as readonly string[]).includes(value);
  if (field === "title") return value !== null && value.trim().length > 0 && value.length <= 300;
  return value === null || isCalendarDate(value);
}

/** What the person is shown after a sync. */
export interface SyncReview {
  opId: string;
  taskId: string;
  taskTitle: string;
  field: OfflineField;
  kept: FieldValue;
  overwritten: FieldValue;
  /** "server" when someone else's later change stayed; "device" when yours replaced theirs. */
  winner: "server" | "device";
}

export type SyncOutcome =
  | { opId: string; result: "applied" | "already" }
  | { opId: string; result: "kept_server" | "replaced_server"; review: SyncReview }
  | { opId: string; result: "failed"; reason: "forbidden" | "missing" | "invalid" | "error" };

// ---------------------------------------------------------------------------
// Storage on the device
// ---------------------------------------------------------------------------

export interface OpStore {
  all(): Promise<OfflineOperation[]>;
  add(op: OfflineOperation): Promise<void>;
  remove(ids: string[]): Promise<void>;
  reviews(): Promise<SyncReview[]>;
  addReviews(reviews: SyncReview[]): Promise<void>;
  dismissReview(opId: string): Promise<void>;
}

export class MemoryOpStore implements OpStore {
  private ops: OfflineOperation[] = [];
  private kept: SyncReview[] = [];
  async all() {
    return [...this.ops];
  }
  async add(op: OfflineOperation) {
    this.ops.push(op);
  }
  async remove(ids: string[]) {
    this.ops = this.ops.filter((op) => !ids.includes(op.id));
  }
  async reviews() {
    return [...this.kept];
  }
  async addReviews(reviews: SyncReview[]) {
    this.kept.push(...reviews);
  }
  async dismissReview(opId: string) {
    this.kept = this.kept.filter((r) => r.opId !== opId);
  }
}

const DB_VERSION = 1;

/** IndexedDB, one database per person so a shared device never mixes people's changes. */
export class IdbOpStore implements OpStore {
  constructor(private readonly userId: string) {}

  private open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(`wos-offline-${this.userId}`, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("ops")) db.createObjectStore("ops", { keyPath: "id" });
        if (!db.objectStoreNames.contains("reviews")) db.createObjectStore("reviews", { keyPath: "opId" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  private async run<T>(store: string, mode: IDBTransactionMode, work: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, mode);
      const request = work(tx.objectStore(store));
      tx.oncomplete = () => {
        db.close();
        resolve(request ? request.result : undefined);
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
    });
  }

  async all() {
    const rows = (await this.run<OfflineOperation[]>("ops", "readonly", (s) => s.getAll())) ?? [];
    return rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  async add(op: OfflineOperation) {
    await this.run("ops", "readwrite", (s) => void s.put(op));
  }
  async remove(ids: string[]) {
    await this.run("ops", "readwrite", (s) => ids.forEach((id) => s.delete(id)));
  }
  async reviews() {
    return (await this.run<SyncReview[]>("reviews", "readonly", (s) => s.getAll())) ?? [];
  }
  async addReviews(reviews: SyncReview[]) {
    await this.run("reviews", "readwrite", (s) => reviews.forEach((r) => s.put(r)));
  }
  async dismissReview(opId: string) {
    await this.run("reviews", "readwrite", (s) => void s.delete(opId));
  }
}
