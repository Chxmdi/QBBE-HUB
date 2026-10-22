// The parts of the backup and restore drill that are decisions rather than
// input and output: which rows a dump holds, which stored files a backup must
// copy and which it can take from the previous night, where a file lands on
// disk, and whether what came back matches what went in (DATA-001,
// docs/runbooks/backup-recovery.md).
//
// Nothing here touches the network, a database or the disk, so every rule is
// covered by tests/unit/backup-lib.test.ts. The scripts beside this file do
// the reading and writing:
//
//   create-backup.sh       dumps the database, copies changed files, packages
//                          and encrypts one backup
//   export-storage.mjs     downloads new or changed Storage files, encrypting
//                          each one on the way (blobs)
//   bucket.sh              the off-site bucket: what is there (and the monthly
//                          copy of blobs), upload with a read-back check, and
//                          fetch for a restore
//   migration-history.sql  the migration history, in one psql call
//   manifest.mjs           builds and checks the manifest inside the archive
//   restore-drill.sh       decrypts, restores into a scratch target, compares
//   restore-storage.mjs    uploads the files to a scratch project, re-checks
//
// How files are kept. The nightly archive holds the database and the
// manifest; each stored file is kept once, as its own encrypted "blob" named
// by the sha256 of its contents, under blobs/<environment>/<YYYY-MM>-<tag>/
// in the bucket, where <tag> names the set of custodians' keys the blobs are
// encrypted to (recipientTag). A night downloads from Supabase only the
// files that are new or changed since the previous night (Supabase's free
// plan allows 5 GB of outgoing traffic a month for all projects together).
// Each month starts a new blob folder: the first run of the month copies the
// blobs still in use from last month's folder (bucket to bucket, no Supabase
// traffic, each copy checked against the size and sha256 recorded when the
// blob was first stored), so the bucket's lifecycle rule can delete a whole
// old folder, and with it files deleted from the app, without breaking any
// archive still kept. A change of keys gives a new tag, so the next night
// stores every file again, encrypted to the new keys.
//
// The index stored next to each archive is unencrypted, so it is signed
// (HMAC-SHA256 with BACKUP_INDEX_KEY): an index that fails the check is not
// used, and the night downloads every file again.

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const MANIFEST_FORMAT = "qbbe-backup/3";
export const INDEX_FORMAT = "qbbe-backup-index/2";

/** The SQL files a backup holds, in the order a restore applies them. */
export const DB_FILES = [
  "roles.sql",
  "schema.sql",
  "data.sql",
  "history_schema.sql",
  "history_data.sql",
  "platform.sql",
];

// ---------------------------------------------------------------------------
// Encryption recipients
// ---------------------------------------------------------------------------

/**
 * The age public keys in BACKUP_AGE_RECIPIENT. One per custodian, separated
 * by spaces, commas or new lines; any one matching private key decrypts.
 * Throws on anything that is not an age public key, so a pasted private key
 * (AGE-SECRET-KEY-…) or a typo stops the backup instead of encrypting to
 * nobody.
 * @param {string | undefined} text
 * @returns {string[]}
 */
export function parseRecipients(text) {
  // Checked on the whole value first: a pasted age-keygen file starts with
  // comment lines, and the private key must be named as such, not as "not
  // a public key".
  if (/AGE-SECRET-KEY-/i.test(String(text ?? ""))) {
    throw new Error("BACKUP_AGE_RECIPIENT holds a private key. Only the public key (age1…) belongs in GitHub.");
  }
  const items = String(text ?? "")
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (items.length === 0) throw new Error("No age recipient given.");
  for (const item of items) {
    if (!/^age1[02-9ac-hj-np-z]{58}$/.test(item)) {
      throw new Error(`Not an age public key: ${item.slice(0, 8)}… (expected age1 followed by 58 characters).`);
    }
  }
  return [...new Set(items)];
}

/**
 * A short name for a set of age public keys: the first 16 hex characters of
 * the sha256 of the keys, de-duplicated, sorted and joined with new lines.
 * The order they were typed in and repeats do not matter; any added or
 * removed key gives another tag, and so another blob folder.
 * @param {string[]} recipients
 */
export function recipientTag(recipients) {
  const keys = [...new Set(recipients.map((r) => r.trim()).filter(Boolean))].sort();
  if (keys.length === 0) throw new Error("No age recipient given.");
  return createHash("sha256").update(keys.join("\n")).digest("hex").slice(0, 16);
}

// ---------------------------------------------------------------------------
// Reading a data dump (pg_dump --data-only --use-copy)
// ---------------------------------------------------------------------------

const COPY_LINE = /^COPY "((?:[^"]|"")+)"\."((?:[^"]|"")+)"(?: \((.*)\))? FROM stdin;$/;

/**
 * The table and column names of a `COPY "schema"."table" ("a", "b") FROM
 * stdin;` line, or null for any other line.
 * @param {string} line
 * @returns {{ table: string, columns: string[] } | null}
 */
export function parseCopyHeader(line) {
  const match = COPY_LINE.exec(line);
  if (!match) return null;
  const unquote = (/** @type {string} */ s) => s.replace(/""/g, '"');
  const columns = match[3] ? [...match[3].matchAll(/"((?:[^"]|"")*)"/g)].map((m) => unquote(m[1])) : [];
  return { table: `${unquote(match[1])}.${unquote(match[2])}`, columns };
}

/**
 * "schema.table" for a COPY line, or null for any other line.
 * @param {string} line
 */
export function copyTarget(line) {
  return parseCopyHeader(line)?.table ?? null;
}

const COPY_ESCAPES = /** @type {Record<string, string>} */ ({ b: "\b", f: "\f", n: "\n", r: "\r", t: "\t", v: "\v" });

/**
 * One field of a COPY text row as its value: null for \N, otherwise the text
 * with COPY's backslash escapes undone (\\, \t, \n, octal \NNN, hex \xHH).
 * @param {string} field
 * @returns {string | null}
 */
export function decodeCopyField(field) {
  if (field === "\\N") return null;
  if (!field.includes("\\")) return field;
  /** @type {number[]} */
  const bytes = [];
  const push = (/** @type {string} */ text) => bytes.push(...Buffer.from(text, "utf8"));
  for (let i = 0; i < field.length; i += 1) {
    const ch = field[i];
    if (ch !== "\\" || i === field.length - 1) {
      // Copy a whole code point (surrogate pairs included).
      const cp = /** @type {number} */ (field.codePointAt(i));
      push(String.fromCodePoint(cp));
      if (cp > 0xffff) i += 1;
      continue;
    }
    const next = field[i + 1];
    if (COPY_ESCAPES[next]) {
      push(COPY_ESCAPES[next]);
      i += 1;
    } else if (/[0-7]/.test(next)) {
      const octal = /^[0-7]{1,3}/.exec(field.slice(i + 1))?.[0] ?? "";
      bytes.push(parseInt(octal, 8) & 0xff);
      i += octal.length;
    } else if (next === "x" && /[0-9a-fA-F]/.test(field[i + 2] ?? "")) {
      const hex = /^[0-9a-fA-F]{1,2}/.exec(field.slice(i + 2))?.[0] ?? "";
      bytes.push(parseInt(hex, 16));
      i += 1 + hex.length;
    } else {
      push(next);
      i += 1;
    }
  }
  return Buffer.from(bytes).toString("utf8");
}

/**
 * Counts the rows of each table in a data dump, fed one line at a time (the
 * files are too large to hold in memory), and keeps the rows of the tables
 * in `keep` as objects. In COPY text format one row is one line: new lines
 * inside values are written as \n, and the block ends with a line holding
 * only \. — so the count is exactly what a restore will insert.
 * @param {string[]} [keep] "schema.table" names whose rows to keep
 */
export function createRowCounter(keep = []) {
  const wanted = new Set(keep);
  /** @type {Record<string, number>} */
  const counts = {};
  // A kept table appears here only once its COPY line has been seen, so a
  // dump without it can be told apart from an empty table.
  /** @type {Record<string, Record<string, string | null>[]>} */
  const kept = {};
  /** @type {{ table: string, columns: string[] } | null} */
  let current = null;
  return {
    /** @param {string} line */
    line(line) {
      if (current === null) {
        const header = parseCopyHeader(line);
        if (header !== null) {
          current = header;
          counts[header.table] = counts[header.table] ?? 0;
          if (wanted.has(header.table)) kept[header.table] = kept[header.table] ?? [];
        }
        return;
      }
      if (line === "\\.") {
        current = null;
        return;
      }
      counts[current.table] += 1;
      if (wanted.has(current.table)) {
        const fields = line.split("\t");
        if (fields.length !== current.columns.length) {
          throw new Error(`A row of ${current.table} has ${fields.length} fields; its header names ${current.columns.length}.`);
        }
        const columns = current.columns;
        kept[current.table].push(Object.fromEntries(fields.map((f, i) => [columns[i], decodeCopyField(f)])));
      }
    },
    /** @returns {Record<string, number>} */
    counts() {
      if (current !== null) throw new Error(`The dump ends inside the data for ${current.table}; it is truncated.`);
      return sortKeys(counts);
    },
    /** @returns {Record<string, Record<string, string | null>[]>} */
    rows() {
      return kept;
    },
  };
}

/**
 * @param {string} text the whole file
 * @returns {Record<string, number>}
 */
export function countRows(text) {
  const counter = createRowCounter();
  for (const line of text.split("\n")) counter.line(line.replace(/\r$/, ""));
  return counter.counts();
}

/** @param {string} name */
function quoteIdent(name) {
  return `"${name.replace(/"/g, '""')}"`;
}

/**
 * One query that counts every table the dump wrote to, for the restored
 * database: prints `schema.table|count` per row with psql -At.
 * @param {string[]} tables "schema.table" names as copyTarget returns them
 */
export function countQuery(tables) {
  if (tables.length === 0) return "select 'none', 0 where false;";
  const parts = tables.map((name) => {
    const dot = splitTableName(name);
    return `select ${quoteLiteral(name)} as t, count(*) as n from ${quoteIdent(dot.schema)}.${quoteIdent(dot.table)}`;
  });
  return `${parts.join("\nunion all ")};`;
}

/** @param {string} name */
function splitTableName(name) {
  // Schema names in this database never contain a dot; table names may not
  // either, but split on the first dot so a strange table name survives.
  const at = name.indexOf(".");
  if (at <= 0) throw new Error(`Not a schema.table name: ${name}`);
  return { schema: name.slice(0, at), table: name.slice(at + 1) };
}

/** @param {string} text */
export function quoteLiteral(text) {
  return `'${text.replace(/'/g, "''")}'`;
}

/**
 * Reads `name|count` lines (psql -At output) into an object.
 * @param {string} text
 * @returns {Record<string, number>}
 */
export function parseCounts(text) {
  /** @type {Record<string, number>} */
  const counts = {};
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const at = line.lastIndexOf("|");
    if (at <= 0) throw new Error(`Unreadable count line: ${line}`);
    const value = Number(line.slice(at + 1));
    if (!Number.isInteger(value) || value < 0) throw new Error(`Unreadable count line: ${line}`);
    counts[line.slice(0, at)] = value;
  }
  return counts;
}

/**
 * Every expected count against the actual one. A name missing from
 * `actual` counts as a mismatch (the table did not come back at all); names
 * only in `actual` are ignored, because a restored project has tables the
 * dump never wrote to (empty platform tables).
 * @param {Record<string, number>} expected
 * @param {Record<string, number>} actual
 * @param {{ skip?: string[] }} [options] names not checked, with the reason given by the caller
 */
export function compareCounts(expected, actual, options = {}) {
  const skip = new Set(options.skip ?? []);
  /** @type {{ name: string, expected: number, actual: number | null }[]} */
  const mismatches = [];
  let checked = 0;
  for (const [name, want] of Object.entries(expected)) {
    if (skip.has(name)) continue;
    checked += 1;
    const got = Object.prototype.hasOwnProperty.call(actual, name) ? actual[name] : null;
    if (got !== want) mismatches.push({ name, expected: want, actual: got });
  }
  return { ok: mismatches.length === 0, checked, mismatches };
}

// ---------------------------------------------------------------------------
// Is every table with rows in the dump?
// ---------------------------------------------------------------------------

/**
 * Schemas whose tables a backup leaves out on purpose: the platform's own
 * bookkeeping and live state (Realtime, the pooler, analytics, replication),
 * extensions' schemas (their content comes back through platform.sql or is
 * not kept; see the runbook), and Vault, which Supabase's dump never copies.
 * Every schema Supabase CLI 2.121.0's data dump excludes is here (tested),
 * apart from supabase_migrations, which the backup copies on its own, and
 * the name patterns below.
 */
export const SCHEMAS_NOT_DUMPED = [
  "_analytics",
  "_realtime",
  "_supavisor",
  "cron",
  "etl",
  "extensions",
  "graphql",
  "graphql_public",
  "information_schema",
  "net",
  "pg_catalog",
  "pgbouncer",
  "pgmq",
  "pgsodium",
  "pgsodium_masks",
  "pgtle",
  "realtime",
  "repack",
  "tiger",
  "tiger_data",
  "topology",
  "vault",
];

/** Schema name patterns the CLI's data dump also excludes (pg_*, timescaledb_*, _timescaledb_*). */
export const SCHEMA_PATTERNS_NOT_DUMPED = [/^pg_/, /^timescaledb_/, /^_timescaledb_/];

/**
 * Single tables a backup leaves out on purpose: each platform service's own
 * migration record (the new project has its own), and the two vector tables
 * Supabase's restore guide excludes from the data dump.
 */
export const TABLES_NOT_DUMPED = [
  "auth.schema_migrations",
  "storage.migrations",
  "supabase_functions.migrations",
  "storage.buckets_vectors",
  "storage.vector_indexes",
];

/**
 * Lists, in the source database, every ordinary table that holds at least
 * one row (`schema.table|rows`), or that the backup cannot read
 * (`schema.table|unreadable`), outside the schemas above and outside
 * extensions. Run before the dump; manifest.mjs build then fails the backup
 * when one of them is missing from the dump. Creates nothing in the
 * database: each table is probed with query_to_xml.
 */
export const TABLES_WITH_ROWS_QUERY = `
with candidate as materialized (
  select c.oid, n.nspname, c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where c.relkind = 'r'
     and n.nspname not in (${SCHEMAS_NOT_DUMPED.map(quoteLiteral).join(", ")})
     and n.nspname not like 'pg\\_%'
     and n.nspname !~ '^_?timescaledb_'
     and not exists (select 1 from pg_depend d
                      where d.classid = 'pg_class'::regclass and d.objid = c.oid and d.deptype = 'e')
)
select nspname || '.' || relname || '|' ||
       case when has_table_privilege(oid, 'SELECT') then 'rows' else 'unreadable' end
  from candidate
 where case when not has_table_privilege(oid, 'SELECT') then true
            else (xpath('//e/text()', query_to_xml(format('select exists (select 1 from %I.%I) as e', nspname, relname),
                                                    false, false, '')))[1]::text = 'true'
       end
 order by 1;
`;

/**
 * The tables that hold rows in the source but have no data in the dump.
 * @param {string} sourceText TABLES_WITH_ROWS_QUERY output
 * @param {Iterable<string>} dumped "schema.table" names the dump has a COPY block for
 */
export function tablesMissingFromDump(sourceText, dumped) {
  const have = new Set(dumped);
  const skip = new Set(TABLES_NOT_DUMPED);
  /** @type {string[]} */
  const missing = [];
  /** @type {string[]} */
  const unreadable = [];
  for (const raw of sourceText.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const at = line.lastIndexOf("|");
    const name = at > 0 ? line.slice(0, at) : line;
    const state = at > 0 ? line.slice(at + 1) : "rows";
    if (skip.has(name)) continue;
    if (state === "unreadable") unreadable.push(name);
    else if (!have.has(name)) missing.push(name);
  }
  return { missing: missing.sort(), unreadable: unreadable.sort() };
}

// ---------------------------------------------------------------------------
// The statements the three-part dump leaves out
// ---------------------------------------------------------------------------

/**
 * How many of each kind of statement scripts/backup/platform-extras.sql wrote
 * into platform.sql, so the drill can check the same number came back.
 * @param {string} text platform.sql
 */
export function platformCounts(text) {
  const count = (/** @type {RegExp} */ pattern) => (text.match(pattern) ?? []).length;
  return {
    policies: count(/^CREATE POLICY /gm),
    triggers: count(/^CREATE OR REPLACE TRIGGER /gm),
    queues: count(/^SELECT pgmq\.create(?:_unlogged)?\(/gm),
    cronJobs: count(/^SELECT cron\.schedule\(/gm),
  };
}

/**
 * Counts the same four things in a restored database, as `name|count` rows.
 * Triggers are the ones the app put on auth and storage tables (their
 * function lives outside those schemas); the platform's own are not counted.
 */
export const PLATFORM_COUNT_QUERY = `
select 'policies', count(*) from pg_policies where schemaname in ('auth', 'storage')
union all
select 'triggers', count(*)
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  join pg_proc f on f.oid = t.tgfoid
  join pg_namespace fn on fn.oid = f.pronamespace
 where not t.tgisinternal and t.tgconstraint = 0
   and n.nspname in ('auth', 'storage') and fn.nspname not in ('auth', 'storage')
union all
select 'queues', case when to_regclass('pgmq.meta') is null then 0
  else (xpath('//n/text()', query_to_xml('select count(*) as n from pgmq.meta', false, false, '')))[1]::text::int end
union all
select 'cronJobs', case when to_regclass('cron.job') is null then 0
  else (xpath('//n/text()', query_to_xml('select count(*) as n from cron.job', false, false, '')))[1]::text::int end;
`;

// ---------------------------------------------------------------------------
// Storage: which files a backup holds
// ---------------------------------------------------------------------------

/**
 * Where an object is kept in an unpacked backup: storage/objects/<bucket>/<path>.
 * Refuses names that would escape that folder or that a file system cannot
 * hold, so a restore never writes outside its working directory.
 * @param {string} bucket
 * @param {string} path the object's name within its bucket
 * @returns {string} a relative path with forward slashes
 */
export function objectFilePath(bucket, path) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(bucket) || bucket === "." || bucket === "..") {
    throw new Error(`Refusing bucket name ${JSON.stringify(bucket)}.`);
  }
  if (typeof path !== "string" || path.length === 0 || path.startsWith("/") || path.includes("\0")) {
    throw new Error(`Refusing object path ${JSON.stringify(path)} in ${bucket}.`);
  }
  const segments = path.split("/");
  for (const segment of segments) {
    if (segment === "" || segment === "." || segment === "..") {
      throw new Error(`Refusing object path ${JSON.stringify(path)} in ${bucket}.`);
    }
  }
  return ["storage", "objects", bucket, ...segments].join("/");
}

/**
 * Why a stored file's name cannot be backed up and restored, or null when
 * it can. Storage's address handling turns "." and ".." segments into other
 * names (a/../b.pdf is fetched as b.pdf), and a restore cannot write them,
 * so such a file is reported rather than copied under the wrong bytes.
 * @param {string} bucket
 * @param {string} path
 */
export function objectNameProblem(bucket, path) {
  try {
    objectFilePath(bucket, path);
    return null;
  } catch {
    return "its name has an empty, '.' or '..' part, which cannot be copied or restored as it is; rename the file in the app";
  }
}

/**
 * @typedef {{ bucket: string, path: string, id: string | null, version: string | null,
 *   size: number | null, eTag: string | null, contentType: string | null, cacheControl?: string | null,
 *   updatedAt: string | null }} StoredObject
 */

/**
 * The buckets and stored files a data dump lists (storage.buckets and
 * storage.objects). The backup copies exactly these: the file list is the
 * database's at the moment of the dump, so the files and the database agree,
 * and names come exactly as stored (Storage's folder listing matches names
 * without regard to case, which the database does not). Delete markers and
 * archived versions have no current bytes and are only counted.
 * @param {Record<string, Record<string, string | null>[]>} rows from createRowCounter(["storage.buckets", "storage.objects"])
 */
export function storageFromDump(rows) {
  const bucketRows = rows["storage.buckets"];
  const objectRows = rows["storage.objects"];
  // createRowCounter adds a table only when its COPY line was seen.
  if (!bucketRows || !objectRows) throw new Error("The data dump has no storage.buckets or storage.objects data.");
  const buckets = bucketRows
    .map((b) => ({
      id: String(b.id),
      public: b.public === "t",
      file_size_limit: b.file_size_limit === null || b.file_size_limit === undefined ? null : Number(b.file_size_limit),
      allowed_mime_types: parsePgTextArray(b.allowed_mime_types ?? null),
    }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  /** @type {StoredObject[]} */
  const objects = [];
  let skipped = 0;
  for (const o of objectRows) {
    if (o.is_delete_marker === "t" || (o.archived_at !== undefined && o.archived_at !== null)) {
      skipped += 1;
      continue;
    }
    /** @type {Record<string, unknown>} */
    let metadata = {};
    try {
      metadata = o.metadata ? JSON.parse(o.metadata) : {};
    } catch {
      metadata = {};
    }
    const size = typeof metadata.size === "number" ? metadata.size : null;
    objects.push({
      bucket: String(o.bucket_id),
      path: String(o.name),
      id: o.id ?? null,
      version: o.version ?? null,
      size,
      eTag: typeof metadata.eTag === "string" ? metadata.eTag : null,
      contentType: typeof metadata.mimetype === "string" ? metadata.mimetype : null,
      cacheControl: typeof metadata.cacheControl === "string" ? metadata.cacheControl : null,
      updatedAt: o.updated_at ?? null,
    });
  }
  objects.sort(compareByKey);
  return { buckets, objects, skipped };
}

/**
 * A Postgres text[] literal ({a,b,"c d"}) as an array, or null.
 * @param {string | null} text
 * @returns {string[] | null}
 */
export function parsePgTextArray(text) {
  if (text === null) return null;
  const inner = text.replace(/^\{|\}$/g, "");
  if (inner === "") return [];
  /** @type {string[]} */
  const items = [];
  const pattern = /"((?:[^"\\]|\\.)*)"|([^,]+)/g;
  for (const match of inner.matchAll(pattern)) {
    items.push(match[1] !== undefined ? match[1].replace(/\\(.)/g, "$1") : match[2]);
  }
  return items;
}

/**
 * What identifies one version of one stored file without naming it: the
 * bucket, the row's id, Storage's version id (new on every upload), size,
 * eTag and last change. The same fingerprint on two nights means the same
 * bytes, so the second night need not download them. Names are left out on
 * purpose: the index that carries fingerprints is stored unencrypted.
 * @param {StoredObject} o
 */
export function fingerprint(o) {
  const parts = [o.bucket, o.id ?? "", o.version ?? "", o.size ?? "", o.eTag ?? "", o.updatedAt ?? ""];
  return createHash("sha256").update(parts.join("\n")).digest("hex");
}

/**
 * The month folder a blob made at `date` goes in: "YYYY-MM" in UTC.
 * @param {Date} date
 */
export function generationOf(date) {
  return date.toISOString().slice(0, 7);
}

/** @param {string} generation "YYYY-MM" */
export function previousGeneration(generation) {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(generation);
  if (!match) throw new Error(`Not a YYYY-MM generation: ${generation}`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  return month === 1 ? `${year - 1}-12` : `${match[1]}-${String(month - 1).padStart(2, "0")}`;
}

/**
 * The bucket folder for one environment's blobs made in one month and
 * encrypted to one set of keys: blobs/<environment>/<YYYY-MM>-<tag>/.
 * @param {string} environment
 * @param {string} generation "YYYY-MM"
 * @param {string} tag recipientTag of the keys
 */
export function blobPrefix(environment, generation, tag) {
  if (!/^[a-z][a-z0-9-]*$/.test(environment)) throw new Error(`Refusing environment name ${environment}.`);
  previousGeneration(generation); // validates
  if (typeof tag !== "string" || !/^[0-9a-f]{16}$/.test(tag)) throw new Error(`Not a recipient tag: ${tag} (16 hex characters).`);
  return `blobs/${environment}/${generation}-${tag}/`;
}

/**
 * The parts of a blob folder name, or null when it is not one.
 * @param {unknown} prefix
 */
export function parseBlobPrefix(prefix) {
  const match = /^blobs\/([a-z][a-z0-9-]*)\/(\d{4}-(?:0[1-9]|1[0-2]))-([0-9a-f]{16})\/$/.exec(String(prefix));
  return match ? { environment: match[1], generation: match[2], tag: match[3] } : null;
}

/**
 * A blob's object name in its folder: <sha256>.age, or <sha256>.<n>.age
 * (n from 2) when a run found <sha256>.age already taken by an object no
 * signed index vouches for (left by a failed run, or planted by someone
 * holding the bucket key, which can add objects but not replace them).
 */
const BLOB_NAME = /^([0-9a-f]{64})(?:\.([2-9]|[1-9]\d+))?\.age$/;

/**
 * The sha256 a blob name belongs to, or null when it is not a blob name.
 * @param {string} name
 */
export function blobNameSha(name) {
  return BLOB_NAME.exec(name)?.[1] ?? null;
}

/**
 * The object name a blob record points at in its folder.
 * @param {{ sha256: string, name?: string, encSize?: number, encSha256?: string | null }} record
 */
export function blobFileName(record) {
  return record.name ?? `${record.sha256}.age`;
}

/**
 * The first name for a new blob of `sha256` that nothing in the folder
 * holds yet: <sha256>.age, else <sha256>.2.age, <sha256>.3.age, ….
 * @param {string} sha256
 * @param {Map<string, number>} listing the folder, name → size
 */
export function freeBlobName(sha256, listing) {
  if (!listing.has(`${sha256}.age`)) return `${sha256}.age`;
  for (let n = 2; ; n += 1) {
    if (!listing.has(`${sha256}.${n}.age`)) return `${sha256}.${n}.age`;
  }
}

/**
 * The blobs under one prefix, from `key<TAB>size` lines (the bucket
 * listing), as blob name → encrypted size. Anything that is not a blob name
 * is left out.
 * @param {string} text
 * @param {string} prefix
 * @returns {Map<string, number>}
 */
export function parseBlobListing(text, prefix) {
  /** @type {Map<string, number>} */
  const blobs = new Map();
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line === "None") continue;
    const [key, size] = line.split("\t");
    if (!key.startsWith(prefix)) continue;
    const name = key.slice(prefix.length);
    if (BLOB_NAME.test(name) && Number.isInteger(Number(size))) blobs.set(name, Number(size));
  }
  return blobs;
}

/**
 * Every blob folder of one environment and one set of keys in a listing of
 * blobs/<environment>/, as folder → (blob name → size).
 * @param {string} text `key<TAB>size` lines
 * @param {string} environment
 * @param {string} tag recipientTag of the keys
 * @returns {Map<string, Map<string, number>>}
 */
export function parseBlobFolders(text, environment, tag) {
  /** @type {Map<string, Map<string, number>>} */
  const folders = new Map();
  for (const raw of text.split("\n")) {
    const [key, size] = raw.trim().split("\t");
    if (!key || size === undefined) continue;
    const at = key.lastIndexOf("/");
    const folder = key.slice(0, at + 1);
    const where = parseBlobPrefix(folder);
    if (!where || where.environment !== environment || where.tag !== tag) continue;
    const name = key.slice(at + 1);
    if (!BLOB_NAME.test(name) || !Number.isInteger(Number(size))) continue;
    if (!folders.has(folder)) folders.set(folder, new Map());
    /** @type {Map<string, number>} */ (folders.get(folder)).set(name, Number(size));
  }
  return folders;
}

// ---------------------------------------------------------------------------
// The signed index
// ---------------------------------------------------------------------------

/**
 * JSON with every object's keys sorted, so the same index always gives the
 * same bytes to sign.
 * @param {unknown} value
 * @returns {string}
 */
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map((v) => (v === undefined ? "null" : canonicalJson(v))).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = /** @type {Record<string, unknown>} */ (value);
    const keys = Object.keys(record)
      .filter((k) => record[k] !== undefined)
      .sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(record[k])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** Fewer different byte values than this in 32 or more bytes: not random. */
const MIN_DISTINCT_KEY_BYTES = 16;

/**
 * BACKUP_INDEX_KEY as bytes: at least 32 random bytes, written as hex or
 * base64 (`openssl rand -base64 32`). A key that repeats a few values (all
 * zero bytes, a pattern typed by hand) is refused: 32 random bytes hold
 * about 30 different values. The message never repeats the value.
 * @param {string | undefined} text
 */
export function parseIndexKey(text) {
  const value = String(text ?? "").trim();
  if (!value) throw new Error("BACKUP_INDEX_KEY is not set.");
  let bytes;
  if (/^[0-9a-fA-F]+$/.test(value) && value.length % 2 === 0) bytes = Buffer.from(value, "hex");
  else if (/^[A-Za-z0-9+/_-]+={0,2}$/.test(value)) bytes = Buffer.from(value, "base64");
  else throw new Error("BACKUP_INDEX_KEY is neither hex nor base64.");
  if (bytes.length < 32) {
    throw new Error(`BACKUP_INDEX_KEY holds ${bytes.length} bytes; it must hold at least 32 random bytes (make one with: openssl rand -base64 32).`);
  }
  if (new Set(bytes).size < MIN_DISTINCT_KEY_BYTES) {
    throw new Error("BACKUP_INDEX_KEY does not look random (it repeats the same few byte values); make one with: openssl rand -base64 32");
  }
  return bytes;
}

/**
 * HMAC-SHA256 of the index without its `mac` field, as hex.
 * @param {Record<string, unknown>} index
 * @param {Buffer} key from parseIndexKey
 */
export function indexMac(index, key) {
  const unsigned = { ...index };
  delete unsigned.mac;
  return createHmac("sha256", key).update(canonicalJson(unsigned)).digest("hex");
}

/**
 * @typedef {{ sha256: string, encSize: number, encSha256: string | null, name?: string }} BlobRecord
 *   a blob as first stored: the sha256 of the plain file, the size and
 *   sha256 of its encrypted bytes (null when not known: such a blob is never
 *   trusted), and its object name when that is not <sha256>.age
 */

/**
 * @typedef {{ usable: boolean, reason: "none" | "format" | "environment" | "signature" | "key" | null,
 *   files: Map<string, { sha256: string, size: number }>, blobs: Map<string, BlobRecord>,
 *   blobPrefix: string | null, generation: string | null, tag: string | null }} PreviousIndex
 */

/**
 * The previous night's index, if it can be trusted: the right format and
 * environment, a valid signature (BACKUP_INDEX_KEY), and, when `indexKey`
 * (the bucket key it was read from) is given, the run that key names: its
 * archive name must be the key's, and its createdAt no later than the key's
 * second and no more than two hours before it (the manifest is written just
 * before the archive is named). The signature covers the content but not
 * the key, so without this a real, older index copied to a newer key would
 * pass (`reason` "key"). Anything else counts as no index (`usable` false,
 * `reason` says why): every file is then downloaded again, which costs
 * traffic but never correctness.
 * @param {unknown} index the parsed JSON, or null
 * @param {string} environment
 * @param {Buffer} key from parseIndexKey
 * @param {string} [indexKey] the bucket key it was read from
 * @returns {PreviousIndex}
 */
export function readPreviousIndex(index, environment, key, indexKey) {
  /** @param {PreviousIndex["reason"]} reason @returns {PreviousIndex} */
  const unusable = (reason) => ({ usable: false, reason, files: new Map(), blobs: new Map(), blobPrefix: null, generation: null, tag: null });
  if (index === null || index === undefined) return unusable("none");
  if (typeof index !== "object" || Array.isArray(index)) return unusable("format");
  const value = /** @type {Record<string, unknown>} */ (index);
  if (value.format !== INDEX_FORMAT) return unusable("format");
  if (value.environment !== environment) return unusable("environment");
  if (typeof value.mac !== "string" || !/^[0-9a-f]{64}$/.test(value.mac)) return unusable("signature");
  if (!timingSafeEqual(Buffer.from(indexMac(value, key), "hex"), Buffer.from(value.mac, "hex"))) return unusable("signature");
  if (indexKey !== undefined && !indexMatchesKey(value, environment, indexKey)) return unusable("key");
  const where = parseBlobPrefix(value.blobPrefix);
  if (
    !where ||
    where.environment !== environment ||
    where.generation !== value.generation ||
    where.tag !== value.recipients ||
    !Array.isArray(value.files) ||
    !Array.isArray(value.blobs)
  ) {
    return unusable("format");
  }
  /** @type {Map<string, { sha256: string, size: number }>} */
  const files = new Map();
  for (const entry of value.files) {
    const e = /** @type {{ fp?: unknown, sha256?: unknown, size?: unknown }} */ (entry);
    if (typeof e.fp === "string" && HEX64.test(e.fp) && typeof e.sha256 === "string" && HEX64.test(e.sha256) && typeof e.size === "number") {
      files.set(e.fp, { sha256: e.sha256, size: e.size });
    }
  }
  /** @type {Map<string, BlobRecord>} */
  const blobs = new Map();
  for (const entry of value.blobs) {
    const record = blobRecordOf(entry);
    if (record) blobs.set(record.sha256, record);
  }
  return { usable: true, reason: null, files, blobs, blobPrefix: /** @type {string} */ (value.blobPrefix), generation: where.generation, tag: where.tag };
}

const HEX64 = /^[0-9a-f]{64}$/;

/** How long before its archive is named a run's manifest may be written. */
const MAX_RUN_LEAD_MS = 2 * 3600_000;

/**
 * True when an index records the run its bucket key names: the archive
 * name the key gives, and a createdAt from that run (at most the key's
 * second, and at most MAX_RUN_LEAD_MS before it).
 * @param {Record<string, unknown>} value
 * @param {string} environment
 * @param {string} indexKey
 */
function indexMatchesKey(value, environment, indexKey) {
  const time = indexKeyTime(indexKey, environment);
  if (time === null) return false;
  const archive = `${String(indexKey.split("/").at(-1)).replace(/\.index\.json$/, "")}.tar.gz.age`;
  if (value.archive !== archive) return false;
  if (typeof value.createdAt !== "string") return false;
  const created = Date.parse(value.createdAt);
  if (Number.isNaN(created)) return false;
  return created < time.getTime() + 1000 && created >= time.getTime() - MAX_RUN_LEAD_MS;
}

/**
 * @param {unknown} entry
 * @returns {BlobRecord | null}
 */
function blobRecordOf(entry) {
  const e = /** @type {{ sha256?: unknown, encSize?: unknown, encSha256?: unknown }} */ (entry ?? {});
  if (typeof e.sha256 !== "string" || !HEX64.test(e.sha256)) return null;
  if (typeof e.encSize !== "number" || !Number.isInteger(e.encSize) || e.encSize < 0) return null;
  if (e.encSha256 !== null && (typeof e.encSha256 !== "string" || !HEX64.test(e.encSha256))) return null;
  const n = /** @type {{ name?: unknown }} */ (entry).name;
  if (n === undefined || n === null) return { sha256: e.sha256, encSize: e.encSize, encSha256: e.encSha256 };
  if (typeof n !== "string" || blobNameSha(n) !== e.sha256) return null;
  return n === `${e.sha256}.age` ? { sha256: e.sha256, encSize: e.encSize, encSha256: e.encSha256 } : { sha256: e.sha256, encSize: e.encSize, encSha256: e.encSha256, name: n };
}

/**
 * The record to keep when a blob is met twice in one night: never one
 * without the encrypted sha256 over one with it.
 * @param {BlobRecord | undefined} kept
 * @param {BlobRecord} next
 * @returns {BlobRecord}
 */
export function mergeBlobRecord(kept, next) {
  if (kept && kept.encSha256 !== null && next.encSha256 === null) return kept;
  return next;
}

/**
 * @typedef {BlobRecord & { from: string, check: string[], to: string }} CarryItem
 *   one blob to bring into this month's folder: copied from `from` in the
 *   previous folder to `to`, unless one of the objects already at the names
 *   in `check` (same size as recorded) turns out to hold exactly the
 *   recorded bytes
 */

/**
 * What the first night of a month (or the next night, when that one failed
 * after copying) brings from the folder the previous index points at into
 * this month's folder: every blob it recorded, if it is the same
 * environment and keys and an earlier month. Something already listed at a
 * blob's name proves nothing (a copy left by a failed night, or an object
 * planted there), so it is checked against the recorded size and sha256
 * (`check`); if none matches, the blob is copied to the first free name
 * (`to`). A blob whose encrypted sha256 was never recorded cannot be
 * checked, so it is not copied (its file is downloaded again instead).
 * @param {PreviousIndex} previous
 * @param {{ prefix: string, generation: string, tag: string, listing: Map<string, number> }} current listing: name → size
 */
export function carryPlan(previous, current) {
  /** @type {CarryItem[]} */
  const carry = [];
  let unverifiable = 0;
  if (
    !previous.usable ||
    previous.tag !== current.tag ||
    previous.blobPrefix === current.prefix ||
    !(String(previous.generation) < current.generation)
  ) {
    return { from: null, carry, unverifiable };
  }
  for (const record of previous.blobs.values()) {
    if (record.encSha256 === null) {
      unverifiable += 1;
      continue;
    }
    const check = [...current.listing]
      .filter(([name, size]) => blobNameSha(name) === record.sha256 && size === record.encSize)
      .map(([name]) => name)
      .sort(compareBlobNames);
    carry.push({ ...record, from: blobFileName(record), check, to: freeBlobName(record.sha256, current.listing) });
  }
  carry.sort((a, b) => (a.sha256 < b.sha256 ? -1 : a.sha256 > b.sha256 ? 1 : 0));
  return { from: previous.blobPrefix, carry, unverifiable };
}

/** <sha256>.age before <sha256>.2.age before <sha256>.10.age. @param {string} a @param {string} b */
function compareBlobNames(a, b) {
  const n = (/** @type {string} */ name) => Number(BLOB_NAME.exec(name)?.[2] ?? 1);
  return a.slice(0, 64) === b.slice(0, 64) ? n(a) - n(b) : a < b ? -1 : 1;
}

/**
 * The blobs in this month's folder the night may rely on: those a signed
 * index recorded with their encrypted size and sha256 and that are listed
 * under their recorded name at that size, either in the previous index of
 * this same folder, or carried (checked) into it tonight, under the name
 * `carried` gives. Any other object in the folder, whatever its name, is
 * never relied on.
 * @param {PreviousIndex} previous
 * @param {string} prefix this month's folder
 * @param {Map<string, number>} listing this month's folder, name → size
 * @param {Map<string, string>} carried sha256 → the name it was carried to tonight
 * @returns {Map<string, BlobRecord>}
 */
export function knownBlobs(previous, prefix, listing, carried) {
  /** @type {Map<string, BlobRecord>} */
  const known = new Map();
  if (!previous.usable) return known;
  for (const record of previous.blobs.values()) {
    if (record.encSha256 === null) continue;
    /** @type {BlobRecord} */
    let here;
    if (previous.blobPrefix === prefix) here = record;
    else if (carried.has(record.sha256)) {
      const name = /** @type {string} */ (carried.get(record.sha256));
      const plain = { sha256: record.sha256, encSize: record.encSize, encSha256: record.encSha256 };
      here = name === `${record.sha256}.age` ? plain : { ...plain, name };
    } else continue;
    if (listing.get(blobFileName(here)) === here.encSize) known.set(record.sha256, here);
  }
  return known;
}

/**
 * For each stored file: is it the same as last night (fingerprint in the
 * previous index), and is its blob in this month's folder under a record
 * the night can rely on (knownBlobs)? Only then can the download be skipped
 * (`keep`); everything else is downloaded from Supabase. (Last month's
 * blobs are copied into this month's folder before this runs: bucket.sh
 * state.)
 * @param {StoredObject[]} objects
 * @param {Map<string, { sha256: string, size: number }>} previousFiles PreviousIndex.files
 * @param {Map<string, unknown>} current the blobs relied on, by sha256 (knownBlobs)
 */
export function planObjects(objects, previousFiles, current) {
  return objects.map((object) => {
    const fp = fingerprint(object);
    const known = previousFiles.get(fp);
    if (known && (object.size === null || object.size === known.size) && current.has(known.sha256)) {
      return { object, fp, action: /** @type {"keep" | "download"} */ ("keep"), sha256: /** @type {string | null} */ (known.sha256), size: known.size };
    }
    return { object, fp, action: /** @type {"keep" | "download"} */ ("download"), sha256: /** @type {string | null} */ (null), size: object.size };
  });
}

/**
 * What to do with a freshly downloaded file's blob: already in this month's
 * folder under a record the night relies on (`keep`), or new (`upload`).
 * @param {string} sha256
 * @param {Map<string, unknown>} current the blobs relied on, by sha256
 * @returns {"keep" | "upload"}
 */
export function blobAction(sha256, current) {
  return current.has(sha256) ? "keep" : "upload";
}

/**
 * Where each downloaded file's blob goes, decided once per content even
 * when several files with the same content finish downloading at the same
 * moment. The first file that needs a new blob owns its storing (`seal`:
 * hash the encrypted file and move it to `name`); every other file with
 * that content waits for the same promise and gets the same record, and
 * its own encrypted copy is discarded. A blob already relied on (`known`)
 * is kept. A new blob goes under the first free name (freeBlobName): an
 * object already at <sha256>.age that no signed index vouches for is never
 * used. If storing fails, the next file with that content tries again.
 * @param {{
 *   listing: Map<string, number>,
 *   known: Map<string, BlobRecord>,
 *   seal: (tmp: string, name: string) => Promise<{ size: number, sha256: string }>,
 *   discard: (tmp: string) => Promise<void>,
 * }} io
 */
export function createBlobStore({ listing, known, seal, discard }) {
  /** @type {Map<string, Promise<BlobRecord>>} */
  const pending = new Map();
  let renamed = 0;
  return {
    /**
     * @param {string} sha256 the plain file's sha256
     * @param {string} tmp its freshly encrypted copy
     * @returns {Promise<{ record: BlobRecord, stored: boolean }>}
     */
    async store(sha256, tmp) {
      const kept = known.get(sha256);
      if (kept) {
        await discard(tmp);
        return { record: kept, stored: false };
      }
      const waiting = pending.get(sha256);
      if (waiting) {
        await discard(tmp);
        return { record: await waiting, stored: false };
      }
      // No await between the check above and this set: the first file
      // claims the content before any other can look.
      const name = freeBlobName(sha256, listing);
      const sealing = seal(tmp, name).then((encrypted) =>
        name === `${sha256}.age`
          ? { sha256, encSize: encrypted.size, encSha256: encrypted.sha256 }
          : { sha256, encSize: encrypted.size, encSha256: encrypted.sha256, name },
      );
      pending.set(sha256, sealing);
      try {
        const record = await sealing;
        if (name !== `${sha256}.age`) renamed += 1;
        return { record, stored: true };
      } catch (error) {
        if (pending.get(sha256) === sealing) pending.delete(sha256);
        throw error;
      }
    },
    /** How many new blobs went under another name than <sha256>.age. */
    renamed: () => renamed,
  };
}

/**
 * Every blob a backup needs against this month's folder after the upload:
 * present under its recorded name, and at the encrypted size recorded when
 * it was first stored. Names, not sha256s, are returned: a blob may be
 * stored under <sha256>.<n>.age.
 * @param {BlobRecord[]} blobs
 * @param {Map<string, number>} listing name → size
 */
export function checkBlobListing(blobs, listing) {
  /** @type {string[]} */
  const missing = [];
  /** @type {{ sha256: string, name: string, expected: number, actual: number }[]} */
  const wrong = [];
  for (const blob of blobs) {
    const name = blobFileName(blob);
    const size = listing.get(name);
    if (size === undefined) missing.push(name);
    else if (size !== blob.encSize) wrong.push({ sha256: blob.sha256, name, expected: blob.encSize, actual: size });
  }
  return { ok: missing.length === 0 && wrong.length === 0, missing: missing.sort(), wrong };
}

/**
 * @typedef {{ bucket: string, path: string, size: number, sha256: string, contentType: string | null,
 *   cacheControl?: string | null, blob: string }} ManifestObject
 */

/** @param {{ bucket: string, path: string }} o */
const objectKey = (o) => `${o.bucket}/${o.path}`;

/** @param {{ bucket: string, path: string }} a @param {{ bucket: string, path: string }} b */
function compareByKey(a, b) {
  const ka = objectKey(a);
  const kb = objectKey(b);
  return ka < kb ? -1 : ka > kb ? 1 : 0;
}

/**
 * The files the database listed that the export neither copied nor
 * recorded as a problem or as deleted while it ran. Always empty unless a
 * code path dropped a file; the export fails when it is not.
 * @param {{ bucket: string, path: string }[]} listed
 * @param {{ bucket: string, path: string }[][]} accounted
 */
export function unaccountedObjects(listed, accounted) {
  const seen = new Set(accounted.flat().map(objectKey));
  return listed.filter((o) => !seen.has(objectKey(o))).length;
}

/**
 * Compares the objects the manifest lists with the ones found (in the
 * unpacked backup, or re-downloaded from a restored project).
 * @param {{ bucket: string, path: string, size: number, sha256: string }[]} expected
 * @param {{ bucket: string, path: string, size: number, sha256: string }[]} actual
 */
export function compareObjects(expected, actual) {
  const found = new Map(actual.map((o) => [objectKey(o), o]));
  const wanted = new Set(expected.map(objectKey));
  /** @type {string[]} */
  const missing = [];
  /** @type {{ key: string, expected: string, actual: string }[]} */
  const changed = [];
  for (const want of expected) {
    const got = found.get(objectKey(want));
    if (!got) {
      missing.push(objectKey(want));
    } else if (got.sha256 !== want.sha256 || got.size !== want.size) {
      changed.push({
        key: objectKey(want),
        expected: `${want.size} bytes, sha256 ${want.sha256.slice(0, 12)}`,
        actual: `${got.size} bytes, sha256 ${got.sha256.slice(0, 12)}`,
      });
    }
  }
  const extra = actual.map(objectKey).filter((key) => !wanted.has(key)).sort();
  return {
    ok: missing.length === 0 && changed.length === 0 && extra.length === 0,
    checked: expected.length,
    missing: missing.sort(),
    changed,
    extra,
  };
}

/**
 * Rows in the restored storage.objects that the backup has no file for,
 * apart from those deleted from the source while the backup ran (their rows
 * are in the dump, their bytes were already gone) and, in a partial restore
 * (ALLOW_MISSING_FILES=1), the files known to be lost.
 * @param {{ bucket: string, path: string }[]} rows the restored rows
 * @param {{ bucket: string, path: string }[]} objects the manifest's files
 * @param {{ bucket: string, path: string }[]} deleted the manifest's deletedDuringBackup
 * @param {string[]} [lost] "bucket/path" keys a partial restore could not bring back
 */
export function rowsWithoutFiles(rows, objects, deleted, lost = []) {
  const gone = new Set(deleted.map(objectKey));
  const lostKeys = new Set(lost);
  const files = new Set(objects.map(objectKey).filter((key) => !lostKeys.has(key)));
  const unexpected = [];
  let expectedGone = 0;
  let lostRows = 0;
  for (const row of rows) {
    const key = objectKey(row);
    if (files.has(key)) continue;
    if (gone.has(key)) expectedGone += 1;
    else if (lostKeys.has(key)) lostRows += 1;
    else unexpected.push(key);
  }
  return { unexpected: unexpected.sort(), deletedDuringBackup: expectedGone, lost: lostRows };
}

/**
 * Each backed-up bucket's settings (public, size limit, allowed types)
 * against the restored storage.buckets rows.
 * @param {{ id: string, public: boolean, file_size_limit: number | null, allowed_mime_types: string[] | null }[]} expected
 * @param {[string, boolean, number | null, string[] | null][]} rows id, public, file_size_limit, allowed_mime_types
 */
export function compareBuckets(expected, rows) {
  const actual = new Map(rows.map(([id, isPublic, limit, types]) => [id, { public: isPublic, file_size_limit: limit ?? null, allowed_mime_types: types ?? null }]));
  /** @type {string[]} */
  const differences = [];
  for (const want of expected) {
    const got = actual.get(want.id);
    if (!got) {
      differences.push(`${want.id}: missing`);
      continue;
    }
    const same =
      got.public === want.public &&
      got.file_size_limit === (want.file_size_limit ?? null) &&
      JSON.stringify(got.allowed_mime_types) === JSON.stringify(want.allowed_mime_types ?? null);
    if (!same) {
      differences.push(
        `${want.id}: backed up public=${want.public} limit=${want.file_size_limit ?? "none"} types=${JSON.stringify(want.allowed_mime_types ?? null)}; ` +
          `restored public=${got.public} limit=${got.file_size_limit ?? "none"} types=${JSON.stringify(got.allowed_mime_types)}`,
      );
    }
  }
  return { ok: differences.length === 0, checked: expected.length, differences };
}

// ---------------------------------------------------------------------------
// Supabase traffic
// ---------------------------------------------------------------------------

/**
 * pg_dump's own catalog queries, which the dump files' sizes do not show.
 * Measured with a byte-counting proxy on 2026-10-22: about 9.5 MB a night
 * for the five pg_dump runs made then, 2 to 3 MB per run, growing with the
 * number of tables, functions and policies rather than with the data. Two
 * of those runs (the migration history, about 4 MB) were then replaced by
 * one psql query; measured again the same way the same day, a whole night's
 * database reads came to 5.47 MB more than the files it wrote. A fixed
 * estimate, labelled as one wherever it is shown.
 */
export const CATALOG_READ_BYTES = 5_500_000;

/** Above this projected monthly figure for one environment, the run warns. */
export const TRAFFIC_WARN_BYTES = 2 * 1024 ** 3;

/**
 * What one night read from Supabase, and the month at that rate.
 * @param {{ databaseBytes: number, extraDatabaseBytes?: number, catalogBytesEstimate?: number, storageBytes: number }} read
 */
export function trafficEstimate(read) {
  const database = read.databaseBytes + (read.extraDatabaseBytes ?? 0);
  // A dump redone because a migration landed meanwhile (extraDatabaseBytes)
  // read the catalog twice.
  const catalog = (read.catalogBytesEstimate ?? CATALOG_READ_BYTES) * ((read.extraDatabaseBytes ?? 0) > 0 ? 2 : 1);
  const night = database + catalog + read.storageBytes;
  return { database, catalog, files: read.storageBytes, night, month: night * 30, warn: night * 30 > TRAFFIC_WARN_BYTES };
}

/**
 * The manifest stored at the top of every archive.
 * @param {{
 *   environment: string,
 *   createdAt: string,
 *   source?: Record<string, string>,
 *   files: Record<string, { size: number, sha256: string }>,
 *   rows: Record<string, number>,
 *   platform: ReturnType<typeof platformCounts>,
 *   missingTables?: string[],
 *   unreadableTables?: string[],
 *   generation: string,
 *   blobPrefix?: string,
 *   buckets: Record<string, unknown>[],
 *   objects: ManifestObject[],
 *   blobs?: BlobRecord[],
 *   errors?: { bucket: string, path: string, error: string }[],
 *   warnings?: { bucket: string, path: string, warning: string }[],
 *   deletedDuringBackup?: { bucket: string, path: string }[],
 *   skippedVersions?: number,
 *   read?: { databaseBytes: number, extraDatabaseBytes?: number, catalogBytesEstimate?: number, storageBytes: number, storageFiles: number },
 * }} input
 */
export function buildManifest(input) {
  const objects = [...input.objects].sort(compareByKey);
  const rows = sortKeys(input.rows);
  const largest = objects.reduce((max, o) => Math.max(max, o.size), 0);
  return {
    format: MANIFEST_FORMAT,
    environment: input.environment,
    createdAt: input.createdAt,
    source: input.source ?? {},
    read: input.read ?? { databaseBytes: 0, catalogBytesEstimate: CATALOG_READ_BYTES, storageBytes: 0, storageFiles: 0 },
    database: {
      files: sortKeys(input.files),
      tables: Object.keys(rows).length,
      totalRows: Object.values(rows).reduce((sum, n) => sum + n, 0),
      rows,
      platform: input.platform,
      missingTables: input.missingTables ?? [],
      unreadableTables: input.unreadableTables ?? [],
    },
    storage: {
      generation: input.generation,
      blobPrefix: input.blobPrefix ?? null,
      buckets: [...input.buckets].sort((a, b) => String(a.id).localeCompare(String(b.id))),
      objectCount: objects.length,
      totalBytes: objects.reduce((sum, o) => sum + o.size, 0),
      largestBytes: largest,
      objects,
      blobs: [...(input.blobs ?? [])].sort((a, b) => (a.sha256 < b.sha256 ? -1 : a.sha256 > b.sha256 ? 1 : 0)),
      errors: [...(input.errors ?? [])].sort(compareByKey),
      warnings: [...(input.warnings ?? [])].sort(compareByKey),
      deletedDuringBackup: [...(input.deletedDuringBackup ?? [])].sort(compareByKey),
      skippedVersions: input.skippedVersions ?? 0,
    },
  };
}

/**
 * The index stored next to each archive, unencrypted, so the next night
 * knows which files it already has and a restore knows which blobs to
 * fetch. It names no file: only fingerprints, content hashes and sizes, and
 * for each blob the size and sha256 of its encrypted bytes, recorded when
 * it was first stored and carried forward. Signed with BACKUP_INDEX_KEY.
 * @param {{ environment: string, generation: string, recipients: string, createdAt: string, archive: string,
 *   archiveSize: number, archiveSha256: string,
 *   files: { fp: string, sha256: string, size: number }[], blobs: BlobRecord[] }} input
 * @param {Buffer} key from parseIndexKey
 */
export function buildIndex(input, key) {
  const files = [...input.files].sort((a, b) => (a.fp < b.fp ? -1 : a.fp > b.fp ? 1 : 0));
  const records = new Map(input.blobs.map((b) => [b.sha256, b]));
  const blobs = [...new Set(files.map((f) => f.sha256))].sort().map((sha256) => {
    const record = records.get(sha256);
    if (!record) throw new Error(`No blob record for ${sha256}.`);
    const name = blobFileName(record);
    return name === `${sha256}.age`
      ? { sha256, encSize: record.encSize, encSha256: record.encSha256 ?? null }
      : { sha256, encSize: record.encSize, encSha256: record.encSha256 ?? null, name };
  });
  const value = {
    format: INDEX_FORMAT,
    environment: input.environment,
    generation: input.generation,
    recipients: input.recipients,
    createdAt: input.createdAt,
    archive: input.archive,
    archiveSize: input.archiveSize,
    archiveSha256: input.archiveSha256,
    blobPrefix: blobPrefix(input.environment, input.generation, input.recipients),
    blobs,
    files,
  };
  return { ...value, mac: indexMac(value, key) };
}

// ---------------------------------------------------------------------------
// Fetching one backup for a restore
// ---------------------------------------------------------------------------

/** @param {string} environment */
function checkedEnvironment(environment) {
  if (!/^[a-z][a-z0-9-]*$/.test(environment)) throw new Error(`Refusing environment name ${environment}.`);
  return environment;
}

/**
 * The run time in an index key, or null when the key is not exactly
 * <environment>/<YYYY-MM-DD>/qbbe-<environment>-<YYYYMMDDTHHMMSSZ>.index.json
 * with the folder's date the run's date.
 * @param {string} key
 * @param {string} environment
 */
export function indexKeyTime(key, environment) {
  const env = checkedEnvironment(environment);
  const match = new RegExp(`^${env}/(\\d{4}-\\d{2}-\\d{2})/qbbe-${env}-(\\d{4})(\\d{2})(\\d{2})T(\\d{2})(\\d{2})(\\d{2})Z\\.index\\.json$`).exec(key);
  if (!match) return null;
  const [, folder, y, mo, d, h, mi, s] = match;
  if (folder !== `${y}-${mo}-${d}`) return null;
  const time = new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}Z`);
  return Number.isNaN(time.getTime()) ? null : time;
}

/**
 * The newest well-formed index key, ignoring any that claims a time more
 * than an hour from now (a planted name sorting last).
 * @param {string[]} keys
 * @param {string} environment
 * @param {Date} [now]
 */
export function newestIndexKey(keys, environment, now = new Date()) {
  const limit = now.getTime() + 3600_000;
  const good = keys.filter((key) => {
    const time = indexKeyTime(key, environment);
    return time !== null && time.getTime() <= limit;
  });
  return good.sort().at(-1) ?? null;
}

/**
 * The index keys a night (or `fetch latest`) considers, newest first: well
 * formed, dated no more than an hour ahead (a planted name sorting last),
 * and, unless `days` is null, from the last `days` days (default 40: every
 * archive is kept 35). `future` counts the keys dated further ahead.
 * @param {string[]} keys
 * @param {string} environment
 * @param {Date} [now]
 * @param {{ days?: number | null }} [options]
 */
export function indexCandidates(keys, environment, now = new Date(), options = {}) {
  const days = options.days === undefined ? 40 : options.days;
  const latest = now.getTime() + 3600_000;
  const earliest = days === null ? -Infinity : now.getTime() - days * 86_400_000;
  let future = 0;
  /** @type {string[]} */
  const good = [];
  for (const key of new Set(keys)) {
    const time = indexKeyTime(key, environment);
    if (time === null) continue;
    if (time.getTime() > latest) future += 1;
    else if (time.getTime() >= earliest) good.push(key);
  }
  good.sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
  return { keys: good, future };
}

/** At most this many copies a restore cannot check are fetched for one blob. */
const MAX_UNCHECKED_COPIES = 3;

/**
 * @typedef {{ key: string, size: number | null, sha256: string | null, local: string,
 *   kind: "primary" | "copy" | "unchecked" }} FetchCandidate
 *   one object to try for a blob: its bucket key, the size and sha256 it must
 *   have (null: cannot be checked here; the restore checks the file it
 *   decrypts to), and the name to save it under
 */

/**
 * For each blob a restore needs, the objects to try, in order: the name its
 * index recorded in its own folder; then identical copies (same name's sha256,
 * the recorded size) in any month folder of the same environment and keys
 * (the copy a new month made of it, or the one it was made from), which must
 * match the recorded sha256; then up to three copies that cannot be checked
 * here (another size: stored again from Supabase; or no sha256 recorded),
 * saved under their own names for unpack-blobs, which keeps the one that
 * decrypts to the file's sha256.
 * @param {BlobRecord[]} blobs
 * @param {string} primary the index's folder
 * @param {Map<string, Map<string, number>>} folders every folder of the same environment and keys, name → size
 * @returns {{ sha256: string, candidates: FetchCandidate[] }[]}
 */
export function fetchPlan(blobs, primary, folders) {
  const others = [...folders.keys()].filter((f) => f !== primary).sort();
  const order = [primary, ...others];
  return blobs.map((record) => {
    const name = blobFileName(record);
    const checked = record.encSha256 !== null;
    /** @type {FetchCandidate[]} */
    const candidates = [{ key: `${primary}${name}`, size: record.encSize, sha256: record.encSha256, local: name, kind: checked ? "primary" : "unchecked" }];
    /** @type {string[]} */
    const unchecked = [];
    for (const folder of order) {
      const listing = folders.get(folder) ?? new Map();
      const names = [...listing.keys()].filter((n) => blobNameSha(n) === record.sha256).sort(compareBlobNames);
      for (const other of names) {
        const key = `${folder}${other}`;
        if (key === candidates[0].key) continue;
        if (checked && listing.get(other) === record.encSize) {
          candidates.push({ key, size: record.encSize, sha256: record.encSha256, local: name, kind: "copy" });
        } else unchecked.push(key);
      }
    }
    unchecked.slice(0, MAX_UNCHECKED_COPIES).forEach((key, i) => {
      candidates.push({ key, size: null, sha256: null, local: `${record.sha256}.fallback-${i + 1}.age`, kind: "unchecked" });
    });
    return { sha256: record.sha256, candidates };
  });
}

/**
 * What `bucket.sh fetch` was asked for: `latest`, a date (the newest run of
 * that day), or one run, given as its time (YYYYMMDDTHHMMSSZ), its archive
 * or index name, or its key from the Backup run's summary.
 * @param {string} which
 * @param {string} environment
 * @returns {{ prefix: string, key: string | null }}
 */
export function parseFetchWhich(which, environment) {
  const env = checkedEnvironment(environment);
  if (which === "latest") return { prefix: `${env}/`, key: null };
  if (/^\d{4}-\d{2}-\d{2}$/.test(which)) return { prefix: `${env}/${which}/`, key: null };
  const base = String(which).split("/").at(-1) ?? "";
  const time = base.replace(new RegExp(`^qbbe-${env}-`), "").replace(/\.(tar\.gz\.age|index\.json)$/, "");
  const match = /^(\d{4})(\d{2})(\d{2})T\d{6}Z$/.exec(time);
  if (!match || (base !== time && !base.startsWith(`qbbe-${env}-`))) {
    throw new Error(
      `Cannot tell which backup "${which}" means. Give latest, a date (YYYY-MM-DD), or one run of ${env}: its time (YYYYMMDDTHHMMSSZ), its archive name (qbbe-${env}-<time>.tar.gz.age) or its key from the Backup run's summary.`,
    );
  }
  const date = `${match[1]}-${match[2]}-${match[3]}`;
  return { prefix: `${env}/${date}/`, key: `${env}/${date}/qbbe-${env}-${time}.index.json` };
}

/**
 * An index fetched for a restore, checked before any of its values is used
 * in a path: it is unsigned to the custodian (restores do not need
 * BACKUP_INDEX_KEY), so nothing in it may reach outside the folders it must
 * name. Throws on anything else.
 * @param {unknown} index the parsed JSON
 * @param {string} environment
 * @param {string} indexKey the bucket key it was fetched from
 */
export function checkFetchIndex(index, environment, indexKey) {
  const env = checkedEnvironment(environment);
  if (indexKeyTime(indexKey, env) === null) throw new Error("Refusing an index whose key is not a backup's index key.");
  const value = /** @type {Record<string, unknown>} */ (index ?? {});
  if (typeof index !== "object" || index === null || Array.isArray(index)) throw new Error("The index is not a JSON object.");
  if (value.format !== INDEX_FORMAT) throw new Error(`The index's format is ${String(value.format)}, not ${INDEX_FORMAT}.`);
  if (value.environment !== env) throw new Error(`The index is for ${String(value.environment)}, not ${env}.`);
  const archive = `${String(indexKey.split("/").at(-1)).replace(/\.index\.json$/, "")}.tar.gz.age`;
  if (value.archive !== archive || !new RegExp(`^qbbe-${env}-\\d{8}T\\d{6}Z\\.tar\\.gz\\.age$`).test(archive)) {
    throw new Error("The index's archive name is not the one its key names; refusing it.");
  }
  if (typeof value.archiveSha256 !== "string" || !HEX64.test(value.archiveSha256)) throw new Error("The index's archive sha256 is not 64 hex characters.");
  const where = parseBlobPrefix(value.blobPrefix);
  if (!where || where.environment !== env || where.generation !== value.generation) {
    throw new Error("The index's blob folder is not blobs/<environment>/<YYYY-MM>-<tag>/ for this backup; refusing it.");
  }
  if (!Array.isArray(value.blobs)) throw new Error("The index has no blob list.");
  /** @type {BlobRecord[]} */
  const blobs = [];
  for (const entry of value.blobs) {
    const record = blobRecordOf(entry);
    if (!record) throw new Error("The index lists a blob that is not a sha256 with its encrypted size; refusing it.");
    blobs.push(record);
  }
  return {
    archive,
    archiveSha256: value.archiveSha256,
    blobPrefix: /** @type {string} */ (value.blobPrefix),
    generation: where.generation,
    tag: where.tag,
    blobs,
  };
}

// ---------------------------------------------------------------------------
// The restore drill's guard
// ---------------------------------------------------------------------------

/**
 * What identifies a Postgres database in a connection URL: the Supabase
 * project ref when the URL names one (pooler user `postgres.<ref>`, or host
 * `db.<ref>.supabase.co`), otherwise host, port and database name.
 * @param {string} url
 */
export function databaseIdentity(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Not a database URL.");
  }
  if (!/^postgres(ql)?:$/.test(parsed.protocol)) throw new Error("Not a postgresql:// URL.");
  const user = decodeURIComponent(parsed.username);
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const ref =
    /^postgres\.([a-z0-9]{20})$/.exec(user)?.[1] ??
    /^db\.([a-z0-9]{20})\.supabase\.(co|com)$/.exec(host)?.[1] ??
    null;
  const local = isLocalHost(host);
  return {
    ref,
    host: local ? "localhost" : host,
    local,
    port: parsed.port || "5432",
    database: decodeURIComponent(parsed.pathname.replace(/^\//, "")) || "postgres",
  };
}

/** @param {string} host */
function isLocalHost(host) {
  return host === "localhost" || host === "::1" || /^127\./.test(host);
}

/**
 * True when two URLs reach the same database, as far as their text can say:
 * the same Supabase project, or the same host, port and database name.
 * @param {string} a
 * @param {string} b
 */
export function sameDatabase(a, b) {
  const x = databaseIdentity(a);
  const y = databaseIdentity(b);
  if (x.ref && y.ref) return x.ref === y.ref;
  if (x.ref && y.host.includes(x.ref)) return true;
  if (y.ref && x.host.includes(y.ref)) return true;
  return x.host === y.host && x.port === y.port && x.database === y.database;
}

/**
 * The Supabase project ref in an https://<ref>.supabase.co address, or null.
 * @param {string} url
 */
export function projectRefOf(url) {
  try {
    return /^([a-z0-9]{20})\.supabase\.(co|com)$/.exec(new URL(url).hostname)?.[1] ?? null;
  } catch {
    return null;
  }
}

/** @param {string} url */
function isLocalAddress(url) {
  try {
    return isLocalHost(new URL(url).hostname.toLowerCase().replace(/^\[|\]$/g, ""));
  } catch {
    return false;
  }
}

/**
 * An address as text to compare, with this computer's names for itself
 * (localhost, 127.x, ::1) made one.
 * @param {string} url
 */
function normalizeAddress(url) {
  const text = url.trim().replace(/\/+$/, "").toLowerCase();
  try {
    const parsed = new URL(text);
    if (isLocalHost(parsed.hostname.replace(/^\[|\]$/g, ""))) {
      const port = parsed.port || (parsed.protocol === "https:" ? "443" : "80");
      return `${parsed.protocol}//localhost:${port}${parsed.pathname.replace(/\/+$/, "")}`;
    }
  } catch {
    // not a URL: compared as text
  }
  return text;
}

/**
 * True when a database URL carries a password. The scripts refuse one: the
 * password goes in PGPASSWORD (or a private pgpass file), never in an
 * address that ends up in a process list or a log.
 * @param {string} url
 */
export function urlHasPassword(url) {
  const text = String(url ?? "");
  try {
    const parsed = new URL(text);
    if (parsed.password !== "") return true;
    if ([...parsed.searchParams.keys()].some((k) => k.toLowerCase() === "password")) return true;
  } catch {
    // libpq's keyword form (host=… user=… password=…), or not an address
    if (/^[a-z]+:\/\/[^/@]*:[^/@]*@/i.test(text)) return true;
  }
  return /(^|\s)password\s*=/i.test(text);
}

const STRONG_SSLMODES = new Set(["require", "verify-ca", "verify-full"]);

/**
 * TLS for a database connection: required for any database that is not on
 * this computer, so nobody on the network path can read the data (or the
 * password) in plain text. Only 127.x, localhost and ::1 (the local stack,
 * which has no TLS), or a host= parameter naming only those or a Unix
 * socket folder, are exempt; a host= parameter naming another computer
 * makes the database not local. Of a repeated sslmode the last counts, as
 * in libpq. Returns the PGSSLMODE to set (`require`), or null when the URL
 * or PGSSLMODE already asks for TLS, or the database is local. Throws when
 * either asks for less. libpq (psql) enforces the result; the Supabase
 * CLI's `db dump` does not: it uses TLS when the server offers it
 * (Supabase's hosted database always does) but does not refuse a
 * downgrade.
 * @param {string} url a postgresql:// URL (no password)
 * @param {string | undefined} pgsslmode the PGSSLMODE in the environment
 * @returns {{ mode: "require" | null }}
 */
export function databaseTls(url, pgsslmode) {
  let parsed;
  try {
    parsed = new URL(String(url));
  } catch {
    throw new Error("The database address must be a postgresql:// URL.");
  }
  if (!/^postgres(ql)?:$/.test(parsed.protocol)) throw new Error("The database address must be a postgresql:// URL.");
  // A host= parameter (a name, a list of names, or a Unix socket folder)
  // replaces the address's host, as in libpq; any one not on this computer
  // makes the database not local.
  const hostParams = parsed.searchParams.getAll("host");
  const hosts = hostParams.length > 0 ? hostParams.flatMap((h) => h.split(",")) : [parsed.hostname];
  const local = hosts.every((h) => {
    const host = h.trim().toLowerCase().replace(/^\[|\]$/g, "");
    return host.startsWith("/") || isLocalHost(host);
  });
  if (local) return { mode: null };
  // libpq keeps the last of a repeated parameter and other drivers the first,
  // so every value must be strong.
  const modes = parsed.searchParams.getAll("sslmode");
  const weak = modes.find((m) => !STRONG_SSLMODES.has(m));
  if (weak !== undefined) {
    throw new Error(`The database address asks for sslmode=${weak}; a database that is not on this computer is reached over TLS only: use sslmode=require (or verify-full).`);
  }
  if (modes.length > 0) return { mode: null };
  const fromEnv = (pgsslmode ?? "").trim();
  if (fromEnv === "") return { mode: "require" };
  if (STRONG_SSLMODES.has(fromEnv)) return { mode: null };
  throw new Error(`PGSSLMODE is ${fromEnv}; a database that is not on this computer is reached over TLS only: unset PGSSLMODE or set it to require (or verify-full).`);
}

/**
 * BACKUP_STORAGE_CONCURRENCY: how many files are downloaded or uploaded at
 * once. A whole number from 1 to 32; anything else stops the run rather
 * than silently copying nothing.
 * @param {string | undefined} text
 * @param {number} [fallback]
 */
export function parseConcurrency(text, fallback = 4) {
  if (text === undefined || text.trim() === "") return fallback;
  const value = Number(text);
  if (!Number.isInteger(value) || value < 1 || value > 32) {
    throw new Error("BACKUP_STORAGE_CONCURRENCY must be a whole number from 1 to 32.");
  }
  return value;
}

/**
 * The restore drill's refusal to touch production, as one decision.
 *
 * Refuses unless TARGET_DB_URL is set and PROTECT_DB_URL names at least one
 * database to keep away from. Refuses a target database that is a protected
 * database or belongs to a protected project (PROTECT_DB_URL's projects and
 * PROTECT_SUPABASE_URL's). With TARGET_SUPABASE_URL (the files go there,
 * replacing what has the same name), refuses a protected address or
 * project, and refuses unless it is the same project as TARGET_DB_URL — or
 * both are this computer's local stack — so the database check also covers
 * the files.
 * @param {Record<string, string | undefined>} env
 * @returns {{ ok: true, target: string } | { ok: false, reason: string }}
 */
export function checkRestoreTarget(env) {
  const refuse = (/** @type {string} */ reason) => ({ ok: /** @type {const} */ (false), reason });
  const target = (env.TARGET_DB_URL ?? "").trim();
  const protectedDbs = (env.PROTECT_DB_URL ?? "").split(/\s+/).filter(Boolean);
  const protectedAddresses = (env.PROTECT_SUPABASE_URL ?? "").split(/\s+/).filter(Boolean);
  if (!target) return refuse("TARGET_DB_URL is not set.");
  if (protectedDbs.length === 0) {
    return refuse("PROTECT_DB_URL is not set. Give production's database URL (no password needed), so the drill can refuse it.");
  }
  let identity;
  try {
    identity = databaseIdentity(target);
  } catch (error) {
    return refuse(`TARGET_DB_URL: ${/** @type {Error} */ (error).message}`);
  }
  /** @type {Set<string>} */
  const protectedRefs = new Set();
  for (const url of protectedDbs) {
    let other;
    try {
      other = databaseIdentity(url);
    } catch (error) {
      return refuse(`PROTECT_DB_URL: ${/** @type {Error} */ (error).message}`);
    }
    if (other.ref) protectedRefs.add(other.ref);
    if (sameDatabase(target, url)) {
      return refuse("TARGET_DB_URL is a protected database (PROTECT_DB_URL). A restore drill never touches production.");
    }
  }
  for (const address of protectedAddresses) {
    const ref = projectRefOf(address);
    if (ref) protectedRefs.add(ref);
  }
  if (identity.ref && protectedRefs.has(identity.ref)) {
    return refuse("TARGET_DB_URL belongs to a protected project. A restore drill never touches production.");
  }
  if ([...protectedRefs].some((ref) => identity.host.includes(ref))) {
    return refuse("TARGET_DB_URL's address names a protected project. A restore drill never touches production.");
  }
  const files = (env.TARGET_SUPABASE_URL ?? "").trim();
  if (files) {
    const filesRef = projectRefOf(files);
    if (protectedAddresses.some((address) => normalizeAddress(address) === normalizeAddress(files))) {
      return refuse("TARGET_SUPABASE_URL is the protected project (PROTECT_SUPABASE_URL). A restore drill never touches production.");
    }
    if (filesRef && protectedRefs.has(filesRef)) {
      return refuse("TARGET_SUPABASE_URL is a protected project. A restore drill never touches production.");
    }
    if (filesRef && identity.ref) {
      if (filesRef !== identity.ref) return refuse("TARGET_SUPABASE_URL and TARGET_DB_URL are different projects.");
    } else if (!(isLocalAddress(files) && identity.local)) {
      return refuse(
        "Cannot tell that TARGET_SUPABASE_URL and TARGET_DB_URL are the same project. Use the https://<ref>.supabase.co address and the project's pooler or db.<ref>.supabase.co connection string.",
      );
    }
  }
  return {
    ok: /** @type {const} */ (true),
    target: identity.ref ? `project ${identity.ref}` : `${identity.host}:${identity.port}/${identity.database}`,
  };
}

/**
 * The file restore's own refusal (restore-storage.mjs can run alone, for
 * example to put a few files into a side bucket). With TARGET_DB_URL, the
 * full check above. Without it: TARGET_SUPABASE_URL is required, at least one
 * protected project must be named, and the target must not be one of them.
 * @param {Record<string, string | undefined>} env
 * @returns {{ ok: true, target: string } | { ok: false, reason: string }}
 */
export function checkFilesTarget(env) {
  const refuse = (/** @type {string} */ reason) => ({ ok: /** @type {const} */ (false), reason });
  const files = (env.TARGET_SUPABASE_URL ?? "").trim();
  if (!files) return refuse("TARGET_SUPABASE_URL is not set.");
  if (!env.TARGET_SERVICE_ROLE_KEY) return refuse("TARGET_SERVICE_ROLE_KEY is not set.");
  if ((env.TARGET_DB_URL ?? "").trim()) return checkRestoreTarget(env);
  const protectedAddresses = (env.PROTECT_SUPABASE_URL ?? "").split(/\s+/).filter(Boolean);
  const protectedDbs = (env.PROTECT_DB_URL ?? "").split(/\s+/).filter(Boolean);
  if (protectedAddresses.length === 0 && protectedDbs.length === 0) {
    return refuse("Name the project to keep away from: PROTECT_SUPABASE_URL (production's address) or PROTECT_DB_URL.");
  }
  /** @type {Set<string>} */
  const protectedRefs = new Set();
  for (const address of protectedAddresses) {
    if (normalizeAddress(address) === normalizeAddress(files)) {
      return refuse("TARGET_SUPABASE_URL is the protected project (PROTECT_SUPABASE_URL).");
    }
    const ref = projectRefOf(address);
    if (ref) protectedRefs.add(ref);
  }
  for (const url of protectedDbs) {
    try {
      const ref = databaseIdentity(url).ref;
      if (ref) protectedRefs.add(ref);
    } catch (error) {
      return refuse(`PROTECT_DB_URL: ${/** @type {Error} */ (error).message}`);
    }
  }
  const ref = projectRefOf(files);
  if (ref && protectedRefs.has(ref)) return refuse("TARGET_SUPABASE_URL is a protected project.");
  return { ok: /** @type {const} */ (true), target: ref ? `project ${ref}` : files };
}

// ---------------------------------------------------------------------------

/**
 * @template T
 * @param {Record<string, T>} record
 * @returns {Record<string, T>}
 */
function sortKeys(record) {
  return Object.fromEntries(Object.entries(record).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/** @param {number} bytes */
export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = -1;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}
