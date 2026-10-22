import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildIndex, buildManifest, createRowCounter, fingerprint, parseIndexKey, recipientTag, storageFromDump } from "../../scripts/backup/lib.mjs";
import { dataDump, fakeEncrypt, startServer, writeFakeTools } from "./backup-fakes";

/**
 * The backup scripts themselves (DATA-001), run as the workflow and a
 * custodian run them, against stand-ins for age, the bucket and Supabase
 * Storage (tests/unit/backup-fakes.ts): the races, planted objects and odd
 * files that a test of lib.mjs alone cannot reach.
 */

const repo = process.cwd();
const RECIPIENT = "age1lqqlewea2m8y897m8ncrk58acexr2wqmky3yey706xh6z6uwlyjs5l7dge";
const TAG = recipientTag([RECIPIENT]);
/** A test index key: 32 different bytes, as hex (never a real secret). */
const INDEX_KEY_TEXT = Buffer.from(Array.from({ length: 32 }, (_, i) => (i * 37 + 11) % 256)).toString("hex");
const OTHER_KEY_TEXT = Buffer.from(Array.from({ length: 32 }, (_, i) => (i * 53 + 5) % 256)).toString("hex");
const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const md5 = (bytes: Buffer) => createHash("md5").update(bytes).digest("hex");

let root = "";
let tools = "";
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "qbbe-backup-scripts-"));
  tools = writeFakeTools(join(root, "bin"));
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

type Result = { status: number | null; stdout: string; stderr: string; output: string };

/** Starts a command without blocking this process (the fake servers live here). */
function start(command: string, args: string[], env: Record<string, string>, input?: string): { child: ChildProcess; done: Promise<Result> } {
  const child = spawn(command, args, { cwd: repo, env: { NODE_ENV: "test", PATH: `${tools}:${process.env.PATH ?? ""}`, HOME: root, ...env } });
  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (c) => (stdout += c));
  child.stderr?.on("data", (c) => (stderr += c));
  child.stdin?.end(input ?? "");
  const done = new Promise<Result>((resolve) => child.on("close", (status) => resolve({ status, stdout, stderr, output: stdout + stderr })));
  return { child, done };
}

/** Runs a command to the end. */
function run(command: string, args: string[], env: Record<string, string>, input?: string) {
  return start(command, args, env, input).done;
}

/** A fake Storage API serving `files` (bucket/path → bytes), answering a batch of downloads at once. */
async function fakeStorage(files: Map<string, Buffer>, options: { batch?: number } = {}) {
  const waiting: (() => void)[] = [];
  let gets = 0;
  const server = await startServer(async (req, res) => {
    const match = /^\/storage\/v1\/object\/([^/]+)\/(.+)$/.exec(req.url ?? "");
    const bytes = match ? files.get(`${match[1]}/${decodeURIComponent(match[2])}`) : undefined;
    if (!bytes) {
      res.statusCode = 404;
      res.end(JSON.stringify({ error: "not_found" }));
      return;
    }
    gets += 1;
    // Hold downloads until a batch has arrived, then answer them together,
    // so identical files finish at the same moment.
    await new Promise<void>((resolve) => {
      waiting.push(resolve);
      if (waiting.length >= (options.batch ?? 1)) waiting.splice(0).forEach((go) => go());
      else setTimeout(() => waiting.splice(0).forEach((go) => go()), 300);
    });
    res.setHeader("content-type", "application/octet-stream");
    res.end(bytes);
  });
  return { ...server, gets: () => gets };
}

/** A work folder holding the db/data.sql an export reads. */
function exportWork(name: string, files: { bucket: string; path: string; id: string; bytes: Buffer }[]) {
  const work = join(root, name, "work");
  mkdirSync(join(work, "db"), { recursive: true });
  writeFileSync(
    join(work, "db", "data.sql"),
    dataDump(
      [...new Set(files.map((f) => f.bucket))],
      files.map((f) => ({ ...f, size: f.bytes.length, md5: md5(f.bytes) })),
    ),
  );
  return work;
}

function exportEnv(storageUrl: string, extra: Record<string, string> = {}) {
  return {
    SUPABASE_URL: storageUrl,
    SUPABASE_SERVICE_ROLE_KEY: "test-service-role",
    BACKUP_AGE_RECIPIENT: RECIPIENT,
    BACKUP_INDEX_KEY: INDEX_KEY_TEXT,
    AGE_BIN: join(tools, "age"),
    ...extra,
  };
}

describe("export-storage.mjs: files with the same content downloaded the same night", () => {
  it("stores one blob and records its encrypted size and sha256, however the downloads interleave", async () => {
    const content = randomBytes(256 * 1024);
    const files = Array.from({ length: 24 }, (_, i) => ({ bucket: "documents", path: `copy-${i}.pdf`, id: `id-${i}`, bytes: content }));
    const storage = await fakeStorage(new Map(files.map((f) => [`${f.bucket}/${f.path}`, f.bytes])), { batch: 16 });
    try {
      const problems: string[] = [];
      for (let round = 0; round < 8; round += 1) {
        const work = exportWork(`race-${round}`, files);
        const out = join(root, `race-${round}`, "out");
        const result = await run(
          process.execPath,
          ["scripts/backup/export-storage.mjs", work, out, "local", "2026-10"],
          exportEnv(storage.url, { BACKUP_STORAGE_CONCURRENCY: "16" }),
        );
        expect(result.status, result.stderr).toBe(0);
        const index = JSON.parse(readFileSync(join(out, "index-files.json"), "utf8"));
        const blob = readFileSync(join(out, "blobs", `${sha256(content)}.age`));
        expect(index.blobs).toHaveLength(1);
        const record = index.blobs[0];
        if (record.encSize !== blob.length || record.encSha256 !== sha256(blob)) problems.push(`round ${round}: ${JSON.stringify(record)}`);
        if (/no recorded checksum/.test(result.stdout)) problems.push(`round ${round}: false note`);
        expect(readdirSync(join(out, "blobs")).filter((f) => f.endsWith(".age"))).toHaveLength(1);
      }
      expect(problems).toEqual([]);
    } finally {
      await storage.close();
    }
  }, 120_000);
});

describe("manifest.mjs unpack-blobs: a file of zero bytes", () => {
  /** An unpacked backup whose manifest lists one empty file and one with bytes. */
  function emptyFileBackup(name: string) {
    const work = join(root, name, "work");
    const blobs = join(root, name, "blobs");
    mkdirSync(work, { recursive: true });
    mkdirSync(blobs, { recursive: true });
    const empty = Buffer.alloc(0);
    const full = Buffer.from("hello");
    const objects = [
      { bucket: "documents", path: "empty.txt", size: 0, sha256: sha256(empty), contentType: "text/plain", blob: `blobs/local/2026-10-${TAG}/${sha256(empty)}.age` },
      { bucket: "documents", path: "hello.txt", size: 5, sha256: sha256(full), contentType: "text/plain", blob: `blobs/local/2026-10-${TAG}/${sha256(full)}.age` },
    ];
    const manifest = buildManifest({
      environment: "local",
      createdAt: "2026-10-22T07:17:00.000Z",
      files: {},
      rows: {},
      platform: { policies: 0, triggers: 0, queues: 0, cronJobs: 0 },
      generation: "2026-10",
      buckets: [{ id: "documents" }],
      objects,
    });
    writeFileSync(join(work, "manifest.json"), JSON.stringify(manifest));
    writeFileSync(join(blobs, `${sha256(empty)}.age`), fakeEncrypt(empty));
    writeFileSync(join(blobs, `${sha256(full)}.age`), fakeEncrypt(full));
    writeFileSync(join(root, name, "key.txt"), "AGE-SECRET-KEY-TEST");
    return { work, blobs, identity: join(root, name, "key.txt") };
  }

  for (const lazy of ["0", "1"]) {
    it(`gives back an empty file${lazy === "1" ? " with an age that creates no output for empty plaintext (age 1.1.1)" : ""}`, async () => {
      const { work, blobs, identity } = emptyFileBackup(`empty-${lazy}`);
      const result = await run(process.execPath, ["scripts/backup/manifest.mjs", "unpack-blobs", work, blobs], {
        AGE_BIN: join(tools, "age"),
        AGE_IDENTITY_FILE: identity,
        FAKE_AGE_LAZY_OUTPUT: lazy,
      });
      expect(result.status, result.stdout + result.stderr).toBe(0);
      const file = join(work, "storage", "objects", "documents", "empty.txt");
      expect(existsSync(file)).toBe(true);
      expect(statSync(file).size).toBe(0);
      expect(readFileSync(join(work, "storage", "objects", "documents", "hello.txt"), "utf8")).toBe("hello");
    });
  }
});

// ---------------------------------------------------------------------------
// bucket.sh against a fake bucket
// ---------------------------------------------------------------------------

const BUCKET = "qbbe-test";
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const HEX64 = /[0-9a-f]{64}/;

/** The settings bucket.sh needs, pointing at a fake bucket kept in `s3root`. */
function s3Env(s3root: string, extra: Record<string, string> = {}) {
  return {
    BACKUP_S3_ENDPOINT: "https://objectstorage.example.test",
    BACKUP_S3_BUCKET: BUCKET,
    BACKUP_S3_REGION: "ca-montreal-1",
    BACKUP_S3_ACCESS_KEY_ID: "test-access",
    BACKUP_S3_SECRET_ACCESS_KEY: "test-secret",
    BACKUP_AGE_RECIPIENT: RECIPIENT,
    BACKUP_INDEX_KEY: INDEX_KEY_TEXT,
    FAKE_S3_ROOT: s3root,
    // The backup's key cannot overwrite (Oracle: no OBJECT_OVERWRITE).
    FAKE_S3_NO_OVERWRITE: "1",
    ...extra,
  };
}
const objectFile = (s3root: string, key: string) => join(s3root, BUCKET, ...key.split("/"));
function putObject(s3root: string, key: string, bytes: Buffer | string) {
  const file = objectFile(s3root, key);
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, bytes);
}
const getObject = (s3root: string, key: string) => (existsSync(objectFile(s3root, key)) ? readFileSync(objectFile(s3root, key)) : null);
/** A run time to the second, as the backup names it. */
const when = (offset: number) => new Date(Math.floor((Date.now() + offset) / 1000) * 1000);
const stamp = (date: Date) => date.toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
const runKey = (date: Date, suffix: string) => `local/${date.toISOString().slice(0, 10)}/qbbe-local-${stamp(date)}.${suffix}`;

type BlobRecord = { sha256: string; encSize: number; encSha256: string | null; name?: string };
/** A signed index for environment "local", as manifest.mjs index writes it. */
function signedIndex(
  date: Date,
  generation: string,
  files: { fp: string; sha256: string; size: number }[],
  blobs: BlobRecord[],
  archiveSha256 = "c".repeat(64),
  keyText = INDEX_KEY_TEXT,
) {
  return buildIndex(
    {
      environment: "local",
      generation,
      recipients: TAG,
      createdAt: date.toISOString(),
      archive: `qbbe-local-${stamp(date)}.tar.gz.age`,
      archiveSize: 10,
      archiveSha256,
      files,
      blobs,
    },
    parseIndexKey(keyText),
  );
}
/** A plain file, its sha256, and its blob as the fake age writes it. */
function content(size: number) {
  const plain = randomBytes(size);
  const blob = fakeEncrypt(plain);
  return { plain, sha: sha256(plain), blob, record: { sha256: sha256(plain), encSize: blob.length, encSha256: sha256(blob) } as BlobRecord };
}
const lines = (text: string) => text.split("\n").filter(Boolean).sort();

describe("bucket.sh state: which index to trust", () => {
  it("uses the newest index whose signature verifies, from the last 40 days, ignoring planted ones with one warning", async () => {
    const s3root = join(root, "state-index", "s3");
    const blob = content(10);
    const files = [{ fp: "f".repeat(64), sha256: blob.sha, size: 10 }];
    const goodAt = when(-2 * DAY);
    const oldAt = when(-50 * DAY);
    const good = signedIndex(goodAt, "2026-10", files, [blob.record]);
    putObject(s3root, runKey(goodAt, "index.json"), JSON.stringify(good));
    putObject(s3root, runKey(oldAt, "index.json"), JSON.stringify(signedIndex(oldAt, "2026-10", files, [blob.record])));
    // Planted: a malformed one, one signed with another key, an unsigned
    // copy dated within the hour, and one dated three hours ahead.
    const unsigned: Record<string, unknown> = { ...good };
    delete unsigned.mac;
    const planted = [when(-DAY), when(-12 * HOUR), when(30 * MINUTE), when(3 * HOUR)];
    putObject(s3root, runKey(planted[0], "index.json"), "{}");
    putObject(s3root, runKey(planted[1], "index.json"), JSON.stringify(signedIndex(planted[1], "2026-10", files, [blob.record], "c".repeat(64), OTHER_KEY_TEXT)));
    putObject(s3root, runKey(planted[2], "index.json"), JSON.stringify(unsigned));
    putObject(s3root, runKey(planted[3], "index.json"), JSON.stringify(unsigned));
    const dir = join(root, "state-index", "state");
    const result = await run("bash", ["scripts/backup/bucket.sh", "state", "local", "2026-10", dir], s3Env(s3root));
    expect(result.status, result.output).toBe(0);
    expect(JSON.parse(readFileSync(join(dir, "previous-index.json"), "utf8")).mac).toBe(good.mac);
    const warnings = result.output.split("\n").filter((line) => line.includes("::warning::"));
    expect(warnings, result.output).toHaveLength(1);
    expect(warnings[0]).toMatch(/3 backup index\(es\) newer than the one used/);
    expect(warnings[0]).toMatch(/1 dated more than an hour ahead/);
    for (const date of planted) expect(result.output).not.toContain(stamp(date));
    expect(lines(readFileSync(join(dir, "ignored-indexes.txt"), "utf8"))).toHaveLength(4);
    expect(result.output).toContain(`previous index: ${runKey(goodAt, "index.json")}`);
  });
});

describe("bucket.sh state: an old index copied to a newer key", () => {
  it("refuses a correctly signed index whose run is not the one its key names, and uses the real newest", async () => {
    const s3root = join(root, "state-replay", "s3");
    const blob = content(10);
    const files = [{ fp: "f".repeat(64), sha256: blob.sha, size: 10 }];
    const oldAt = when(-6 * DAY);
    const goodAt = when(-2 * DAY);
    const replayAt = when(-DAY);
    const old = signedIndex(oldAt, "2026-10", files, [blob.record]);
    const good = signedIndex(goodAt, "2026-10", files, [blob.record]);
    putObject(s3root, runKey(oldAt, "index.json"), JSON.stringify(old));
    putObject(s3root, runKey(goodAt, "index.json"), JSON.stringify(good));
    // Someone holding only the bucket key copies the real old index, byte
    // for byte, to a newer run's name. Its signature is still right.
    putObject(s3root, runKey(replayAt, "index.json"), readFileSync(objectFile(s3root, runKey(oldAt, "index.json"))));
    const dir = join(root, "state-replay", "state");
    const result = await run("bash", ["scripts/backup/bucket.sh", "state", "local", "2026-10", dir], s3Env(s3root));
    expect(result.status, result.output).toBe(0);
    expect(JSON.parse(readFileSync(join(dir, "previous-index.json"), "utf8")).mac).toBe(good.mac);
    expect(result.output).toContain(`previous index: ${runKey(goodAt, "index.json")}`);
    const warnings = result.output.split("\n").filter((line) => line.includes("::warning::"));
    expect(warnings, result.output).toHaveLength(1);
    expect(warnings[0]).toMatch(/1 backup index\(es\) newer than the one used/);
    expect(lines(readFileSync(join(dir, "ignored-indexes.txt"), "utf8"))).toEqual([`${runKey(replayAt, "index.json")} key`]);
  });
});

describe("bucket.sh state and export-storage.mjs: objects a run cannot vouch for", () => {
  it("checks what holds a blob's name in the new month, keeps a matching copy, and stores the rest under another name", async () => {
    const s3root = join(root, "carry", "s3");
    const september = `blobs/local/2026-09-${TAG}/`;
    const october = `blobs/local/2026-10-${TAG}/`;
    const [a, b, c, d, x] = [content(100), content(120), content(140), content(160), content(60)];
    const dbFiles = [
      { bucket: "documents", path: "a.pdf", id: "a", bytes: a.plain },
      { bucket: "documents", path: "b.pdf", id: "b", bytes: b.plain },
      { bucket: "documents", path: "c.pdf", id: "c", bytes: c.plain },
      { bucket: "documents", path: "d.pdf", id: "d", bytes: d.plain },
      { bucket: "documents", path: "x.pdf", id: "x", bytes: x.plain },
    ];
    const work = exportWork("carry", dbFiles);
    const counter = createRowCounter(["storage.buckets", "storage.objects"]);
    for (const line of readFileSync(join(work, "db", "data.sql"), "utf8").split("\n")) counter.line(line);
    const fps = new Map(storageFromDump(counter.rows()).objects.map((o) => [o.id, fingerprint(o)]));
    // Last month's signed index: a, b, c, and d stored under another name.
    const dRecord = { ...d.record, name: `${d.sha}.2.age` };
    const indexAt = when(-DAY);
    const index = signedIndex(
      indexAt,
      "2026-09",
      [a, b, c, d].map((f, i) => ({ fp: fps.get("abcd"[i]) as string, sha256: f.sha, size: f.plain.length })),
      [a.record, b.record, c.record, dRecord],
    );
    putObject(s3root, runKey(indexAt, "index.json"), JSON.stringify(index));
    for (const f of [a, b, c]) putObject(s3root, `${september}${f.sha}.age`, f.blob);
    putObject(s3root, `${september}${d.sha}.age`, randomBytes(d.blob.length));
    putObject(s3root, `${september}${d.sha}.2.age`, d.blob);
    // This month: garbage of the right size at a's name (planted), a good
    // copy of b left by a first night that failed after copying, and
    // garbage at the name x would get.
    putObject(s3root, `${october}${a.sha}.age`, randomBytes(a.blob.length));
    putObject(s3root, `${october}${b.sha}.age`, b.blob);
    putObject(s3root, `${october}${x.sha}.age`, randomBytes(x.blob.length));

    const dir = join(root, "carry", "state");
    const state = await run("bash", ["scripts/backup/bucket.sh", "state", "local", "2026-10", dir], s3Env(s3root));
    expect(state.status, state.output).toBe(0);
    expect(lines(readFileSync(join(dir, "carried.txt"), "utf8"))).toEqual(
      lines([`${a.sha} ${a.sha}.2.age`, `${b.sha} ${b.sha}.age`, `${c.sha} ${c.sha}.age`, `${d.sha} ${d.sha}.age`].join("\n")),
    );
    expect(getObject(s3root, `${october}${a.sha}.2.age`)?.equals(a.blob)).toBe(true);
    expect(getObject(s3root, `${october}${c.sha}.age`)?.equals(c.blob)).toBe(true);
    expect(getObject(s3root, `${october}${d.sha}.age`)?.equals(d.blob)).toBe(true);
    expect(state.output).not.toMatch(HEX64);
    expect(state.output).toMatch(/::warning::1 blob name\(s\) in blobs\/local\/2026-10-[0-9a-f]{16}\/ hold an object that does not match/);

    // The night's export reads only x from Supabase, and stores it under
    // another name; every other file keeps its checked record.
    const storage = await fakeStorage(new Map([[`documents/x.pdf`, x.plain]]));
    try {
      const out = join(root, "carry", "out");
      const result = await run(process.execPath, ["scripts/backup/export-storage.mjs", work, out, "local", "2026-10"], exportEnv(storage.url, { BACKUP_STATE_DIR: dir }));
      expect(result.status, result.output).toBe(0);
      expect(storage.gets()).toBe(1);
      const exported = JSON.parse(readFileSync(join(out, "index-files.json"), "utf8"));
      const records = new Map(exported.blobs.map((r: BlobRecord) => [r.sha256, r]));
      const xBlob = readFileSync(join(out, "blobs", `${x.sha}.2.age`));
      expect(records.get(a.sha)).toEqual({ ...a.record, name: `${a.sha}.2.age` });
      expect(records.get(b.sha)).toEqual(b.record);
      expect(records.get(c.sha)).toEqual(c.record);
      expect(records.get(d.sha)).toEqual(d.record);
      expect(records.get(x.sha)).toEqual({ sha256: x.sha, encSize: xBlob.length, encSha256: sha256(xBlob), name: `${x.sha}.2.age` });
      expect(readdirSync(join(out, "blobs"))).toEqual([`${x.sha}.2.age`]);
      const manifestObjects = JSON.parse(readFileSync(join(work, "storage", "index.json"), "utf8")).objects;
      expect(manifestObjects.find((o: { path: string }) => o.path === "a.pdf").blob).toBe(`${october}${a.sha}.2.age`);
      expect(result.output).not.toMatch(HEX64);
      expect(result.output).toMatch(/::warning::1 new blob\(s\) stored under another name/);
    } finally {
      await storage.close();
    }
  });
});

describe("bucket.sh push: what a failure prints", () => {
  it("prints counts only, and keeps the blob hashes in a local file", async () => {
    const s3root = join(root, "push", "s3");
    const out = join(root, "push", "out");
    const october = `blobs/local/2026-10-${TAG}/`;
    const [good, missing, wrong] = [content(30), content(40), content(50)];
    mkdirSync(join(out, "blobs"), { recursive: true });
    // good is new tonight, under another name; wrong is damaged in the bucket.
    writeFileSync(join(out, "blobs", `${good.sha}.2.age`), good.blob);
    putObject(s3root, `${october}${good.sha}.age`, randomBytes(5));
    putObject(s3root, `${october}${wrong.sha}.age`, randomBytes(wrong.blob.length + 1));
    const date = when(0);
    const archive = join(out, `qbbe-local-${stamp(date)}.tar.gz.age`);
    writeFileSync(archive, randomBytes(64));
    const indexFile = join(out, `qbbe-local-${stamp(date)}.index.json`);
    writeFileSync(indexFile, JSON.stringify({ blobs: [{ ...good.record, name: `${good.sha}.2.age` }, missing.record, wrong.record] }));
    writeFileSync(join(out, "backup.env"), `BACKUP_FILE=${archive}\nBACKUP_INDEX_FILE=${indexFile}\nBACKUP_BLOB_PREFIX=${october}\n`);
    const result = await run("bash", ["scripts/backup/bucket.sh", "push", out, "local"], s3Env(s3root));
    expect(result.status).toBe(1);
    expect(getObject(s3root, `${october}${good.sha}.2.age`)?.equals(good.blob)).toBe(true);
    expect(result.output).toContain("Blobs: 3 needed by this backup, 1 missing, 1 with the wrong size.");
    expect(result.output).toMatch(/::error::1 blob\(s\) this backup needs are not in/);
    expect(result.output).toMatch(/::error::1 blob\(s\) in .* do not have the encrypted size recorded/);
    for (const sha of [good.sha, missing.sha, wrong.sha]) expect(result.output).not.toContain(sha);
    const details = readFileSync(join(out, "blob-check.txt"), "utf8");
    expect(details).toContain(`missing: ${missing.sha}.age`);
    expect(details).toContain(`wrong size: ${wrong.sha}.age`);
    // The archive is still kept, without its index.
    expect(getObject(s3root, runKey(date, "tar.gz.age"))).not.toBeNull();
    expect(getObject(s3root, runKey(date, "index.json"))).toBeNull();
  });
});

describe("bucket.sh fetch and unpack-blobs: a restore", () => {
  it("skips runs dated in the future, lists the runs it considered, follows recorded names, and finds copies in other month folders", async () => {
    const s3root = join(root, "fetch", "s3");
    const september = `blobs/local/2026-09-${TAG}/`;
    const october = `blobs/local/2026-10-${TAG}/`;
    const [a, b, c, e] = [content(100), content(120), content(140), content(90)];
    // a: stored under another name, its usual name planted. b: damaged in
    // its folder, an identical copy carried into the next month. e: recorded
    // without its encrypted sha256 (an old or planted index), its own folder
    // holding another file's blob, the next month a good one.
    putObject(s3root, `${september}${a.sha}.age`, fakeEncrypt(randomBytes(100)));
    putObject(s3root, `${september}${a.sha}.2.age`, a.blob);
    putObject(s3root, `${september}${b.sha}.age`, randomBytes(b.blob.length));
    putObject(s3root, `${october}${b.sha}.age`, b.blob);
    putObject(s3root, `${september}${c.sha}.age`, c.blob);
    putObject(s3root, `${september}${e.sha}.age`, fakeEncrypt(randomBytes(90)));
    putObject(s3root, `${october}${e.sha}.age`, e.blob);
    const date = when(-3 * DAY);
    const archive = randomBytes(256);
    const records = [{ ...a.record, name: `${a.sha}.2.age` }, b.record, c.record, { ...e.record, encSha256: null }];
    const index = signedIndex(date, "2026-09", records.map((r, i) => ({ fp: String(i).repeat(64), sha256: r.sha256, size: 1 })), records, sha256(archive));
    putObject(s3root, runKey(date, "index.json"), JSON.stringify(index));
    putObject(s3root, runKey(date, "tar.gz.age"), archive);
    // Planted: a malformed index dated an hour ago, and a well-formed one
    // three hours ahead with an archive of its own.
    const malformedAt = when(-HOUR);
    putObject(s3root, runKey(malformedAt, "index.json"), JSON.stringify({ format: "nope" }));
    const future = when(3 * HOUR);
    const futureArchive = randomBytes(32);
    putObject(s3root, runKey(future, "index.json"), JSON.stringify({ ...index, archive: `qbbe-local-${stamp(future)}.tar.gz.age`, archiveSha256: sha256(futureArchive), mac: undefined }));
    putObject(s3root, runKey(future, "tar.gz.age"), futureArchive);

    const dest = join(root, "fetch", "dest");
    const env = s3Env(s3root, { BACKUP_AGE_RECIPIENT: "", BACKUP_INDEX_KEY: "" });
    const result = await run("bash", ["scripts/backup/bucket.sh", "fetch", "local", "latest", dest], env);
    expect(result.status, result.output).toBe(0);
    expect(readFileSync(join(dest, `qbbe-local-${stamp(date)}.tar.gz.age`)).equals(archive)).toBe(true);
    expect(existsSync(join(dest, `qbbe-local-${stamp(future)}.tar.gz.age`))).toBe(false);
    expect(result.output).toMatch(/1 dated more than an hour ahead/);
    expect(result.output).toContain(`${stamp(date)}  archive sha256 ${sha256(archive)}`);
    expect(result.output).toContain(`${stamp(malformedAt)}  not a valid backup index`);
    expect(readFileSync(join(dest, "blobs", `${a.sha}.2.age`)).equals(a.blob)).toBe(true);
    expect(readFileSync(join(dest, "blobs", `${b.sha}.age`)).equals(b.blob)).toBe(true);
    expect(readFileSync(join(dest, "blobs", `${c.sha}.age`)).equals(c.blob)).toBe(true);
    expect(result.output).toMatch(/1 blob\(s\) have no recorded encrypted sha256/);

    // unpack-blobs follows each file's recorded name, and of the unchecked
    // copies keeps the one whose bytes have the file's sha256.
    const work = join(root, "fetch", "work");
    mkdirSync(work, { recursive: true });
    const objects = [a, b, c, e].map((f, i) => ({
      bucket: "documents",
      path: `${"abce"[i]}.bin`,
      size: f.plain.length,
      sha256: f.sha,
      contentType: null,
      blob: `${september}${records[i].name ?? `${f.sha}.age`}`,
    }));
    writeFileSync(
      join(work, "manifest.json"),
      JSON.stringify(buildManifest({ environment: "local", createdAt: date.toISOString(), files: {}, rows: {}, platform: { policies: 0, triggers: 0, queues: 0, cronJobs: 0 }, generation: "2026-09", buckets: [{ id: "documents" }], objects })),
    );
    writeFileSync(join(root, "fetch", "key.txt"), "AGE-SECRET-KEY-TEST");
    const unpack = await run(process.execPath, ["scripts/backup/manifest.mjs", "unpack-blobs", work, join(dest, "blobs")], {
      AGE_BIN: join(tools, "age"),
      AGE_IDENTITY_FILE: join(root, "fetch", "key.txt"),
    });
    expect(unpack.status, unpack.output).toBe(0);
    for (const [i, f] of [a, b, c, e].entries()) {
      expect(readFileSync(join(work, "storage", "objects", "documents", `${"abce"[i]}.bin`)).equals(f.plain)).toBe(true);
    }
  });
});

describe("bucket.sh fetch: a run whose archive is missing", () => {
  it("skips a valid index without its archive and fetches the next run, for latest and for a date", async () => {
    const s3root = join(root, "fetch-missing", "s3");
    const january = `blobs/local/2026-01-${TAG}/`;
    const a = content(50);
    putObject(s3root, `${january}${a.sha}.age`, a.blob);
    const earlier = new Date("2026-01-10T03:00:00Z");
    const later = new Date("2026-01-10T05:00:00Z");
    const archive = randomBytes(64);
    const files = [{ fp: "0".repeat(64), sha256: a.sha, size: 50 }];
    putObject(s3root, runKey(earlier, "index.json"), JSON.stringify(signedIndex(earlier, "2026-01", files, [a.record], sha256(archive))));
    putObject(s3root, runKey(earlier, "tar.gz.age"), archive);
    // The newest run's index is well formed, but its archive is not there.
    putObject(s3root, runKey(later, "index.json"), JSON.stringify(signedIndex(later, "2026-01", files, [a.record], sha256(randomBytes(64)))));
    const env = s3Env(s3root, { BACKUP_AGE_RECIPIENT: "", BACKUP_INDEX_KEY: "" });
    for (const which of ["latest", "2026-01-10"]) {
      const dest = join(root, "fetch-missing", `dest-${which}`);
      const result = await run("bash", ["scripts/backup/bucket.sh", "fetch", "local", which, dest], env);
      expect(result.status, `${which}: ${result.output}`).toBe(0);
      expect(result.output).toContain(`Skipping ${stamp(later)}: its index is valid, but its archive qbbe-local-${stamp(later)}.tar.gz.age is not in the bucket.`);
      expect(result.output).toContain(`Fetching ${stamp(earlier)}.`);
      expect(readFileSync(join(dest, `qbbe-local-${stamp(earlier)}.tar.gz.age`)).equals(archive)).toBe(true);
      expect(readFileSync(join(dest, "blobs", `${a.sha}.age`)).equals(a.blob)).toBe(true);
    }
    // One run asked for by name has nothing to fall back to.
    const one = await run("bash", ["scripts/backup/bucket.sh", "fetch", "local", stamp(later), join(root, "fetch-missing", "dest-one")], env);
    expect(one.status).not.toBe(0);
    expect(one.output).toContain(`its archive qbbe-local-${stamp(later)}.tar.gz.age is not in the bucket`);
  });
});

// ---------------------------------------------------------------------------
// restore-storage.mjs and Ctrl-C
// ---------------------------------------------------------------------------

type Settings = { id: string; public: boolean; file_size_limit: number | null; allowed_mime_types: string[] | null };
const BACKED_UP: Settings[] = [
  { id: "rs1", public: false, file_size_limit: 1000, allowed_mime_types: ["text/plain"] },
  { id: "rs2", public: false, file_size_limit: 1000, allowed_mime_types: ["text/plain"] },
];

/** A fake Storage API for a file restore, with hooks to hold requests. */
async function restoreTarget(hooks: { lift?: (id: string) => Promise<void>; putBack?: () => Promise<void>; upload?: () => Promise<void>; readBucket?: () => number | null } = {}) {
  const buckets = new Map(BACKED_UP.map((b) => [b.id, { ...b }]));
  const objects = new Map<string, Buffer>();
  const server = await startServer(async (req, res, body) => {
    const url = decodeURIComponent(req.url ?? "");
    const bucket = /^\/storage\/v1\/bucket\/([^/]+)$/.exec(url);
    const object = /^\/storage\/v1\/object\/([^/]+)\/(.+)$/.exec(url);
    const json = (status: number, value: unknown) => {
      res.statusCode = status;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(value));
    };
    if (bucket && req.method === "GET") {
      const status = hooks.readBucket?.() ?? null;
      if (status) return json(status, { message: "refused" });
      const found = buckets.get(bucket[1]);
      return found ? json(200, found) : json(400, { statusCode: "404", error: "Bucket not found" });
    }
    if (bucket && req.method === "PUT") {
      const settings = JSON.parse(body.toString());
      const lifting = settings.file_size_limit === null && settings.allowed_mime_types === null;
      if (lifting) await hooks.lift?.(bucket[1]);
      else await hooks.putBack?.();
      buckets.set(bucket[1], { id: bucket[1], ...settings });
      return json(200, { message: "ok" });
    }
    if (object && req.method === "POST") {
      await hooks.upload?.();
      objects.set(`${object[1]}/${object[2]}`, body);
      return json(200, { Key: url });
    }
    if (object && req.method === "GET") {
      const bytes = objects.get(`${object[1]}/${object[2]}`);
      if (!bytes) return json(400, { statusCode: "404", error: "not_found" });
      res.end(bytes);
      return;
    }
    json(404, { message: "no route" });
  });
  return { ...server, buckets };
}

/** An unpacked backup with one file in each of two buckets. */
function unpackedBackup(name: string) {
  const work = join(root, name, "work");
  const objects = BACKED_UP.map((b) => ({ bucket: b.id, path: "a.txt", size: 5, sha256: sha256(Buffer.from(`${b.id}!!`)), contentType: "text/plain", blob: "x" }));
  for (const b of BACKED_UP) {
    mkdirSync(join(work, "storage", "objects", b.id), { recursive: true });
    writeFileSync(join(work, "storage", "objects", b.id, "a.txt"), `${b.id}!!`);
  }
  writeFileSync(
    join(work, "manifest.json"),
    JSON.stringify(buildManifest({ environment: "local", createdAt: "2026-10-22T07:17:00.000Z", files: {}, rows: {}, platform: { policies: 0, triggers: 0, queues: 0, cronJobs: 0 }, generation: "2026-10", buckets: BACKED_UP, objects })),
  );
  return work;
}
const restoreEnv = (url: string) => ({ TARGET_SUPABASE_URL: url, TARGET_SERVICE_ROLE_KEY: "test-service-role", PROTECT_SUPABASE_URL: "https://productionrefbbbbbbb.supabase.co" });
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

describe("restore-storage.mjs: bucket settings are always put back", () => {
  it("restores and checks every file, and says how many it downloaded", async () => {
    const target = await restoreTarget();
    try {
      const result = await run(process.execPath, ["scripts/backup/restore-storage.mjs", unpackedBackup("rs-ok")], restoreEnv(target.url));
      expect(result.status, result.output).toBe(0);
      expect(result.output).toContain("2 of 2 downloaded again and compared");
      expect([...target.buckets.values()]).toEqual(BACKED_UP);
    } finally {
      await target.close();
    }
  });

  it("says no settings were changed when Storage refused before any bucket was lifted", async () => {
    const target = await restoreTarget({ readBucket: () => 403 });
    try {
      const result = await run(process.execPath, ["scripts/backup/restore-storage.mjs", unpackedBackup("rs-refused")], restoreEnv(target.url));
      expect(result.status).toBe(1);
      expect(result.output).toContain("no bucket settings were changed");
      expect(result.output).not.toContain("put back and checked");
    } finally {
      await target.close();
    }
  });

  it("waits for a lift still on its way before putting the settings back on Ctrl-C", async () => {
    let child: ChildProcess | null = null;
    const target = await restoreTarget({
      lift: async (id) => {
        if (id !== "rs2") return;
        child?.kill("SIGINT");
        await sleep(1500);
      },
    });
    try {
      const started = start(process.execPath, ["scripts/backup/restore-storage.mjs", unpackedBackup("rs-lift")], restoreEnv(target.url));
      child = started.child;
      const result = await started.done;
      expect(result.status, result.output).toBe(130);
      // Long enough for the held lift to land, whenever it was answered.
      await sleep(1700);
      expect([...target.buckets.values()]).toEqual(BACKED_UP);
    } finally {
      await target.close();
    }
  });

  it("finishes putting the settings back when Ctrl-C is pressed twice", async () => {
    let child: ChildProcess | null = null;
    let signalled = false;
    const target = await restoreTarget({
      putBack: () => sleep(700),
      upload: async () => {
        if (!signalled) {
          signalled = true;
          child?.kill("SIGINT");
          setTimeout(() => child?.kill("SIGINT"), 250);
        }
        await sleep(3000);
      },
    });
    try {
      const started = start(process.execPath, ["scripts/backup/restore-storage.mjs", unpackedBackup("rs-twice")], { ...restoreEnv(target.url), BACKUP_STORAGE_CONCURRENCY: "1" });
      child = started.child;
      const result = await started.done;
      expect(result.status, result.output).toBe(130);
      expect(result.output).toMatch(/already putting the bucket settings back/);
      expect([...target.buckets.values()]).toEqual(BACKED_UP);
    } finally {
      await target.close();
    }
  });
});

// ---------------------------------------------------------------------------
// The workflow's own steps
// ---------------------------------------------------------------------------

/** The bash of one step of backup.yml, as GitHub runs it. */
function stepScript(name: string) {
  const workflow = readFileSync(join(repo, ".github/workflows/backup.yml"), "utf8");
  const at = workflow.indexOf(`- name: ${name}\n`);
  expect(at, name).toBeGreaterThan(0);
  const body = workflow.slice(workflow.indexOf("run: |\n", at) + "run: |\n".length).split("\n");
  const indent = /^ */.exec(body[0])?.[0].length ?? 0;
  const script: string[] = [];
  for (const line of body) {
    if (line.trim() !== "" && !line.startsWith(" ".repeat(indent))) break;
    script.push(line.slice(indent));
  }
  return script.join("\n");
}

/** A folder with a fake command that logs its arguments, one per line, then a blank line. */
function fakeCommand(name: string, extra = "") {
  const dir = mkdtempSync(join(root, `${name}-`));
  writeFileSync(join(dir, name), `#!/usr/bin/env bash\nprintf '%s\\n' "$@" >> "${dir}/calls"; echo >> "${dir}/calls"\n${extra}\n`);
  chmodSync(join(dir, name), 0o755);
  return { dir, calls: () => (existsSync(join(dir, "calls")) ? readFileSync(join(dir, "calls"), "utf8") : "") };
}

describe("backup.yml's check-in and traffic alert", () => {
  it("sends the archive's key, sha256 and time in the success ping, a record outside GitHub", async () => {
    const curl = fakeCommand("curl");
    const result = await run("bash", ["-e", "-c", stepScript("Check in with the outside monitor")], {
      PATH: `${curl.dir}:${process.env.PATH ?? ""}`,
      BACKUP_HEALTHCHECK_URL: "https://hc-ping.com/00000000-0000-0000-0000-000000000000",
      TARGET_ENVIRONMENT: "production",
      BACKUP_KEY: "production/2026-10-22/qbbe-production-20261022T071700Z.tar.gz.age",
      BACKUP_SHA256: "ab".repeat(32),
      BACKUP_SIZE: "1234",
      GITHUB_SERVER_URL: "https://github.com",
      GITHUB_REPOSITORY: "owner/repo",
      GITHUB_RUN_ID: "42",
    });
    expect(result.status, result.output).toBe(0);
    const args = curl.calls().split("\n");
    expect(args).toContain("--data-raw");
    const body = args[args.indexOf("--data-raw") + 1];
    expect(body).toContain("production/2026-10-22/qbbe-production-20261022T071700Z.tar.gz.age");
    expect(body).toContain(`sha256 ${"ab".repeat(32)}`);
    expect(body).toMatch(/made \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z/);
    expect(args.at(-3)).toBe("https://hc-ping.com/00000000-0000-0000-0000-000000000000");
  });

  const GiB = 1024 ** 3;
  async function traffic(staging: number | null, production: number | null, existing = "") {
    const gh = fakeCommand("gh", `if [ "$1 $2" = "issue list" ]; then echo "${existing}"; fi`);
    const result = await run("bash", ["-c", stepScript('Open or update the "Backup traffic high" issue')], {
      PATH: `${gh.dir}:${process.env.PATH ?? ""}`,
      TRAFFIC_STAGING: staging === null ? "" : String(staging),
      TRAFFIC_PRODUCTION: production === null ? "" : String(production),
      ASSIGNEE: "custodian-one",
      RUN_URL: "https://github.com/owner/repo/actions/runs/42",
      GH_REPO: "owner/repo",
    });
    expect(result.status, result.output).toBe(0);
    return gh.calls();
  }

  it("opens one issue, assigned, when all environments together are on course for more than 2 GB a month", async () => {
    const calls = await traffic(Math.round(1.2 * GiB), Math.round(1.0 * GiB));
    expect(calls).toMatch(/^issue\ncreate\n--title\nBackup traffic high\n--body\n[\s\S]*\n--assignee\ncustodian-one\n/m);
    expect(calls).toMatch(/staging: about 1\.2 GB a month/);
  });

  it("comments on the open issue instead of opening another, and stays quiet under 2 GB", async () => {
    expect(await traffic(Math.round(1.5 * GiB), Math.round(0.8 * GiB), "17")).toMatch(/^issue\ncomment\n17\n/m);
    expect(await traffic(Math.round(0.9 * GiB), Math.round(0.9 * GiB))).not.toMatch(/issue\n(create|comment)/);
    expect(await traffic(null, Math.round(1.9 * GiB))).not.toMatch(/issue\n(create|comment)/);
  });
});
