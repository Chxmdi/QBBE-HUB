/**
 * An in-memory stand-in for the Supabase client, faithful to the parts of it
 * the job handlers depend on.
 *
 * The point is to exercise the real handlers — `drainNotifications`,
 * `retryFailedEmails`, `dailyDigest` — against transport that behaves the way
 * Postgres and pgmq behave:
 *
 *   - unique indexes reject duplicates with SQLSTATE 23505, which is what makes
 *     delivery exactly-once;
 *   - a queue read hides a message for a visibility timeout and increments its
 *     read count, so an unacknowledged message comes back;
 *   - archiving moves a message to a dead-letter table rather than deleting it.
 *
 * It also breaks on demand (`fail`), because a batch's failure policy is only
 * observable when something goes wrong in the middle of one.
 *
 * The database-level counterparts of those three behaviours are verified
 * directly against the live Postgres; this double is what lets the control flow
 * around them be tested deterministically, in CI, with no network.
 */

export interface Row {
  [column: string]: unknown;
}

interface PostgrestError {
  message: string;
  code: string;
}

interface Result<T> {
  data: T;
  error: PostgrestError | null;
  count?: number;
}

interface QueueMessage {
  msgId: number;
  readCt: number;
  vtMs: number;
  enqueuedAt: string;
  message: Row;
}

type Filter = (row: Row) => boolean;

/** One database call, as a fault matcher sees it. */
export interface Operation {
  kind: "rpc" | "select" | "insert" | "update" | "delete";
  /** The rpc's name, or the table's. */
  name: string;
  /** The rpc's arguments, or the row being written. */
  args: Row;
}

/** Unique indexes, by table, as the column tuples they cover. */
const UNIQUE_INDEXES: Record<string, string[][]> = {
  email_delivery: [["dedupe_key"]],
  notification: [["user_id", "dedupe_key"]],
};

function uniqueViolation(table: string): PostgrestError {
  return {
    code: "23505",
    message: `duplicate key value violates unique constraint on ${table}`,
  };
}

let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${String(idCounter).padStart(4, "0")}`;
}

export class FakeSupabase {
  readonly tables = new Map<string, Row[]>();
  readonly queues = new Map<string, QueueMessage[]>();
  readonly archives = new Map<string, QueueMessage[]>();
  /** Every rpc call, in order — useful for asserting what the handler did. */
  readonly rpcCalls: { name: string; args: Row }[] = [];

  private nextMsgId = 1;
  private clockMs: number;
  private faults: { match: (op: Operation) => boolean; error: PostgrestError }[] = [];

  constructor(now: Date = new Date()) {
    this.clockMs = now.getTime();
    for (const queue of ["notifications", "integrations", "exports"]) {
      this.queues.set(queue, []);
      this.archives.set(queue, []);
    }
  }

  now(): Date {
    return new Date(this.clockMs);
  }

  /** Moves the clock forward, which is how visibility timeouts lapse. */
  advance(seconds: number): void {
    this.clockMs += seconds * 1000;
  }

  seed(table: string, rows: Row[]): void {
    this.tables.set(table, rows.map((row) => ({ ...row })));
  }

  rows(table: string): Row[] {
    if (!this.tables.has(table)) this.tables.set(table, []);
    return this.tables.get(table)!;
  }

  queue(name: string): QueueMessage[] {
    if (!this.queues.has(name)) this.queues.set(name, []);
    return this.queues.get(name)!;
  }

  archive(name: string): QueueMessage[] {
    if (!this.archives.has(name)) this.archives.set(name, []);
    return this.archives.get(name)!;
  }

  /** Messages a worker would see right now. */
  visible(name: string): QueueMessage[] {
    return this.queue(name).filter((message) => message.vtMs <= this.clockMs);
  }

  enqueueRaw(name: string, message: Row, delaySeconds = 0): number {
    const msgId = this.nextMsgId++;
    this.queue(name).push({
      msgId,
      readCt: 0,
      vtMs: this.clockMs + delaySeconds * 1000,
      enqueuedAt: this.now().toISOString(),
      message,
    });
    return msgId;
  }

  /**
   * Makes matching calls fail the way a database that briefly went away does.
   *
   * A batch only reveals its failure policy when something breaks part-way
   * through it, and nothing in a purely in-memory double ever breaks. This is
   * how a test puts one fault in the middle of an otherwise healthy batch.
   */
  fail(
    match: (op: Operation) => boolean,
    error: PostgrestError = { code: "08006", message: "connection reset" },
  ): void {
    this.faults.push({ match, error });
  }

  faultFor(op: Operation): PostgrestError | null {
    return this.faults.find((fault) => fault.match(op))?.error ?? null;
  }

  violatesUnique(table: string, candidate: Row): boolean {
    const indexes = UNIQUE_INDEXES[table];
    if (!indexes) return false;
    return indexes.some((columns) => {
      if (columns.some((column) => candidate[column] == null)) return false;
      return this.rows(table).some((existing) =>
        columns.every((column) => existing[column] === candidate[column]),
      );
    });
  }

  from(table: string): QueryBuilder {
    return new QueryBuilder(this, table);
  }

  async rpc(name: string, args: Row = {}): Promise<Result<unknown>> {
    this.rpcCalls.push({ name, args });

    const fault = this.faultFor({ kind: "rpc", name, args });
    if (fault) return { data: null, error: fault };

    switch (name) {
      case "job_queue_send":
        return {
          data: this.enqueueRaw(
            String(args.p_queue),
            args.p_message as Row,
            Number(args.p_delay_seconds ?? 0),
          ),
          error: null,
        };

      case "job_queue_read": {
        const queueName = String(args.p_queue);
        const vtSeconds = Number(args.p_visibility_seconds ?? 60);
        const quantity = Number(args.p_quantity ?? 20);
        const taken = this.visible(queueName).slice(0, quantity);
        for (const message of taken) {
          message.readCt += 1;
          message.vtMs = this.clockMs + vtSeconds * 1000;
        }
        return {
          data: taken.map((message) => ({
            msg_id: message.msgId,
            read_ct: message.readCt,
            enqueued_at: message.enqueuedAt,
            vt: new Date(message.vtMs).toISOString(),
            message: message.message,
          })),
          error: null,
        };
      }

      case "job_queue_delete": {
        const queueName = String(args.p_queue);
        const remaining = this.queue(queueName).filter(
          (message) => message.msgId !== Number(args.p_msg_id),
        );
        const removed = remaining.length !== this.queue(queueName).length;
        this.queues.set(queueName, remaining);
        return { data: removed, error: null };
      }

      case "job_queue_archive": {
        const queueName = String(args.p_queue);
        const moved = this.queue(queueName).find(
          (message) => message.msgId === Number(args.p_msg_id),
        );
        if (moved) {
          this.archive(queueName).push(moved);
          this.queues.set(
            queueName,
            this.queue(queueName).filter((message) => message.msgId !== moved.msgId),
          );
        }
        return { data: Boolean(moved), error: null };
      }

      case "email_orphaned_notifications": {
        const cutoff =
          this.clockMs - Number(args.p_older_than_minutes ?? 10) * 60_000;
        const delivered = new Set(
          this.rows("email_delivery")
            .map((row) => row.notification_id)
            .filter(Boolean),
        );
        const orphans = this.rows("notification")
          .filter(
            (row) =>
              !delivered.has(row.id) &&
              new Date(String(row.created_at)).getTime() < cutoff,
          )
          .slice(0, Number(args.p_limit ?? 100))
          .map((row) => ({
            notification_id: row.id,
            user_id: row.user_id,
            category: row.category,
            urgency: row.urgency,
            dedupe_key: row.dedupe_key ?? `notification:${row.id}`,
          }));
        return { data: orphans, error: null };
      }

      default:
        return { data: null, error: { code: "42883", message: `no rpc ${name}` } };
    }
  }
}

type Mode = "select" | "insert" | "update" | "delete";

class QueryBuilder implements PromiseLike<Result<Row[] | Row | null>> {
  private filters: Filter[] = [];
  private mode: Mode = "select";
  private payload: Row | Row[] = {};
  private returning = false;
  private headOnly = false;
  private wantCount = false;
  private limitValue: number | null = null;
  private orderBy: { column: string; ascending: boolean } | null = null;
  private singleMode: "one" | "maybe" | null = null;

  constructor(
    private readonly db: FakeSupabase,
    private readonly table: string,
  ) {}

  select(_columns?: string, options?: { count?: string; head?: boolean }) {
    if (this.mode === "select") {
      this.headOnly = Boolean(options?.head);
      this.wantCount = Boolean(options?.count);
    } else {
      this.returning = true;
    }
    return this;
  }

  insert(payload: Row | Row[]) {
    this.mode = "insert";
    this.payload = payload;
    return this;
  }

  update(payload: Row) {
    this.mode = "update";
    this.payload = payload;
    return this;
  }

  delete() {
    this.mode = "delete";
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push((row) => row[column] === value);
    return this;
  }

  in(column: string, values: unknown[]) {
    this.filters.push((row) => values.includes(row[column]));
    return this;
  }

  is(column: string, value: null) {
    this.filters.push((row) => (row[column] ?? null) === value);
    return this;
  }

  not(column: string, operator: string, value: unknown) {
    if (operator === "is") {
      this.filters.push((row) => (row[column] ?? null) !== null);
    } else if (operator === "in") {
      const list = String(value)
        .replace(/^\(|\)$/g, "")
        .split(",")
        .map((entry) => entry.trim().replace(/^"|"$/g, ""));
      this.filters.push((row) => !list.includes(String(row[column])));
    }
    return this;
  }

  lt(column: string, value: string) {
    this.filters.push((row) => String(row[column] ?? "") < value);
    return this;
  }

  lte(column: string, value: string) {
    this.filters.push((row) => String(row[column] ?? "") <= value);
    return this;
  }

  gte(column: string, value: string) {
    this.filters.push((row) => String(row[column] ?? "") >= value);
    return this;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  or(expression: string) {
    // The one `or` in the handlers filters expired announcements, which the
    // fixtures never produce. Left permissive on purpose rather than
    // half-implementing PostgREST's expression grammar.
    return this;
  }

  order(column: string, options?: { ascending?: boolean }) {
    this.orderBy = { column, ascending: options?.ascending ?? true };
    return this;
  }

  limit(value: number) {
    this.limitValue = value;
    return this;
  }

  maybeSingle() {
    this.singleMode = "maybe";
    return this;
  }

  single() {
    this.singleMode = "one";
    return this;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  then<TResult1 = any, TResult2 = never>(
    onfulfilled?: ((value: Result<Row[] | Row | null>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.run()).then(onfulfilled, onrejected);
  }

  private matching(): Row[] {
    return this.db.rows(this.table).filter((row) => this.filters.every((f) => f(row)));
  }

  private shape(rows: Row[]): Result<Row[] | Row | null> {
    let output = rows;

    if (this.orderBy) {
      const { column, ascending } = this.orderBy;
      output = [...output].sort((a, b) => {
        const left = String(a[column] ?? "");
        const right = String(b[column] ?? "");
        return ascending ? left.localeCompare(right) : right.localeCompare(left);
      });
    }
    if (this.limitValue !== null) output = output.slice(0, this.limitValue);

    if (this.singleMode === "one") {
      if (output.length !== 1) {
        return {
          data: null,
          error: { code: "PGRST116", message: "expected exactly one row" },
        };
      }
      return { data: output[0], error: null };
    }
    if (this.singleMode === "maybe") {
      return { data: output[0] ?? null, error: null };
    }
    if (this.headOnly) {
      return { data: null, error: null, count: rows.length };
    }
    return {
      data: output.map((row) => ({ ...row })),
      error: null,
      ...(this.wantCount ? { count: rows.length } : {}),
    };
  }

  private run(): Result<Row[] | Row | null> {
    const store = this.db.rows(this.table);

    const fault = this.db.faultFor({
      kind: this.mode,
      name: this.table,
      args: Array.isArray(this.payload) ? (this.payload[0] ?? {}) : this.payload,
    });
    if (fault) return { data: null, error: fault };

    if (this.mode === "insert") {
      const candidates = Array.isArray(this.payload) ? this.payload : [this.payload];
      // Postgres applies the whole statement or none of it.
      for (const candidate of candidates) {
        if (this.db.violatesUnique(this.table, candidate)) {
          return { data: null, error: uniqueViolation(this.table) };
        }
      }
      const inserted = candidates.map((candidate) => {
        const row: Row = {
          id: nextId(this.table),
          created_at: this.db.now().toISOString(),
          updated_at: this.db.now().toISOString(),
          ...candidate,
        };
        store.push(row);
        return row;
      });
      if (!this.returning) return { data: null, error: null };
      return this.shape(inserted);
    }

    if (this.mode === "update") {
      const targets = this.matching();
      for (const row of targets) {
        Object.assign(row, this.payload, {
          updated_at: this.db.now().toISOString(),
        });
      }
      if (!this.returning) return { data: null, error: null };
      return this.shape(targets);
    }

    if (this.mode === "delete") {
      const targets = this.matching();
      const removed = new Set(targets);
      this.db.tables.set(
        this.table,
        store.filter((row) => !removed.has(row)),
      );
      if (!this.returning) return { data: null, error: null };
      return this.shape(targets);
    }

    return this.shape(this.matching());
  }
}

/** Typed as the real client so handlers accept it without casts at the call site. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function asClient(db: FakeSupabase): any {
  return db;
}
