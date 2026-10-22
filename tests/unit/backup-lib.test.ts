import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CATALOG_READ_BYTES,
  SCHEMAS_NOT_DUMPED,
  SCHEMA_PATTERNS_NOT_DUMPED,
  TABLES_WITH_ROWS_QUERY,
  blobAction,
  blobFileName,
  blobPrefix,
  buildIndex,
  buildManifest,
  carryPlan,
  checkBlobListing,
  checkFetchIndex,
  checkFilesTarget,
  checkRestoreTarget,
  compareBuckets,
  compareCounts,
  compareObjects,
  copyTarget,
  countQuery,
  createBlobStore,
  databaseTls,
  countRows,
  createRowCounter,
  databaseIdentity,
  decodeCopyField,
  fetchPlan,
  fingerprint,
  freeBlobName,
  generationOf,
  indexCandidates,
  indexKeyTime,
  knownBlobs,
  mergeBlobRecord,
  newestIndexKey,
  objectFilePath,
  objectNameProblem,
  parseBlobListing,
  parseBlobPrefix,
  parseConcurrency,
  parseCopyHeader,
  parseCounts,
  parseFetchWhich,
  parseIndexKey,
  parsePgTextArray,
  parseRecipients,
  planObjects,
  platformCounts,
  previousGeneration,
  projectRefOf,
  readPreviousIndex,
  recipientTag,
  rowsWithoutFiles,
  sameDatabase,
  storageFromDump,
  tablesMissingFromDump,
  trafficEstimate,
  unaccountedObjects,
  urlHasPassword,
} from "../../scripts/backup/lib.mjs";

/**
 * The decisions inside the nightly backup and the restore drill (DATA-001,
 * docs/runbooks/backup-recovery.md): what a dump holds, which files a night
 * must download and which it may take from the bucket, where a stored file
 * may land, when a restore counts as complete, and when the drill must refuse
 * its target. A wrong answer in any of these is a backup that looks fine and
 * restores short, a month of Supabase traffic spent in a week, or a drill
 * that writes over production.
 */

const RECIPIENT_A = "age1lqqlewea2m8y897m8ncrk58acexr2wqmky3yey706xh6z6uwlyjs5l7dge";
const RECIPIENT_B = "age186hymdxkq7r370msxfppkc2t860djr8qz2s92xt3z57n7a89gvnq9en9a9";
const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);
const SHA_C = "c".repeat(64);
const ENC_A = "e".repeat(64);
const ENC_B = "d".repeat(64);
const TAG = recipientTag([RECIPIENT_A]);
const TAG_AB = recipientTag([RECIPIENT_A, RECIPIENT_B]);
/** Test index keys: 32 different bytes each, as hex (never real secrets). */
const INDEX_KEY = parseIndexKey(Buffer.from(Array.from({ length: 32 }, (_, i) => (i * 37 + 11) % 256)).toString("hex"));
const OTHER_KEY = parseIndexKey(Buffer.from(Array.from({ length: 32 }, (_, i) => (i * 53 + 5) % 256)).toString("hex"));

/**
 * A database URL with a password, built from its parts at run time, so no
 * address with a password is written in this file (a repository hook
 * refuses them, placeholders included).
 */
function withPassword(url: string, password: string) {
  const parsed = new URL(url);
  parsed.password = password;
  return parsed.toString();
}

describe("age recipients", () => {
  it("accepts one or more public keys separated by spaces, commas or new lines", () => {
    expect(parseRecipients(RECIPIENT_A)).toEqual([RECIPIENT_A]);
    expect(parseRecipients(` ${RECIPIENT_A},\n${RECIPIENT_B} ${RECIPIENT_A}\n`)).toEqual([RECIPIENT_A, RECIPIENT_B]);
  });

  it("refuses a private key, without repeating it", () => {
    const secret = "AGE-SECRET-KEY-1QQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQ";
    expect(() => parseRecipients(secret)).toThrow(/private key/);
    try {
      parseRecipients(secret);
    } catch (error) {
      expect((error as Error).message).not.toContain("QQQQ");
    }
  });

  it("names a pasted age-keygen file, or a lowercase private key, as a private key", () => {
    const keygenFile = [
      "# created: 2026-10-22T07:17:00Z",
      `# public key: ${RECIPIENT_A}`,
      "AGE-SECRET-KEY-1QQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQ",
    ].join("\n");
    expect(() => parseRecipients(keygenFile)).toThrow(/private key/);
    expect(() => parseRecipients(`${RECIPIENT_A} age-secret-key-1qqqqqqqqqqqqqqqqqqqqqqqqqq`)).toThrow(/private key/);
  });

  it("names a set of keys by a tag that ignores order and repeats, and changes with any key", () => {
    expect(TAG).toMatch(/^[0-9a-f]{16}$/);
    expect(recipientTag([RECIPIENT_B, RECIPIENT_A])).toBe(TAG_AB);
    expect(recipientTag([RECIPIENT_A, RECIPIENT_B, RECIPIENT_A, ` ${RECIPIENT_B} `])).toBe(TAG_AB);
    expect(recipientTag(parseRecipients(`${RECIPIENT_B}\n${RECIPIENT_A}`))).toBe(TAG_AB);
    expect(TAG_AB).not.toBe(TAG);
    expect(recipientTag([RECIPIENT_B])).not.toBe(TAG);
    expect(() => recipientTag([])).toThrow(/No age recipient/);
  });

  it("refuses nothing at all, a typo, and characters bech32 never uses", () => {
    expect(() => parseRecipients("")).toThrow(/No age recipient/);
    expect(() => parseRecipients(undefined)).toThrow(/No age recipient/);
    expect(() => parseRecipients(RECIPIENT_A.slice(0, -1))).toThrow(/Not an age public key/);
    expect(() => parseRecipients(`${RECIPIENT_A.slice(0, -1)}b`)).toThrow(/Not an age public key/);
    expect(() => parseRecipients("ssh-ed25519 AAAAC3NzaC1lZDI1NTE5")).toThrow(/Not an age public key/);
  });
});

describe("rows in a data dump", () => {
  const dump = [
    "SET session_replication_role = replica;",
    'COPY "public"."organization" ("id", "name") FROM stdin;',
    "1\tQBBE",
    "\\.",
    "",
    'COPY "auth"."users" ("id", "email", "raw_user_meta_data") FROM stdin;',
    'a\tone@example.com\t{"note": "line one\\nline two"}',
    "b\ttwo@example.com\t\\N",
    "c\tthree@example.com\t{}",
    "\\.",
    'COPY "public"."empty_table" ("id") FROM stdin;',
    "\\.",
    'COPY "public"."we""ird" ("id") FROM stdin;',
    "x",
    "\\.",
    "SELECT pg_catalog.setval('\"public\".\"seq\"', 5, true);",
  ].join("\n");

  it("counts one row per line between COPY and \\., new lines inside values included", () => {
    expect(countRows(dump)).toEqual({
      "auth.users": 3,
      "public.empty_table": 0,
      "public.organization": 1,
      'public.we"ird': 1,
    });
  });

  it("reads a COPY line's table and columns, and nothing else", () => {
    expect(copyTarget('COPY "storage"."objects" ("id", "bucket_id") FROM stdin;')).toBe("storage.objects");
    expect(parseCopyHeader('COPY "storage"."objects" ("id", "bucket_id", "we""ird") FROM stdin;')).toEqual({
      table: "storage.objects",
      columns: ["id", "bucket_id", 'we"ird'],
    });
    expect(copyTarget('COPY "public"."t" FROM stdin;')).toBe("public.t");
    expect(copyTarget("COPY public.t FROM stdin;")).toBeNull();
    expect(copyTarget('-- COPY "public"."t" FROM stdin;')).toBeNull();
  });

  it("undoes COPY's escapes in a field", () => {
    expect(decodeCopyField("\\N")).toBeNull();
    expect(decodeCopyField("plain")).toBe("plain");
    expect(decodeCopyField("tab\\there\\nnew line\\\\back")).toBe("tab\there\nnew line\\back");
    expect(decodeCopyField('{"eTag": "\\\\"abc\\\\""}')).toBe('{"eTag": "\\"abc\\""}');
    expect(decodeCopyField("caf\\303\\251 \\x41")).toBe("café A");
    expect(decodeCopyField("Lettre_de_bienvenue_Ève.pdf")).toBe("Lettre_de_bienvenue_Ève.pdf");
  });

  it("keeps the rows of the tables it is asked for, by column name", () => {
    const counter = createRowCounter(["auth.users"]);
    for (const line of dump.split("\n")) counter.line(line);
    expect(counter.rows()["auth.users"]).toEqual([
      { id: "a", email: "one@example.com", raw_user_meta_data: '{"note": "line one\nline two"}' },
      { id: "b", email: "two@example.com", raw_user_meta_data: null },
      { id: "c", email: "three@example.com", raw_user_meta_data: "{}" },
    ]);
  });

  it("adds a kept table only once its COPY line is seen", () => {
    const counter = createRowCounter(["auth.users", "storage.objects"]);
    for (const line of dump.split("\n")) counter.line(line);
    expect(Object.keys(counter.rows())).toEqual(["auth.users"]);
  });

  it("refuses a dump that stops in the middle of a table", () => {
    const counter = createRowCounter();
    for (const line of ['COPY "public"."task" ("id") FROM stdin;', "1", "2"]) counter.line(line);
    expect(() => counter.counts()).toThrow(/truncated/);
  });

  it("builds one counting query with every name quoted", () => {
    const sql = countQuery(["public.task", 'public.we"ird', "auth.users"]);
    expect(sql).toContain(`select 'public.task' as t, count(*) as n from "public"."task"`);
    expect(sql).toContain(`from "public"."we""ird"`);
    expect(sql.match(/union all/g)).toHaveLength(2);
    expect(sql.trim().endsWith(";")).toBe(true);
  });

  it("reads psql's name|count output back", () => {
    expect(parseCounts("public.task|64\nauth.users|15\n\n")).toEqual({ "public.task": 64, "auth.users": 15 });
    expect(() => parseCounts("public.task|many")).toThrow(/Unreadable/);
  });
});

describe("is every table with rows in the dump?", () => {
  it("names a table that holds rows but has no data in the dump", () => {
    const source = ["public.task|rows", "public.new_table|rows", "auth.users|rows", "storage.migrations|rows"].join("\n");
    const result = tablesMissingFromDump(source, ["public.task", "auth.users"]);
    expect(result).toEqual({ missing: ["public.new_table"], unreadable: [] });
  });

  it("reports, without failing, tables the backup role cannot read", () => {
    expect(tablesMissingFromDump("vaultish.secret|unreadable\n", [])).toEqual({ missing: [], unreadable: ["vaultish.secret"] });
  });

  it("probes every table without creating anything, outside the schemas left out on purpose", () => {
    expect(TABLES_WITH_ROWS_QUERY).not.toMatch(/\bcreate\b|\binsert\b|\bupdate\b|\bdelete\b/i);
    for (const schema of ["vault", "cron", "pgmq", "realtime", "_realtime"]) expect(SCHEMAS_NOT_DUMPED).toContain(schema);
    for (const schema of ["public", "app", "auth", "storage", "supabase_migrations"]) expect(SCHEMAS_NOT_DUMPED).not.toContain(schema);
  });

  it("leaves out every schema Supabase CLI 2.121.0's data dump excludes (the version backup.yml pins)", () => {
    // From `supabase db dump --data-only --dry-run` with CLI 2.121.0, 2026-10-22.
    const cli =
      "information_schema|pg_*|graphql|graphql_public|pgsodium|pgsodium_masks|pgtle|repack|tiger|tiger_data|timescaledb_*|_timescaledb_*|topology|vault|etl|extensions|pgbouncer|realtime|supabase_migrations|_analytics|_realtime|_supavisor";
    const workflow = readFileSync(join(process.cwd(), ".github/workflows/backup.yml"), "utf8");
    expect(workflow).toMatch(/version: 2\.121\.0/);
    for (const entry of cli.split("|")) {
      if (entry === "supabase_migrations") continue; // copied on its own (migration-history.sql)
      if (entry.endsWith("*")) {
        const sample = `${entry.slice(0, -1)}x`;
        expect(SCHEMA_PATTERNS_NOT_DUMPED.some((p) => p.test(sample)), entry).toBe(true);
      } else {
        expect(SCHEMAS_NOT_DUMPED, entry).toContain(entry);
      }
    }
    expect(TABLES_WITH_ROWS_QUERY).toContain("!~ '^_?timescaledb_'");
  });
});

describe("comparing a restore with its backup", () => {
  it("passes equal counts and ignores tables only the restored project has", () => {
    const result = compareCounts({ "public.task": 64, "auth.users": 15 }, { "public.task": 64, "auth.users": 15, "auth.flow_state": 0 });
    expect(result).toEqual({ ok: true, checked: 2, mismatches: [] });
  });

  it("fails a different count and a table that did not come back", () => {
    const result = compareCounts({ "public.task": 64, "public.message": 20 }, { "public.task": 63 });
    expect(result.ok).toBe(false);
    expect(result.mismatches).toEqual([
      { name: "public.task", expected: 64, actual: 63 },
      { name: "public.message", expected: 20, actual: null },
    ]);
  });

  it("leaves out only the names it is told to skip", () => {
    const result = compareCounts({ cronJobs: 31, queues: 3 }, { cronJobs: 0, queues: 3 }, { skip: ["cronJobs"] });
    expect(result).toEqual({ ok: true, checked: 1, mismatches: [] });
  });

  it("counts what platform.sql recreates", () => {
    const sql = [
      'DROP POLICY IF EXISTS "a" ON storage.objects;',
      'CREATE POLICY "a" ON storage.objects AS PERMISSIVE FOR SELECT TO authenticated',
      "  USING (true);",
      "CREATE OR REPLACE TRIGGER t AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION app.f();",
      "SELECT pgmq.create('notifications');",
      "SELECT pgmq.create_unlogged('scratch');",
      "SELECT cron.schedule('job', '* * * * *', 'select 1');",
    ].join("\n");
    expect(platformCounts(sql)).toEqual({ policies: 1, triggers: 1, queues: 2, cronJobs: 1 });
  });

  it("fails a restored file row the backup has no file for, but not one deleted while the backup ran", () => {
    const rows = [
      { bucket: "documents", path: "a.pdf" },
      { bucket: "documents", path: "deleted.pdf" },
      { bucket: "documents", path: "lost.pdf" },
    ];
    const result = rowsWithoutFiles(rows, [{ bucket: "documents", path: "a.pdf" }], [{ bucket: "documents", path: "deleted.pdf" }]);
    expect(result).toEqual({ unexpected: ["documents/lost.pdf"], deletedDuringBackup: 1, lost: 0 });
  });
});

describe("which files a backup holds", () => {
  const header =
    'COPY "storage"."objects" ("id", "bucket_id", "name", "updated_at", "metadata", "version", "archived_at", "is_delete_marker") FROM stdin;';
  const meta = (size: number, etag: string, type: string) =>
    `{"eTag": "\\\\"${etag}\\\\"", "size": ${size}, "mimetype": "${type}"}`;
  const dump = [
    'COPY "storage"."buckets" ("id", "public", "file_size_limit", "allowed_mime_types") FROM stdin;',
    "receipts\tf\t26214400\t{image/png,application/pdf}",
    "documents\tf\t\\N\t\\N",
    "\\.",
    header,
    `id1\tdocuments\tOrg/Lettre de bienvenue Ève.pdf\t2026-10-22 03:20:46+00\t${meta(29, "e1", "application/pdf")}\tv1\t\\N\tf`,
    `id2\tdocuments\torg/other.pdf\t2026-10-22 03:20:47+00\t${meta(30, "e2", "application/pdf")}\tv2\t\\N\tf`,
    `id3\treceipts\tgone.png\t2026-10-22 03:20:48+00\t\\N\tv3\t\\N\tt`,
    "\\.",
  ];

  function read() {
    const counter = createRowCounter(["storage.buckets", "storage.objects"]);
    for (const line of dump) counter.line(line);
    return storageFromDump(counter.rows());
  }

  it("lists the database's files with their exact names, sizes and types, skipping delete markers", () => {
    const listed = read();
    expect(listed.buckets).toEqual([
      { id: "documents", public: false, file_size_limit: null, allowed_mime_types: null },
      { id: "receipts", public: false, file_size_limit: 26214400, allowed_mime_types: ["image/png", "application/pdf"] },
    ]);
    expect(listed.objects.map((o) => [o.bucket, o.path, o.size, o.eTag, o.contentType])).toEqual([
      ["documents", "Org/Lettre de bienvenue Ève.pdf", 29, '"e1"', "application/pdf"],
      ["documents", "org/other.pdf", 30, '"e2"', "application/pdf"],
    ]);
    expect(listed.skipped).toBe(1);
  });

  it("refuses a dump without the file list rather than backing up no files", () => {
    expect(() => storageFromDump({})).toThrow(/storage.objects/);
    // Through the real path: a dump whose storage.objects block is missing.
    const counter = createRowCounter(["storage.buckets", "storage.objects"]);
    for (const line of dump.slice(0, 4)) counter.line(line);
    expect(() => storageFromDump(counter.rows())).toThrow(/storage.objects/);
  });

  it("names a file whose name cannot be copied or restored as it is", () => {
    expect(objectNameProblem("documents", "org/a.pdf")).toBeNull();
    for (const path of ["a/../b.pdf", "./dot.pdf", "x//y.pdf", "trailing/"]) {
      expect(objectNameProblem("documents", path), path).toMatch(/rename the file/);
    }
  });

  it("reads Postgres text arrays", () => {
    expect(parsePgTextArray(null)).toBeNull();
    expect(parsePgTextArray("{}")).toEqual([]);
    expect(parsePgTextArray('{image/png,"a b","c\\"d"}')).toEqual(["image/png", "a b", 'c"d']);
  });

  it("fingerprints a file's version without its name, and changes with any upload", () => {
    const [a] = read().objects;
    expect(fingerprint(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(fingerprint({ ...a, path: "renamed.pdf" })).toBe(fingerprint(a));
    expect(fingerprint({ ...a, version: "v9" })).not.toBe(fingerprint(a));
    expect(fingerprint({ ...a, size: 30 })).not.toBe(fingerprint(a));
    expect(fingerprint({ ...a, eTag: '"other"' })).not.toBe(fingerprint(a));
  });
});

describe("downloading only what changed", () => {
  const object = (id: string, size = 10) => ({
    bucket: "documents",
    path: `${id}.pdf`,
    id,
    version: `v-${id}`,
    size,
    eTag: `"${id}"`,
    contentType: "application/pdf",
    updatedAt: "2026-10-22 03:00:00+00",
  });
  const fp = "f".repeat(64);

  /** A signed index as manifest.mjs index writes it. */
  function signedIndex(overrides: Partial<Parameters<typeof buildIndex>[0]> = {}, key = INDEX_KEY) {
    return buildIndex(
      {
        environment: "staging",
        generation: "2026-10",
        recipients: TAG,
        createdAt: "2026-10-22T07:17:00.000Z",
        archive: "qbbe-staging-20261022T071700Z.tar.gz.age",
        archiveSize: 10,
        archiveSha256: SHA_C,
        files: [{ fp, sha256: SHA_A, size: 10 }],
        blobs: [{ sha256: SHA_A, encSize: 200, encSha256: ENC_A }],
        ...overrides,
      },
      key,
    );
  }

  it("puts each month's blobs, for one set of keys, in their own folder, and knows last month", () => {
    expect(generationOf(new Date("2026-10-22T07:17:00Z"))).toBe("2026-10");
    expect(previousGeneration("2026-10")).toBe("2026-09");
    expect(previousGeneration("2027-01")).toBe("2026-12");
    expect(blobPrefix("production", "2026-10", TAG)).toBe(`blobs/production/2026-10-${TAG}/`);
    expect(parseBlobPrefix(`blobs/production/2026-10-${TAG}/`)).toEqual({ environment: "production", generation: "2026-10", tag: TAG });
    expect(parseBlobPrefix("blobs/production/2026-10/")).toBeNull();
    expect(parseBlobPrefix(`blobs/../2026-10-${TAG}/`)).toBeNull();
    expect(() => blobPrefix("../x", "2026-10", TAG)).toThrow(/Refusing/);
    expect(() => blobPrefix("production", "2026-10", "../x")).toThrow(/recipient tag/);
    expect(() => previousGeneration("2026-1")).toThrow(/YYYY-MM/);
    expect(() => previousGeneration("2026-13")).toThrow(/YYYY-MM/);
  });

  it("reads a bucket listing of one folder into blob name → size, alternate names included", () => {
    const prefix = blobPrefix("staging", "2026-10", TAG);
    const listing = [
      `${prefix}${SHA_A}.age\t120`,
      `${prefix}${SHA_B}.age\t300`,
      `${prefix}${SHA_B}.2.age\t301`,
      `${prefix}${SHA_B}.1.age\t1`,
      `${prefix}${SHA_B}.02.age\t1`,
      `${prefix}not-a-blob.txt\t1`,
      `blobs/staging/2026-09-${TAG}/${SHA_C}.age\t5`,
      "None",
    ].join("\n");
    expect([...parseBlobListing(listing, prefix)]).toEqual([
      [`${SHA_A}.age`, 120],
      [`${SHA_B}.age`, 300],
      [`${SHA_B}.2.age`, 301],
    ]);
  });

  it("names a blob <sha256>.age, or <sha256>.<n>.age (n from 2) when that name is taken", () => {
    expect(blobFileName({ sha256: SHA_A, encSize: 1, encSha256: ENC_A })).toBe(`${SHA_A}.age`);
    expect(blobFileName({ sha256: SHA_A, encSize: 1, encSha256: ENC_A, name: `${SHA_A}.3.age` })).toBe(`${SHA_A}.3.age`);
    expect(freeBlobName(SHA_A, new Map())).toBe(`${SHA_A}.age`);
    expect(freeBlobName(SHA_A, new Map([[`${SHA_A}.age`, 1]]))).toBe(`${SHA_A}.2.age`);
    expect(freeBlobName(SHA_A, new Map([[`${SHA_A}.age`, 1], [`${SHA_A}.2.age`, 1], [`${SHA_B}.3.age`, 1]]))).toBe(`${SHA_A}.3.age`);
  });

  it("refuses a recorded blob name that is not its own sha256's", () => {
    const record = (name: string) => signedIndex({ blobs: [{ sha256: SHA_A, encSize: 200, encSha256: ENC_A, name }] });
    expect(readPreviousIndex(record(`${SHA_A}.2.age`), "staging", INDEX_KEY).blobs.get(SHA_A)).toEqual({ sha256: SHA_A, encSize: 200, encSha256: ENC_A, name: `${SHA_A}.2.age` });
    for (const name of [`${SHA_B}.age`, `${SHA_A}.1.age`, `../${SHA_A}.age`, `${SHA_A}.2.age/x`]) {
      expect(readPreviousIndex(record(name), "staging", INDEX_KEY).blobs.has(SHA_A), name).toBe(false);
    }
  });

  it("trusts the previous index only when it is signed with the index key, for its own environment and format", () => {
    const index = signedIndex();
    const read = readPreviousIndex(index, "staging", INDEX_KEY);
    expect(read.usable).toBe(true);
    expect([...read.files]).toEqual([[fp, { sha256: SHA_A, size: 10 }]]);
    expect([...read.blobs]).toEqual([[SHA_A, { sha256: SHA_A, encSize: 200, encSha256: ENC_A }]]);
    expect(read.tag).toBe(TAG);
    expect(readPreviousIndex(index, "production", INDEX_KEY).reason).toBe("environment");
    expect(readPreviousIndex({ ...index, format: "other" }, "staging", INDEX_KEY).reason).toBe("format");
    expect(readPreviousIndex(null, "staging", INDEX_KEY).reason).toBe("none");
    expect(readPreviousIndex(index, "staging", OTHER_KEY)).toMatchObject({ usable: false, reason: "signature" });
  });

  it("refuses an index that was changed or never signed (a planted index cannot point files at other blobs)", () => {
    const index = signedIndex({
      files: [
        { fp, sha256: SHA_A, size: 10 },
        { fp: "e".repeat(64), sha256: SHA_B, size: 10 },
      ],
      blobs: [
        { sha256: SHA_A, encSize: 200, encSha256: ENC_A },
        { sha256: SHA_B, encSize: 200, encSha256: ENC_B },
      ],
    });
    // Two entries' contents swapped, everything else intact.
    const swapped = { ...index, files: index.files.map((f) => ({ ...f, sha256: f.sha256 === SHA_A ? SHA_B : SHA_A })) };
    expect(swapped.files).not.toEqual(index.files);
    expect(readPreviousIndex(swapped, "staging", INDEX_KEY)).toMatchObject({ usable: false, reason: "signature" });
    const unsigned: Record<string, unknown> = { ...index };
    delete unsigned.mac;
    expect(readPreviousIndex(unsigned, "staging", INDEX_KEY).reason).toBe("signature");
    expect(readPreviousIndex({ ...index, mac: "0".repeat(64) }, "staging", INDEX_KEY).reason).toBe("signature");
    expect(readPreviousIndex({ ...index, mac: "short" }, "staging", INDEX_KEY).reason).toBe("signature");
    expect(readPreviousIndex(index, "staging", INDEX_KEY).usable).toBe(true);
  });

  it("refuses a signed index read from a key that is not its own run's (an old index copied to a newer name)", () => {
    const index = signedIndex();
    const own = "staging/2026-10-22/qbbe-staging-20261022T071700Z.index.json";
    expect(readPreviousIndex(index, "staging", INDEX_KEY, own).usable).toBe(true);
    // A real, correctly signed index copied to a later run's key.
    expect(readPreviousIndex(index, "staging", INDEX_KEY, "staging/2026-10-23/qbbe-staging-20261023T071700Z.index.json")).toMatchObject({ usable: false, reason: "key" });
    expect(readPreviousIndex(index, "staging", INDEX_KEY, "staging/2026-10-22/qbbe-staging-20261022T071701Z.index.json").reason).toBe("key");
    expect(readPreviousIndex(index, "staging", INDEX_KEY, "staging/2026-10-22/evil.index.json").reason).toBe("key");
    // The run's time: createdAt (the manifest's, written just before the
    // archive is named) may not come after the key's second, nor hours before it.
    expect(readPreviousIndex(signedIndex({ createdAt: "2026-10-22T07:16:58.400Z" }), "staging", INDEX_KEY, own).usable).toBe(true);
    expect(readPreviousIndex(signedIndex({ createdAt: "2026-10-22T07:17:00.999Z" }), "staging", INDEX_KEY, own).usable).toBe(true);
    expect(readPreviousIndex(signedIndex({ createdAt: "2026-10-22T07:17:01.000Z" }), "staging", INDEX_KEY, own).reason).toBe("key");
    expect(readPreviousIndex(signedIndex({ createdAt: "2026-10-20T07:17:00.000Z" }), "staging", INDEX_KEY, own).reason).toBe("key");
    expect(readPreviousIndex(signedIndex({ createdAt: "not a time" }), "staging", INDEX_KEY, own).reason).toBe("key");
    // A wrong signature is still reported as such.
    expect(readPreviousIndex(index, "staging", OTHER_KEY, own).reason).toBe("signature");
  });

  it("reads the index key as hex or base64 of at least 32 bytes, without repeating it", () => {
    expect(parseIndexKey(Buffer.from(Array.from({ length: 32 }, (_, i) => i)).toString("hex"))).toHaveLength(32);
    const random = (n: number) => Buffer.from(Array.from({ length: n }, (_, i) => (i * 29 + 3) % 256));
    expect(parseIndexKey(random(32).toString("base64"))).toHaveLength(32);
    expect(parseIndexKey(random(48).toString("base64url"))).toHaveLength(48);
    expect(() => parseIndexKey("ab".repeat(31))).toThrow(/31 bytes/);
    expect(() => parseIndexKey(undefined)).toThrow(/not set/);
    expect(() => parseIndexKey("not a key!")).toThrow(/neither hex nor base64/);
    // Long enough, but not random: all zero bytes, or a few values repeated.
    for (const weak of [Buffer.alloc(32).toString("hex"), "11".repeat(32), Buffer.alloc(32, 9).toString("base64"), "0102".repeat(32)]) {
      expect(() => parseIndexKey(weak), weak).toThrow(/does not look random.*openssl rand -base64 32/);
    }
    try {
      parseIndexKey("cd".repeat(10));
    } catch (error) {
      expect((error as Error).message).not.toContain("cdcd");
    }
  });

  it("downloads a file only when it is new, changed, or its blob is not in this month's folder", () => {
    const same = object("same");
    const changed = object("changed", 11);
    const lost = object("lost");
    const fresh = object("fresh");
    const previous = new Map([
      [fingerprint(same), { sha256: SHA_A, size: 10 }],
      [fingerprint({ ...changed, size: 10 }), { sha256: SHA_C, size: 10 }],
      [fingerprint(lost), { sha256: SHA_C, size: 10 }],
    ]);
    const plan = planObjects([same, changed, lost, fresh], previous, new Map([[SHA_A, 100]]));
    expect(plan.map((p) => [p.object.id, p.action, p.sha256])).toEqual([
      ["same", "keep", SHA_A],
      ["changed", "download", null],
      ["lost", "download", null],
      ["fresh", "download", null],
    ]);
  });

  it("stores a downloaded file's blob once: kept when already in this month's folder, otherwise uploaded", () => {
    const current = new Map([[SHA_A, 1]]);
    expect(blobAction(SHA_A, current)).toBe("keep");
    expect(blobAction(SHA_C, current)).toBe("upload");
  });

  it("after the custodians' keys change, stores every file again, encrypted to the new keys", () => {
    const files = [object("one"), object("two")];
    const previous = new Map(files.map((o, i) => [fingerprint(o), { sha256: [SHA_A, SHA_B][i], size: 10 }]));
    // Last night's blobs, under the old keys' folder (this month and last).
    const listing = [`blobs/staging/2026-10-${TAG}/${SHA_A}.age\t120`, `blobs/staging/2026-10-${TAG}/${SHA_B}.age\t120`, `blobs/staging/2026-09-${TAG}/${SHA_A}.age\t120`].join("\n");
    const newPrefix = blobPrefix("staging", "2026-10", TAG_AB);
    const current = parseBlobListing(listing, newPrefix);
    expect(current.size).toBe(0);
    const plan = planObjects(files, previous, current);
    expect(plan.map((p) => p.action)).toEqual(["download", "download"]);
    expect([SHA_A, SHA_B].map((sha) => blobAction(sha, current))).toEqual(["upload", "upload"]);
    // And nothing is copied from the old keys' folder.
    const read = readPreviousIndex(signedIndex({ generation: "2026-09" }), "staging", INDEX_KEY);
    expect(carryPlan(read, { prefix: newPrefix, generation: "2026-10", tag: TAG_AB, listing: current }).carry).toEqual([]);
  });

  it("copies into a new month only blobs the signed index recorded, for the same keys, with a recorded sha256", () => {
    const index = signedIndex({
      generation: "2026-09",
      files: [
        { fp, sha256: SHA_A, size: 10 },
        { fp: "e".repeat(64), sha256: SHA_B, size: 10 },
        { fp: "d".repeat(64), sha256: SHA_C, size: 10 },
      ],
      blobs: [
        { sha256: SHA_A, encSize: 200, encSha256: ENC_A },
        { sha256: SHA_B, encSize: 300, encSha256: null },
        { sha256: SHA_C, encSize: 400, encSha256: ENC_B },
      ],
    });
    const previous = readPreviousIndex(index, "staging", INDEX_KEY);
    const prefix = blobPrefix("staging", "2026-10", TAG);
    // Something is already at C's name (a copy left by a failed night, or a
    // planted object): it is checked, never just trusted, and if it does not
    // match, C goes under the next free name.
    const plan = carryPlan(previous, { prefix, generation: "2026-10", tag: TAG, listing: new Map([[`${SHA_C}.age`, 400], [`${SHA_C}.2.age`, 7]]) });
    expect(plan.from).toBe(`blobs/staging/2026-09-${TAG}/`);
    expect(plan.carry).toEqual([
      { sha256: SHA_A, encSize: 200, encSha256: ENC_A, from: `${SHA_A}.age`, check: [], to: `${SHA_A}.age` },
      { sha256: SHA_C, encSize: 400, encSha256: ENC_B, from: `${SHA_C}.age`, check: [`${SHA_C}.age`], to: `${SHA_C}.3.age` },
    ]);
    expect(plan.unverifiable).toBe(1);
    // A blob recorded under another name is copied from that name.
    const renamed = readPreviousIndex(signedIndex({ generation: "2026-09", blobs: [{ sha256: SHA_A, encSize: 200, encSha256: ENC_A, name: `${SHA_A}.2.age` }] }), "staging", INDEX_KEY);
    expect(carryPlan(renamed, { prefix, generation: "2026-10", tag: TAG, listing: new Map() }).carry).toEqual([
      { sha256: SHA_A, encSize: 200, encSha256: ENC_A, name: `${SHA_A}.2.age`, from: `${SHA_A}.2.age`, check: [], to: `${SHA_A}.age` },
    ]);
    // Same month: nothing to copy.
    expect(carryPlan(previous, { prefix: blobPrefix("staging", "2026-09", TAG), generation: "2026-09", tag: TAG, listing: new Map() }).from).toBeNull();
    // An unsigned index: nothing.
    expect(carryPlan(readPreviousIndex(index, "staging", OTHER_KEY), { prefix, generation: "2026-10", tag: TAG, listing: new Map() }).carry).toEqual([]);
    // The records that hold for this month's folder: the carried ones only,
    // under the name each was carried to.
    const after = new Map([
      [`${SHA_A}.age`, 200],
      [`${SHA_C}.age`, 400],
      [`${SHA_C}.3.age`, 400],
    ]);
    expect([...knownBlobs(previous, prefix, after, new Map([[SHA_A, `${SHA_A}.age`], [SHA_C, `${SHA_C}.3.age`]])).values()]).toEqual([
      { sha256: SHA_A, encSize: 200, encSha256: ENC_A },
      { sha256: SHA_C, encSize: 400, encSha256: ENC_B, name: `${SHA_C}.3.age` },
    ]);
  });

  it("checks every needed blob, under its recorded name, against the encrypted size recorded when it was stored", () => {
    const blobs = [
      { sha256: SHA_A, encSize: 200, encSha256: ENC_A, name: `${SHA_A}.2.age` },
      { sha256: SHA_B, encSize: 300, encSha256: ENC_B },
      { sha256: SHA_C, encSize: 400, encSha256: ENC_B },
    ];
    const result = checkBlobListing(blobs, new Map([
      [`${SHA_A}.age`, 999],
      [`${SHA_A}.2.age`, 200],
      [`${SHA_B}.age`, 150],
      [`${SHA_C}.2.age`, 400],
    ]));
    expect(result).toEqual({ ok: false, missing: [`${SHA_C}.age`], wrong: [{ sha256: SHA_B, name: `${SHA_B}.age`, expected: 300, actual: 150 }] });
    expect(checkBlobListing(blobs.slice(0, 1), new Map([[`${SHA_A}.2.age`, 200]])).ok).toBe(true);
  });

  it("trusts a blob in this month's folder only when a signed index records it with its encrypted size and sha256", () => {
    const prefix = blobPrefix("staging", "2026-10", TAG);
    const previous = readPreviousIndex(
      signedIndex({
        files: [
          { fp, sha256: SHA_A, size: 10 },
          { fp: "e".repeat(64), sha256: SHA_B, size: 10 },
          { fp: "d".repeat(64), sha256: SHA_C, size: 10 },
        ],
        blobs: [
          { sha256: SHA_A, encSize: 200, encSha256: ENC_A, name: `${SHA_A}.2.age` },
          { sha256: SHA_B, encSize: 300, encSha256: null },
          { sha256: SHA_C, encSize: 400, encSha256: ENC_B },
        ],
      }),
      "staging",
      INDEX_KEY,
    );
    // A under its recorded name; B never had its sha256 recorded; C's object
    // has another size than recorded (damaged, or planted after a delete).
    const listing = new Map([
      [`${SHA_A}.age`, 200],
      [`${SHA_A}.2.age`, 200],
      [`${SHA_B}.age`, 300],
      [`${SHA_C}.age`, 999],
    ]);
    expect([...knownBlobs(previous, prefix, listing, new Map()).keys()]).toEqual([SHA_A]);
    // planObjects keeps an unchanged file only when its blob is trusted.
    const plan = planObjects([object("a"), object("b")], new Map([
      [fingerprint(object("a")), { sha256: SHA_A, size: 10 }],
      [fingerprint(object("b")), { sha256: SHA_B, size: 10 }],
    ]), knownBlobs(previous, prefix, listing, new Map()));
    expect(plan.map((p) => p.action)).toEqual(["keep", "download"]);
  });

  it("never lets a record without the encrypted sha256 replace one with it", () => {
    const good = { sha256: SHA_A, encSize: 200, encSha256: ENC_A };
    const weak = { sha256: SHA_A, encSize: 200, encSha256: null };
    expect(mergeBlobRecord(undefined, weak)).toEqual(weak);
    expect(mergeBlobRecord(weak, good)).toEqual(good);
    expect(mergeBlobRecord(good, weak)).toEqual(good);
    expect(mergeBlobRecord(good, { ...good })).toEqual(good);
  });

  it("stores each content once a night, however many files share it and however their downloads interleave", async () => {
    const delay = () => new Promise((resolve) => setTimeout(resolve, Math.floor(Math.random() * 4)));
    for (let round = 0; round < 40; round += 1) {
      let sealed = 0;
      const discarded: string[] = [];
      const store = createBlobStore({
        listing: new Map(round % 2 === 0 ? [] : [[`${SHA_A}.age`, 5]]),
        known: new Map(),
        seal: async (_tmp: string, name: string) => {
          sealed += 1;
          await delay();
          return { size: 200, sha256: ENC_A, name };
        },
        discard: async (tmp: string) => {
          await delay();
          discarded.push(tmp);
        },
      });
      const results = await Promise.all(
        Array.from({ length: 20 }, async (_, i) => {
          await delay();
          return store.store(SHA_A, `tmp-${i}`);
        }),
      );
      const name = round % 2 === 0 ? undefined : `${SHA_A}.2.age`;
      expect(sealed).toBe(1);
      expect(results.filter((r) => r.stored)).toHaveLength(1);
      expect(discarded).toHaveLength(19);
      for (const r of results) expect(r.record).toEqual({ sha256: SHA_A, encSize: 200, encSha256: ENC_A, ...(name ? { name } : {}) });
      expect(store.renamed()).toBe(round % 2 === 0 ? 0 : 1);
    }
    // A blob this month's folder already holds, under a trusted record: kept.
    const known = { sha256: SHA_B, encSize: 300, encSha256: ENC_B };
    const keepStore = createBlobStore({ listing: new Map([[`${SHA_B}.age`, 300]]), known: new Map([[SHA_B, known]]), seal: async () => { throw new Error("must not seal"); }, discard: async () => {} });
    expect(await keepStore.store(SHA_B, "tmp")).toEqual({ record: known, stored: false });
    // A failed seal is retried by the next file with that content.
    let attempts = 0;
    const flaky = createBlobStore({
      listing: new Map(),
      known: new Map(),
      seal: async (_tmp: string, name: string) => {
        attempts += 1;
        if (attempts === 1) throw new Error("disk full");
        return { size: 1, sha256: ENC_A, name };
      },
      discard: async () => {},
    });
    await expect(flaky.store(SHA_C, "a")).rejects.toThrow(/disk full/);
    expect((await flaky.store(SHA_C, "b")).stored).toBe(true);
  });

  it("notices a file the export neither copied nor recorded", () => {
    const listed = [object("a"), object("b"), object("c")];
    expect(unaccountedObjects(listed, [[listed[0]], [listed[1]], []])).toBe(1);
    expect(unaccountedObjects(listed, [[listed[0]], [listed[1]], [listed[2]]])).toBe(0);
  });

  it("refuses a concurrency that would copy nothing", () => {
    expect(parseConcurrency(undefined)).toBe(4);
    expect(parseConcurrency("8")).toBe(8);
    for (const bad of ["eight", "0", "-1", "1.5", "33"]) expect(() => parseConcurrency(bad), bad).toThrow(/whole number from 1 to 32/);
  });
});

describe("where a stored file lands in an unpacked backup", () => {
  it("keeps bucket and path under storage/objects", () => {
    expect(objectFilePath("documents", "org/u1/Lettre de bienvenue.pdf")).toBe(
      "storage/objects/documents/org/u1/Lettre de bienvenue.pdf",
    );
  });

  it("refuses names that would escape the folder or cannot be a file", () => {
    for (const path of ["../etc/passwd", "a/../../b", "/abs.pdf", "a//b", "a/./b", "trailing/", "", "nul\0byte"]) {
      expect(() => objectFilePath("documents", path), JSON.stringify(path)).toThrow(/Refusing/);
    }
    for (const bucket of ["..", "a/b", "", ".hidden"]) {
      expect(() => objectFilePath(bucket, "x.pdf"), bucket).toThrow(/Refusing/);
    }
  });
});

describe("the manifest and the index", () => {
  const a = { bucket: "documents", path: "a.pdf", size: 3, sha256: SHA_A, contentType: "application/pdf", blob: `blobs/staging/2026-10-${TAG}/${SHA_A}.age` };
  const b = { bucket: "receipts", path: "r/b.png", size: 5, sha256: SHA_B, contentType: "image/png", blob: `blobs/staging/2026-10-${TAG}/${SHA_B}.age` };

  it("passes the same files with the same bytes", () => {
    expect(compareObjects([a, b], [b, a]).ok).toBe(true);
  });

  it("names a missing file, a changed one and one the backup never had", () => {
    const result = compareObjects([a, b], [{ ...a, sha256: "zzz" }, { bucket: "documents", path: "new.pdf", size: 1, sha256: "n" }]);
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual(["receipts/r/b.png"]);
    expect(result.changed.map((c) => c.key)).toEqual(["documents/a.pdf"]);
    expect(result.extra).toEqual(["documents/new.pdf"]);
  });

  it("builds a sorted manifest with totals, the largest file, each blob's encrypted size and sha256, and what was read from Supabase", () => {
    const manifest = buildManifest({
      environment: "staging",
      createdAt: "2026-10-22T07:17:00.000Z",
      files: { "schema.sql": { size: 1, sha256: "s" }, "data.sql": { size: 2, sha256: "d" } },
      rows: { "public.task": 64, "auth.users": 15 },
      platform: { policies: 18, triggers: 6, queues: 3, cronJobs: 31 },
      generation: "2026-10",
      blobPrefix: `blobs/staging/2026-10-${TAG}/`,
      buckets: [{ id: "receipts" }, { id: "documents" }],
      objects: [b, a],
      blobs: [
        { sha256: SHA_B, encSize: 300, encSha256: ENC_B },
        { sha256: SHA_A, encSize: 200, encSha256: ENC_A },
      ],
      read: { databaseBytes: 100, catalogBytesEstimate: CATALOG_READ_BYTES, storageBytes: 5, storageFiles: 1 },
    });
    expect(manifest.format).toBe("qbbe-backup/3");
    expect(Object.keys(manifest.database.files)).toEqual(["data.sql", "schema.sql"]);
    expect(Object.keys(manifest.database.rows)).toEqual(["auth.users", "public.task"]);
    expect(manifest.database.totalRows).toBe(79);
    expect(manifest.storage.objects.map((o) => o.path)).toEqual(["a.pdf", "r/b.png"]);
    expect(manifest.storage.buckets.map((x) => x.id)).toEqual(["documents", "receipts"]);
    expect(manifest.storage.blobs.map((x) => x.sha256)).toEqual([SHA_A, SHA_B]);
    expect(manifest.storage.totalBytes).toBe(8);
    expect(manifest.storage.largestBytes).toBe(5);
    expect(manifest.storage.errors).toEqual([]);
    expect(manifest.read).toEqual({ databaseBytes: 100, catalogBytesEstimate: CATALOG_READ_BYTES, storageBytes: 5, storageFiles: 1 });
  });

  it("builds a signed index that lists each blob once with its encrypted size and sha256, and names no file", () => {
    const index = buildIndex(
      {
        environment: "staging",
        generation: "2026-10",
        recipients: TAG,
        createdAt: "2026-10-22T07:17:00.000Z",
        archive: "qbbe-staging-20261022T071700Z.tar.gz.age",
        archiveSize: 10,
        archiveSha256: SHA_C,
        files: [
          { fp: "2".repeat(64), sha256: SHA_A, size: 3 },
          { fp: "1".repeat(64), sha256: SHA_A, size: 3 },
        ],
        blobs: [{ sha256: SHA_A, encSize: 200, encSha256: ENC_A }],
      },
      INDEX_KEY,
    );
    expect(index.blobs).toEqual([{ sha256: SHA_A, encSize: 200, encSha256: ENC_A }]);
    expect(index.blobPrefix).toBe(`blobs/staging/2026-10-${TAG}/`);
    const renamed = buildIndex(
      {
        environment: "staging",
        generation: "2026-10",
        recipients: TAG,
        createdAt: "2026-10-22T07:17:00.000Z",
        archive: "qbbe-staging-20261022T071700Z.tar.gz.age",
        archiveSize: 10,
        archiveSha256: SHA_C,
        files: [{ fp: "1".repeat(64), sha256: SHA_A, size: 3 }],
        blobs: [{ sha256: SHA_A, encSize: 200, encSha256: ENC_A, name: `${SHA_A}.2.age` }],
      },
      INDEX_KEY,
    );
    expect(renamed.blobs).toEqual([{ sha256: SHA_A, encSize: 200, encSha256: ENC_A, name: `${SHA_A}.2.age` }]);
    expect(readPreviousIndex(renamed, "staging", INDEX_KEY).usable).toBe(true);
    expect(index.files.map((f) => f.fp[0])).toEqual(["1", "2"]);
    expect(index.mac).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(index)).not.toMatch(/\.pdf|documents/);
    expect(() =>
      buildIndex(
        { environment: "staging", generation: "2026-10", recipients: TAG, createdAt: "", archive: "x", archiveSize: 1, archiveSha256: SHA_C, files: [{ fp: "1".repeat(64), sha256: SHA_B, size: 1 }], blobs: [] },
        INDEX_KEY,
      ),
    ).toThrow(/No blob record/);
  });

  it("compares the restored buckets' settings with the backup's", () => {
    const backedUp = [
      { id: "documents", public: false, file_size_limit: 26214400, allowed_mime_types: null },
      { id: "receipts", public: false, file_size_limit: 26214400, allowed_mime_types: ["application/pdf"] },
    ];
    expect(compareBuckets(backedUp, [["documents", false, 26214400, null], ["receipts", false, 26214400, ["application/pdf"]]]).ok).toBe(true);
    const lifted = compareBuckets(backedUp, [["documents", false, null, null]]);
    expect(lifted.ok).toBe(false);
    expect(lifted.differences).toEqual([expect.stringMatching(/^documents: backed up .*limit=26214400.*restored .*limit=none/), "receipts: missing"]);
  });

  it("does not fail a file row a partial restore could not give back, but counts it", () => {
    const rows = [
      { bucket: "documents", path: "a.pdf" },
      { bucket: "documents", path: "lost.pdf" },
    ];
    const objects = rows;
    expect(rowsWithoutFiles(rows, objects, [], ["documents/lost.pdf"])).toEqual({ unexpected: [], deletedDuringBackup: 0, lost: 1 });
  });

  it("estimates a night's Supabase traffic with pg_dump's catalog reads, and warns above 2 GB a month", () => {
    const small = trafficEstimate({ databaseBytes: 37_000_000, catalogBytesEstimate: CATALOG_READ_BYTES, storageBytes: 0 });
    expect(small.night).toBe(37_000_000 + CATALOG_READ_BYTES);
    expect(small.month).toBe(small.night * 30);
    expect(small.warn).toBe(false);
    expect(trafficEstimate({ databaseBytes: 80_000_000, storageBytes: 0 }).warn).toBe(true);
    // A dump redone because a migration landed read the catalog twice.
    expect(trafficEstimate({ databaseBytes: 1, extraDatabaseBytes: 2, catalogBytesEstimate: 3, storageBytes: 4 }).night).toBe(13);
    expect(trafficEstimate({ databaseBytes: 1, extraDatabaseBytes: 0, catalogBytesEstimate: 3, storageBytes: 4 }).night).toBe(8);
  });

  it("writes a run summary with no sign-in or MFA counts, and a traffic line with the estimate and the month", () => {
    const work = mkdtempSync(join(tmpdir(), "qbbe-manifest-"));
    try {
      const manifest = buildManifest({
        environment: "production",
        createdAt: "2026-10-22T07:17:00.000Z",
        files: {},
        rows: { "auth.users": 43, "auth.mfa_factors": 2 },
        platform: { policies: 1, triggers: 1, queues: 1, cronJobs: 1 },
        generation: "2026-10",
        buckets: [],
        objects: [],
        read: { databaseBytes: 80_000_000, catalogBytesEstimate: CATALOG_READ_BYTES, storageBytes: 0, storageFiles: 0 },
      });
      writeFileSync(join(work, "manifest.json"), JSON.stringify(manifest));
      const script = join(process.cwd(), "scripts/backup/manifest.mjs");
      const summary = spawnSync(process.execPath, [script, "summary", work], { encoding: "utf8" });
      expect(summary.status, summary.stderr).toBe(0);
      expect(summary.stdout).not.toMatch(/auth\.users|mfa|Sign-in/i);
      expect(summary.stdout).toMatch(/catalog reads by pg_dump \(a fixed estimate/);
      expect(summary.stdout).toMatch(/At this rate, about [\d.]+ GB a month/);
      const traffic = spawnSync(process.execPath, [script, "traffic", work], { encoding: "utf8" });
      expect(traffic.status).toBe(0);
      expect(traffic.stdout).toMatch(/::warning title=Supabase traffic::production: about [\d.]+ GB a month/);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  });
});

describe("fetching one backup for a restore", () => {
  const key = "production/2026-10-22/qbbe-production-20261022T071700Z.index.json";
  const index = () => ({
    format: "qbbe-backup-index/2",
    environment: "production",
    generation: "2026-10",
    recipients: TAG,
    archive: "qbbe-production-20261022T071700Z.tar.gz.age",
    archiveSha256: SHA_C,
    blobPrefix: `blobs/production/2026-10-${TAG}/`,
    blobs: [{ sha256: SHA_A, encSize: 200, encSha256: ENC_A }],
  });

  it("takes latest, a date, or one run by its time, archive name or key", () => {
    expect(parseFetchWhich("latest", "production")).toEqual({ prefix: "production/", key: null });
    expect(parseFetchWhich("2026-10-22", "production")).toEqual({ prefix: "production/2026-10-22/", key: null });
    for (const which of ["20261022T071700Z", "qbbe-production-20261022T071700Z.tar.gz.age", "production/2026-10-22/qbbe-production-20261022T071700Z.tar.gz.age", key]) {
      expect(parseFetchWhich(which, "production"), which).toEqual({ prefix: "production/2026-10-22/", key });
    }
    for (const which of ["qbbe-staging-20261022T071700Z.tar.gz.age", "../x", "yesterday", ""]) {
      expect(() => parseFetchWhich(which, "production"), which).toThrow(/Cannot tell which backup/);
    }
  });

  it("uses only well-formed index keys, and never one dated in the future", () => {
    expect(indexKeyTime(key, "production")?.toISOString()).toBe("2026-10-22T07:17:00.000Z");
    expect(indexKeyTime("production/2026-10-23/qbbe-production-20261022T071700Z.index.json", "production")).toBeNull();
    expect(indexKeyTime("production/9999-12-31/z.index.json", "production")).toBeNull();
    expect(indexKeyTime("staging/2026-10-22/qbbe-staging-20261022T071700Z.index.json", "production")).toBeNull();
    const keys = [
      key,
      "production/2026-10-22/qbbe-production-20261022T110000Z.index.json",
      "production/9999-12-31/qbbe-production-99991231T235959Z.index.json",
      "production/2026-10-22/zzz.index.json",
    ];
    expect(newestIndexKey(keys, "production", new Date("2026-10-22T12:00:00Z"))).toBe(keys[1]);
    expect(newestIndexKey([], "production")).toBeNull();
  });

  it("considers the runs of the last 40 days, newest first, and none dated more than an hour ahead", () => {
    const at = (iso: string) => `production/${iso.slice(0, 10)}/qbbe-production-${iso.replace(/[-:]/g, "").replace(/\.\d+/, "")}.index.json`;
    const now = new Date("2026-10-22T12:00:00Z");
    const keys = [
      at("2026-09-11T07:17:00Z"), // 41 days old
      at("2026-09-13T07:17:00Z"),
      at("2026-10-22T11:00:00Z"),
      at("2026-10-22T12:30:00Z"), // within the hour
      at("2026-10-22T14:00:00Z"), // more than an hour ahead
      "production/2026-10-22/zzz.index.json",
      "production/2026-10-22/qbbe-production-20261022T110000Z.tar.gz.age",
    ];
    expect(indexCandidates(keys, "production", now)).toEqual({ keys: [keys[3], keys[2], keys[1]], future: 1 });
    expect(indexCandidates(keys, "production", now, { days: null })).toEqual({ keys: [keys[3], keys[2], keys[1], keys[0]], future: 1 });
  });

  it("plans each blob's download: its recorded name first, then identical copies in the other month folders of the same keys, then copies it cannot check", () => {
    const here = `blobs/production/2026-10-${TAG}/`;
    const next = `blobs/production/2026-11-${TAG}/`;
    const before = `blobs/production/2026-09-${TAG}/`;
    const folders = new Map([
      [here, new Map([[`${SHA_A}.age`, 999], [`${SHA_A}.2.age`, 200], [`${SHA_B}.age`, 300]])],
      [next, new Map([[`${SHA_B}.age`, 300], [`${SHA_C}.age`, 50]])],
      [before, new Map([[`${SHA_B}.age`, 310], [`${SHA_C}.age`, 40]])],
    ]);
    const plan = fetchPlan(
      [
        { sha256: SHA_A, encSize: 200, encSha256: ENC_A, name: `${SHA_A}.2.age` },
        { sha256: SHA_B, encSize: 300, encSha256: ENC_B },
        { sha256: SHA_C, encSize: 40, encSha256: null },
      ],
      here,
      folders,
    );
    expect(plan).toEqual([
      {
        sha256: SHA_A,
        candidates: [
          { key: `${here}${SHA_A}.2.age`, size: 200, sha256: ENC_A, local: `${SHA_A}.2.age`, kind: "primary" },
          // The object at the usual name, which was not trusted: tried last, and only kept if it decrypts to the file.
          { key: `${here}${SHA_A}.age`, size: null, sha256: null, local: `${SHA_A}.fallback-1.age`, kind: "unchecked" },
        ],
      },
      {
        sha256: SHA_B,
        candidates: [
          { key: `${here}${SHA_B}.age`, size: 300, sha256: ENC_B, local: `${SHA_B}.age`, kind: "primary" },
          { key: `${next}${SHA_B}.age`, size: 300, sha256: ENC_B, local: `${SHA_B}.age`, kind: "copy" },
          { key: `${before}${SHA_B}.age`, size: null, sha256: null, local: `${SHA_B}.fallback-1.age`, kind: "unchecked" },
        ],
      },
      {
        sha256: SHA_C,
        candidates: [
          { key: `${here}${SHA_C}.age`, size: 40, sha256: null, local: `${SHA_C}.age`, kind: "unchecked" },
          { key: `${before}${SHA_C}.age`, size: null, sha256: null, local: `${SHA_C}.fallback-1.age`, kind: "unchecked" },
          { key: `${next}${SHA_C}.age`, size: null, sha256: null, local: `${SHA_C}.fallback-2.age`, kind: "unchecked" },
        ],
      },
    ]);
  });

  it("refuses an index whose names would reach outside the restore folder", () => {
    expect(checkFetchIndex(index(), "production", key)).toMatchObject({
      archive: "qbbe-production-20261022T071700Z.tar.gz.age",
      blobPrefix: `blobs/production/2026-10-${TAG}/`,
      blobs: [{ sha256: SHA_A, encSize: 200, encSha256: ENC_A }],
    });
    for (const archive of ["../.bashrc", "a/../b", "/abs", "qbbe-production-20261021T071700Z.tar.gz.age"]) {
      expect(() => checkFetchIndex({ ...index(), archive }, "production", key), archive).toThrow(/archive name/);
    }
    expect(() => checkFetchIndex({ ...index(), blobs: [{ sha256: "../../x", encSize: 1, encSha256: null }] }, "production", key)).toThrow(/blob/);
    expect(() => checkFetchIndex({ ...index(), blobs: ["a".repeat(64)] }, "production", key)).toThrow(/blob/);
    expect(() => checkFetchIndex({ ...index(), blobPrefix: "blobs/production/2026-10/../../" }, "production", key)).toThrow(/blob folder/);
    expect(() => checkFetchIndex({ ...index(), blobPrefix: `blobs/staging/2026-10-${TAG}/` }, "production", key)).toThrow(/blob folder/);
    expect(() => checkFetchIndex({ ...index(), environment: "staging" }, "production", key)).toThrow(/for staging/);
    expect(() => checkFetchIndex({ ...index(), archiveSha256: "x" }, "production", key)).toThrow(/sha256/);
    expect(() => checkFetchIndex(index(), "production", "production/2026-10-22/evil.index.json")).toThrow(/not a backup's index key/);
  });
});

describe("the restore drill's refusal to touch production", () => {
  const PROD = "productionrefbbbbbbb";
  const SCRATCH = "scratchrefcccccccccc";
  const productionPooler = `postgresql://postgres.${PROD}@aws-0-ca-central-1.pooler.supabase.com:5432/postgres`;
  const productionDirect = `postgresql://postgres@db.${PROD}.supabase.co:5432/postgres`;
  const scratchPooler = `postgresql://postgres.${SCRATCH}@aws-0-ca-central-1.pooler.supabase.com:5432/postgres`;
  const scratchAddress = `https://${SCRATCH}.supabase.co`;
  const productionAddress = `https://${PROD}.supabase.co`;

  it("recognises the same project through the pooler or directly", () => {
    expect(sameDatabase(productionPooler, productionDirect)).toBe(true);
    expect(sameDatabase(productionDirect.replace("5432", "6543"), productionPooler)).toBe(true);
    expect(databaseIdentity(scratchPooler).ref).toBe(SCRATCH);
    expect(sameDatabase(scratchPooler, productionPooler)).toBe(false);
  });

  it("compares host, port and database name when there is no project", () => {
    const live = "postgresql://postgres@127.0.0.1:54322/postgres";
    expect(sameDatabase(live, "postgresql://postgres@localhost:54322/postgres")).toBe(true);
    expect(sameDatabase(withPassword(live, "postgres"), "postgresql://postgres@localhost:54322/postgres")).toBe(true);
    expect(sameDatabase(live, "postgresql://postgres@127.0.0.1:54322/restore_drill")).toBe(false);
    expect(sameDatabase(live, "postgresql://postgres@127.0.0.1/postgres")).toBe(false);
    expect(() => databaseIdentity("https://example.org")).toThrow(/postgresql/);
    expect(() => databaseIdentity("not a url")).toThrow(/Not a database URL/);
    expect(projectRefOf(`${productionAddress}/`)).toBe(PROD);
    expect(projectRefOf("http://127.0.0.1:54321")).toBeNull();
  });

  const refused = (env: Record<string, string>) => {
    const decision = checkRestoreTarget(env);
    return decision.ok ? "allowed" : decision.reason;
  };

  it("refuses production as the database target, through the pooler or directly", () => {
    expect(refused({ TARGET_DB_URL: productionPooler, PROTECT_DB_URL: productionDirect })).toMatch(/protected database/);
    expect(refused({ TARGET_DB_URL: productionDirect, PROTECT_DB_URL: productionPooler })).toMatch(/protected database/);
  });

  it("refuses a database target in the project PROTECT_SUPABASE_URL names", () => {
    const otherProtected = "postgresql://postgres@10.0.0.5:5432/postgres";
    expect(refused({ TARGET_DB_URL: productionPooler, PROTECT_DB_URL: otherProtected, PROTECT_SUPABASE_URL: productionAddress })).toMatch(
      /protected project/,
    );
  });

  it("refuses production as the file target, named by address or by PROTECT_DB_URL's project", () => {
    const base = { TARGET_DB_URL: scratchPooler, PROTECT_DB_URL: productionPooler };
    expect(refused({ ...base, TARGET_SUPABASE_URL: `${productionAddress}/`, PROTECT_SUPABASE_URL: productionAddress })).toMatch(/protected project/);
    expect(refused({ ...base, TARGET_SUPABASE_URL: productionAddress })).toMatch(/protected project/);
  });

  it("refuses files and database in different projects, or when it cannot tell", () => {
    const base = { PROTECT_DB_URL: productionPooler };
    expect(refused({ ...base, TARGET_DB_URL: scratchPooler, TARGET_SUPABASE_URL: "https://otherrefdddddddddddd.supabase.co" })).toMatch(/different projects/);
    expect(refused({ ...base, TARGET_DB_URL: "postgresql://postgres@203.0.113.9:5432/postgres", TARGET_SUPABASE_URL: scratchAddress })).toMatch(
      /Cannot tell/,
    );
  });

  it("refuses to start without PROTECT_DB_URL or a target", () => {
    expect(refused({ TARGET_DB_URL: scratchPooler })).toMatch(/PROTECT_DB_URL is not set/);
    expect(refused({ PROTECT_DB_URL: productionPooler })).toMatch(/TARGET_DB_URL is not set/);
  });

  it("allows a scratch project, and the local rehearsal", () => {
    expect(refused({ TARGET_DB_URL: scratchPooler, PROTECT_DB_URL: productionPooler, PROTECT_SUPABASE_URL: productionAddress, TARGET_SUPABASE_URL: scratchAddress })).toBe(
      "allowed",
    );
    expect(
      refused({
        TARGET_DB_URL: "postgresql://postgres@127.0.0.1:54322/restore_drill",
        PROTECT_DB_URL: "postgresql://postgres@127.0.0.1:54322/postgres",
        TARGET_SUPABASE_URL: "http://127.0.0.1:54321",
      }),
    ).toBe("allowed");
  });

  it("refuses the same way when the file restore runs on its own", () => {
    const files = (env: Record<string, string>) => {
      const decision = checkFilesTarget({ TARGET_SERVICE_ROLE_KEY: "k", ...env });
      return decision.ok ? "allowed" : decision.reason;
    };
    expect(files({ TARGET_SUPABASE_URL: scratchAddress })).toMatch(/Name the project to keep away from/);
    expect(files({ TARGET_SUPABASE_URL: productionAddress, PROTECT_SUPABASE_URL: productionAddress })).toMatch(/protected project/);
    expect(files({ TARGET_SUPABASE_URL: productionAddress, PROTECT_DB_URL: productionDirect })).toMatch(/protected project/);
    expect(files({ TARGET_SUPABASE_URL: scratchAddress, PROTECT_SUPABASE_URL: productionAddress })).toBe("allowed");
    // This computer's names for itself are one address.
    expect(files({ TARGET_SUPABASE_URL: "http://localhost:54321", PROTECT_SUPABASE_URL: "http://127.0.0.1:54321/" })).toMatch(/protected project/);
  });

  it("knows an address that carries a password, which the scripts refuse", () => {
    expect(urlHasPassword(scratchPooler)).toBe(false);
    expect(urlHasPassword(withPassword(scratchPooler, "pw"))).toBe(true);
    expect(urlHasPassword("not a url")).toBe(false);
    // The password as a parameter, or in libpq's keyword form.
    expect(urlHasPassword(`${scratchPooler}?password=pw`)).toBe(true);
    expect(urlHasPassword(`${scratchPooler}?sslmode=require&PASSWORD=pw`)).toBe(true);
    expect(urlHasPassword("host=db.example.com user=postgres password=pw")).toBe(true);
    expect(urlHasPassword("host=db.example.com user=postgres password = pw")).toBe(true);
    expect(urlHasPassword(`${scratchPooler}?passfile=/home/me/.pgpass`)).toBe(false);
    expect(urlHasPassword("host=db.example.com user=postgres")).toBe(false);
  });

  it("requires TLS to any database that is not on this computer", () => {
    expect(databaseTls(scratchPooler, undefined)).toEqual({ mode: "require" });
    expect(databaseTls(`${scratchPooler}?sslmode=require`, undefined)).toEqual({ mode: null });
    expect(databaseTls(`${scratchPooler}?sslmode=verify-full`, undefined)).toEqual({ mode: null });
    expect(databaseTls(scratchPooler, "require")).toEqual({ mode: null });
    expect(databaseTls(scratchPooler, "verify-ca")).toEqual({ mode: null });
    for (const weak of ["disable", "allow", "prefer"]) {
      expect(() => databaseTls(`${scratchPooler}?sslmode=${weak}`, undefined), weak).toThrow(/TLS.*sslmode=require/);
      expect(() => databaseTls(scratchPooler, weak), weak).toThrow(/TLS.*PGSSLMODE/);
    }
    // The local stack has no TLS: not required on this computer only.
    expect(databaseTls("postgresql://postgres@127.0.0.1:54322/postgres", undefined)).toEqual({ mode: null });
    expect(databaseTls("postgresql://postgres@localhost:54322/postgres", "disable")).toEqual({ mode: null });
    expect(() => databaseTls("postgresql://postgres@172.18.0.1:54322/postgres", "disable")).toThrow(/TLS/);
    expect(() => databaseTls("host=db.example.com user=postgres", undefined)).toThrow(/postgresql:\/\//);
  });

  it("refuses a repeated sslmode with any weak value (libpq reads the last, other drivers the first)", () => {
    expect(() => databaseTls(`${scratchPooler}?sslmode=require&sslmode=disable`, undefined)).toThrow(/sslmode=disable/);
    expect(() => databaseTls(`${scratchPooler}?sslmode=verify-full&sslmode=prefer`, "require")).toThrow(/sslmode=prefer/);
    expect(() => databaseTls(`${scratchPooler}?sslmode=disable&sslmode=require`, undefined)).toThrow(/sslmode=disable/);
    expect(databaseTls(`${scratchPooler}?sslmode=require&sslmode=verify-full`, undefined)).toEqual({ mode: null });
  });

  it("treats an address whose host= parameter names another computer as not local", () => {
    expect(databaseTls("postgresql://postgres@localhost:5432/postgres?host=db.example.com", undefined)).toEqual({ mode: "require" });
    expect(() => databaseTls("postgresql://postgres@127.0.0.1:5432/postgres?host=db.example.com", "disable")).toThrow(/TLS.*PGSSLMODE/);
    expect(() => databaseTls("postgresql://postgres@localhost/postgres?host=db.example.com&sslmode=disable", undefined)).toThrow(/sslmode=disable/);
    expect(databaseTls("postgresql:///postgres?host=db.example.com", undefined)).toEqual({ mode: "require" });
    // Any non-local name in a list (or a repeated host=) counts.
    expect(databaseTls("postgresql://postgres@localhost/postgres?host=localhost,db.example.com", undefined)).toEqual({ mode: "require" });
    expect(databaseTls("postgresql://postgres@localhost/postgres?host=localhost&host=db.example.com", undefined)).toEqual({ mode: "require" });
    // host= naming this computer, or a Unix socket folder, stays local.
    expect(databaseTls("postgresql://postgres@localhost:54322/postgres?host=127.0.0.1", "disable")).toEqual({ mode: null });
    expect(databaseTls("postgresql:///postgres?host=/var/run/postgresql", undefined)).toEqual({ mode: null });
    expect(databaseTls("postgresql://postgres@localhost/postgres?host=%2Ftmp", undefined)).toEqual({ mode: null });
  });

  it("is what `manifest.mjs guard` runs, exiting 1 with the reason", () => {
    const run = (env: Record<string, string>) =>
      spawnSync(process.execPath, [join(process.cwd(), "scripts/backup/manifest.mjs"), "guard"], {
        env: { NODE_ENV: "test", PATH: process.env.PATH ?? "", ...env },
        encoding: "utf8",
      });
    const refusedRun = run({ TARGET_DB_URL: productionDirect, PROTECT_DB_URL: withPassword(productionPooler, "secret") });
    expect(refusedRun.status).toBe(1);
    expect(refusedRun.stderr).toMatch(/Refusing: .*protected database/);
    expect(refusedRun.stderr).not.toContain("secret");
    const missing = run({ TARGET_DB_URL: scratchPooler });
    expect(missing.status).toBe(1);
    const allowed = run({ TARGET_DB_URL: scratchPooler, PROTECT_DB_URL: productionPooler });
    expect(allowed.status, allowed.stderr).toBe(0);
    expect(allowed.stdout).toContain(`project ${SCRATCH}`);
  });
});

describe("restore-drill.sh's roles.sql filter", () => {
  // The pattern of grants left out of roles.sql (the platform's own, which
  // `postgres` may not make); every other grant must stay.
  const script = readFileSync(join(process.cwd(), "scripts/backup/restore-drill.sh"), "utf8");
  const pattern = /^platform_grant='(.*)'$/m.exec(script)?.[1] ?? "";

  function leftOut(lines: string[]) {
    const result = spawnSync("grep", ["-E", pattern], { input: `${lines.join("\n")}\n`, encoding: "utf8" });
    return result.stdout.split("\n").filter(Boolean);
  }

  it("leaves out only parameter grants and grants to the platform's login and service roles", () => {
    expect(pattern).not.toBe("");
    const platform = [
      'GRANT SET ON PARAMETER "log_min_messages" TO "supabase_realtime_admin";',
      'GRANT ALTER SYSTEM ON PARAMETER "x" TO "postgres";',
      'GRANT "postgres" TO "cli_login_postgres";',
      'GRANT "cli_login_postgres" TO "postgres";',
      'GRANT "pg_read_all_data" TO "supabase_read_only_user" GRANTED BY "postgres";',
    ];
    const app = [
      'GRANT "app_role" TO "authenticator";',
      'GRANT "app_role" TO "authenticated";',
      'GRANT "app_role" TO "service_role";',
      'ALTER ROLE "anon" SET "statement_timeout" TO \'3s\';',
    ];
    expect(leftOut([...platform, ...app])).toEqual(platform);
  });
});

describe("what a restore loads besides the dump", () => {
  const platform = readFileSync(join(process.cwd(), "scripts/backup/platform-extras.sql"), "utf8");
  const history = readFileSync(join(process.cwd(), "scripts/backup/migration-history.sql"), "utf8");

  it("restores every scheduled job paused, and writes the statement that starts the ones that ran", () => {
    // Every cron.schedule is followed by alter_job(active := false), not only
    // for jobs that were paused in the backup.
    expect(platform).toMatch(/format\('SELECT cron\.schedule\(%L, %L, %L\);', j\.jobname, j\.schedule, j\.command\)\s*\|\| format\(E'\\nSELECT cron\.alter_job\(\(SELECT jobid FROM cron\.job WHERE jobname = %L\), active := false\);', j\.jobname\)/);
    expect(platform).not.toMatch(/case when not j\.active/);
    expect(platform).toContain("-- start-schedule: ");
  });

  it("adds the migration history's keys and indexes only when the target lacks them", () => {
    expect(history).not.toMatch(/select format\('ALTER TABLE ONLY/);
    expect(history).toMatch(/IF NOT EXISTS \(SELECT 1 FROM pg_catalog\.pg_constraint/);
    expect(history).toMatch(/INDEX IF NOT EXISTS/);
  });
});

describe(".github/workflows/backup.yml", () => {
  const workflow = readFileSync(join(process.cwd(), ".github/workflows/backup.yml"), "utf8");

  it("connects to the database over TLS only", () => {
    expect(workflow).toMatch(/candidate="postgresql:\/\/postgres\.\$\{SUPABASE_PROJECT_REF\}@\$\{prefix\}-\$\{region\}\.pooler\.supabase\.com:5432\/postgres\?sslmode=require"/);
  });

  it("gives each environment's projected monthly traffic to the alert job, which runs after every backup", () => {
    expect(workflow).toMatch(/outputs:\n {6}traffic_staging: \$\{\{ steps\.dump\.outputs\.traffic_staging \}\}\n {6}traffic_production: \$\{\{ steps\.dump\.outputs\.traffic_production \}\}/);
    expect(workflow).toMatch(/echo "traffic_\$\{TARGET_ENVIRONMENT\}=/);
    expect(workflow).toMatch(/ {2}alert:\n(?: {4}.*\n)*? {4}if: always\(\)\n/);
    expect(workflow).toMatch(/- name: Open or update "Backup failed" issues\n\s+if: needs\.backup\.result != 'success'/);
  });

  it("pins every action to a full commit SHA, and age to its release's sha256", () => {
    const uses = [...workflow.matchAll(/^\s*-?\s*uses:\s*(\S+)/gm)].map((m) => m[1]);
    expect(uses.length).toBeGreaterThan(0);
    for (const use of uses) expect(use, use).toMatch(/^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/);
    expect(workflow).toMatch(/age-v1\.2\.1-linux-amd64\.tar\.gz[\s\S]*[0-9a-f]{64} {2}\$RUNNER_TEMP\/age\.tar\.gz" \| sha256sum --check/);
  });

  it("reads the repository only, except the alert job, which writes issues only", () => {
    expect(workflow).toMatch(/^permissions:\n {2}contents: read\n/m);
    const writes = [...workflow.matchAll(/^\s+(\w[\w-]*): write$/gm)].map((m) => m[1]);
    expect(writes).toEqual(["issues"]);
    expect(workflow).toContain("persist-credentials: false");
  });

  it("runs under the backup's own environments, with no app secrets and no account token", () => {
    expect(workflow).toContain("environment: backup-${{ matrix.environment }}");
    expect(workflow).not.toMatch(/secrets\.APP_ENV|SUPABASE_ACCESS_TOKEN/);
    // No secret at job level: each step names the ones it uses.
    const jobEnv = /^ {4}env:\n((?: {6}.*\n)+)/m.exec(workflow)?.[1] ?? "";
    expect(jobEnv).not.toContain("secrets.");
  });

  it("checks in with the outside monitor, and runs every night off the hour and half hour, and on demand", () => {
    expect(workflow).toContain("secrets.BACKUP_HEALTHCHECK_URL");
    const cron = /cron: "(\d+) (\d+) \* \* \*"/.exec(workflow);
    expect(cron).not.toBeNull();
    expect(["0", "30"]).not.toContain(cron![1]);
    expect(workflow).toContain("workflow_dispatch:");
  });

  it("tells the outside monitor about a failed, cancelled or timed-out run", () => {
    expect(workflow).toMatch(/- name: Tell the outside monitor this run failed\n\s+if: failure\(\) \|\| cancelled\(\)/);
  });

  it("never puts the database password in an address: it goes to psql, pg_dump and the CLI as PGPASSWORD", () => {
    expect(workflow).not.toMatch(/postgres(ql)?:\/\/[^\s"']*:[^\s"'@]*@/);
    expect([...workflow.matchAll(/PGPASSWORD: \$\{\{ secrets\.SUPABASE_DB_PASSWORD \}\}/g)]).toHaveLength(2);
    expect(workflow).not.toMatch(/BACKUP_DB_URL_FILE|db-url/);
  });

  it("gives the index key only to the steps that check, read or write the index", () => {
    const steps = workflow.split(/\n {6}- /).filter((step) => step.includes("secrets.BACKUP_INDEX_KEY"));
    expect(steps.map((step) => /name: (.*)/.exec(step)?.[1])).toEqual([
      "Check this environment's backup settings",
      "What the backup bucket already holds",
      "Dump, copy changed files, package and encrypt",
    ]);
  });

  /**
   * Evaluates the two copies of the "which environments" expression the way
   * GitHub does for these operators (&& and || return an operand; '' is
   * false), with a run's context.
   */
  function evaluate(expression: string, context: { event: string; input?: string; nightly?: string }) {
    const js = expression
      .replace(/fromJSON\(/g, "JSON.parse(")
      .replace(/inputs\.environment/g, "ctx.input")
      .replace(/github\.event_name/g, "ctx.event")
      .replace(/vars\.BACKUP_STAGING_NIGHTLY/g, "ctx.nightly")
      .replace(/!=/g, "!==")
      .replace(/([^!=])==/g, "$1===");
    return new Function("ctx", `return (${js});`)({ input: "", nightly: "", ...context });
  }

  it("backs up the same environments the alert job checks, with staging nightly only when BACKUP_STAGING_NIGHTLY is on", () => {
    const matrix = /^ {8}environment: \$\{\{ (fromJSON\(.*\)) \}\}$/m.exec(workflow)?.[1] ?? "";
    const alert = /^ {6}ENVIRONMENTS: \$\{\{ (.*) \}\}$/m.exec(workflow)?.[1] ?? "";
    expect(matrix).not.toBe("");
    expect(alert).not.toBe("");
    const cases = [
      { context: { event: "schedule" }, expected: ["production"] },
      { context: { event: "schedule", nightly: "off" }, expected: ["production"] },
      { context: { event: "schedule", nightly: "on" }, expected: ["staging", "production"] },
      { context: { event: "workflow_dispatch", input: "both" }, expected: ["staging", "production"] },
      { context: { event: "workflow_dispatch", input: "both", nightly: "off" }, expected: ["staging", "production"] },
      { context: { event: "workflow_dispatch", input: "staging" }, expected: ["staging"] },
      { context: { event: "workflow_dispatch", input: "production", nightly: "on" }, expected: ["production"] },
    ];
    for (const { context, expected } of cases) {
      expect(evaluate(matrix, context), JSON.stringify(context)).toEqual(expected);
      expect(String(evaluate(alert, context)).split(" "), JSON.stringify(context)).toEqual(expected);
    }
  });
});
