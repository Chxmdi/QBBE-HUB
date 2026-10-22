#!/usr/bin/env node
// Copies the uploaded files of one Supabase project into a backup, each one
// encrypted on its own, downloading only what changed since the previous
// night (DATA-001; docs/runbooks/backup-recovery.md).
//
//   SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=… \
//   BACKUP_AGE_RECIPIENT="age1… age1…" BACKUP_INDEX_KEY=… \
//   [BACKUP_STATE_DIR=…] [BACKUP_DB_URL=postgresql://<user>@<host>:<port>/<db> PGPASSWORD=…] \
//     node scripts/backup/export-storage.mjs <work-dir> <out-dir> <environment> <YYYY-MM>
//
// Why this exists: a database dump holds only the *list* of uploaded files
// (storage.objects); the bytes live in Supabase's object store, and no
// Supabase backup, paid or free, includes them. These blobs are the only
// copy of documents, receipts, form files and signing documents outside
// Supabase.
//
// Which files: exactly those storage.objects lists in <work-dir>/db/data.sql,
// so the files match the database dump taken just before, with names
// exactly as stored.
//
// Why only the changes: Supabase's free plan allows 5 GB of outgoing traffic
// a month for every project together, and copying every file every night
// would use it up. BACKUP_STATE_DIR (made by `bucket.sh state`) holds the
// newest index whose signature verifies (which version of which file has
// which sha256, and each blob's encrypted size, sha256 and name), the list
// of blobs in this month's folder, and the blobs `state` brought into it
// from last month's folder (carried.txt: each one's sha256 and the name it
// was checked under). A file whose version is in the index and whose blob
// is in this month's folder under a record a signed index made (lib.mjs
// knownBlobs) is not downloaded. Nothing else in the folder is ever relied
// on: an object at a blob's name that no signed index records (left by a
// failed run, or planted by someone holding the bucket key) is passed over,
// and the new blob goes under <sha256>.<n>.age instead. The index must
// carry a valid signature (BACKUP_INDEX_KEY); without one, or without
// BACKUP_STATE_DIR, every file is downloaded.
//
// Each downloaded file is streamed through sha256, MD5 and age, so its
// plain bytes never touch the disk. Files with the same content share one
// blob, stored once even when they finish downloading together (lib.mjs
// createBlobStore). Writes:
//   <out-dir>/blobs/<name>           new blobs (<sha256>.age, or
//                                    <sha256>.<n>.age), for bucket.sh
//   <out-dir>/index-files.json       fingerprints and blob records, for the
//                                    index (manifest.mjs index)
//   <work-dir>/storage/index.json    buckets, files and blobs, for the manifest
//
// A file that cannot be copied is listed under "errors" and the script exits
// 3 after writing everything else, so file problems never cost the night's
// database backup; the workflow still fails the run. Even a failure before
// any file (a refused key) ends that way. A file that is gone when its turn
// comes, or whose bytes do not match the size or MD5 the database lists, is
// checked against the database: if its row is gone or changed, it was
// deleted or replaced while the backup ran and is only recorded. The key is
// never printed, and no file name ever is (the log is public); the reasons
// printed are general, and the details stay in the encrypted manifest.

import { spawn } from "node:child_process";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { createHash, randomUUID } from "node:crypto";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  blobFileName,
  blobPrefix,
  createBlobStore,
  createRowCounter,
  formatBytes,
  knownBlobs,
  mergeBlobRecord,
  objectNameProblem,
  parseBlobListing,
  parseConcurrency,
  parseIndexKey,
  parseRecipients,
  planObjects,
  quoteLiteral,
  readPreviousIndex,
  recipientTag,
  storageFromDump,
  unaccountedObjects,
} from "./lib.mjs";
import { eachLimited, encodePath, storageClient } from "./storage-api.mjs";

const [work, out, environment, generation] = process.argv.slice(2);
if (!work || !out || !environment || !generation) {
  console.error("Usage: node scripts/backup/export-storage.mjs <work-dir> <out-dir> <environment> <YYYY-MM>");
  process.exit(2);
}

/** @type {{ bucket: string, path: string, error: string, detail?: string }[]} */
const errors = [];
/** @type {{ bucket: string, path: string, warning: string }[]} */
const warnings = [];
/** @type {{ bucket: string, path: string }[]} */
const deletedDuringBackup = [];
/** @type {import("./lib.mjs").ManifestObject[]} */
const objects = [];
/** @type {{ fp: string, sha256: string, size: number }[]} */
const indexFiles = [];
/** @type {Map<string, import("./lib.mjs").BlobRecord>} the blobs this backup needs */
const blobRecords = new Map();
/** @type {Record<string, unknown>[]} */
let buckets = [];
let skippedVersions = 0;
let bytesRead = 0;
let filesRead = 0;
let newBlobs = 0;
let renamedBlobs = 0;
let prefix = "";
let tag = "";
const started = Date.now();

/**
 * Removes a file name, as stored and as encoded in an address, from a
 * message, then cuts it short. Only then is it safe to print.
 * @param {string} message
 * @param {string} path
 */
const scrub = (message, path) =>
  [path, encodePath(path), encodeURIComponent(path)]
    .reduce((text, form) => text.split(form).join("<file>"), message)
    .slice(0, 300);

/** @param {string} file */
async function readOptional(file) {
  try {
    return await readFile(file, "utf8");
  } catch {
    return null;
  }
}

/**
 * Streams one object through sha256, MD5 and age into `file`.
 * @param {import("node:stream").Readable} source
 * @param {string} file
 * @param {string[]} recipients
 */
async function encryptTo(source, file, recipients) {
  const hash = createHash("sha256");
  const md5 = createHash("md5");
  let size = 0;
  const age = spawn(process.env.AGE_BIN || "age", [...recipients.flatMap((r) => ["-r", r]), "-o", file], {
    stdio: ["pipe", "ignore", "pipe"],
  });
  let stderr = "";
  age.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const exited = new Promise((resolve, reject) => {
    age.on("error", reject);
    age.on("close", (code) => (code === 0 ? resolve(undefined) : reject(new Error(`age exited ${code}: ${stderr.trim().slice(0, 200)}`))));
  });
  const measure = new Transform({
    transform(chunk, _encoding, done) {
      hash.update(chunk);
      md5.update(chunk);
      size += chunk.length;
      bytesRead += chunk.length;
      done(null, chunk);
    },
  });
  try {
    await Promise.all([pipeline(source, measure, age.stdin), exited]);
  } catch (error) {
    age.kill();
    throw error;
  }
  return { size, sha256: hash.digest("hex"), md5: md5.digest("hex") };
}

/** Size and sha256 of a file's bytes. @param {string} file */
async function hashFile(file) {
  const hash = createHash("sha256");
  let size = 0;
  for await (const chunk of createReadStream(file)) {
    hash.update(chunk);
    size += chunk.length;
  }
  return { size, sha256: hash.digest("hex") };
}

/**
 * For each (bucket, name) pair, the version its row has in the source
 * database now, or no entry when the row is gone. Names are sent to psql on
 * its input and read back as JSON, never printed; psql's own messages are
 * kept out of the error text, because they can quote a name.
 * @param {{ bucket: string, path: string }[]} pairs
 * @returns {Promise<Map<string, string | null>>}
 */
async function currentVersions(pairs) {
  const url = process.env.BACKUP_DB_URL;
  if (!url) throw new Error("BACKUP_DB_URL is not set, so the database cannot be asked whether these files changed or were deleted.");
  /** @type {Map<string, string | null>} */
  const found = new Map();
  for (let at = 0; at < pairs.length; at += 500) {
    const batch = pairs.slice(at, at + 500);
    const values = batch.map((p) => `(${quoteLiteral(p.bucket)}, ${quoteLiteral(p.path)})`).join(", ");
    const sql = `select coalesce(json_agg(json_build_array(bucket_id, name, version)), '[]') from storage.objects where (bucket_id, name) in (${values});`;
    const psql = spawn("psql", [url, "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1"], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    psql.stdout.on("data", (c) => (stdout += c));
    psql.stderr.on("data", () => {});
    const code = await new Promise((resolve) => {
      psql.on("error", () => resolve("not started"));
      psql.on("close", resolve);
      psql.stdin.on("error", () => {});
      psql.stdin.end(sql);
    });
    if (code !== 0) throw new Error(`the database could not be asked (psql ${code === "not started" ? "did not start" : `exited ${code}`})`);
    for (const [b, n, v] of JSON.parse(stdout.trim() || "[]")) found.set(`${b}/${n}`, v ?? null);
  }
  return found;
}

/** @param {string | null} eTag Storage's eTag, when it is a plain MD5 */
function md5OfETag(eTag) {
  const match = /^"?([0-9a-f]{32})"?$/.exec(eTag ?? "");
  return match ? match[1] : null;
}

async function run() {
  const url = process.env.SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (the project's address and service-role key).");
  const recipients = parseRecipients(process.env.BACKUP_AGE_RECIPIENT);
  tag = recipientTag(recipients);
  prefix = blobPrefix(environment, generation, tag);
  const indexKey = parseIndexKey(process.env.BACKUP_INDEX_KEY);
  const concurrency = parseConcurrency(process.env.BACKUP_STORAGE_CONCURRENCY);

  // 1. The files the database lists, from the dump.
  const counter = createRowCounter(["storage.buckets", "storage.objects"]);
  const lines = createInterface({ input: createReadStream(join(work, "db", "data.sql"), { encoding: "utf8" }), crlfDelay: Infinity });
  for await (const line of lines) counter.line(line);
  counter.counts();
  const listed = storageFromDump(counter.rows());
  buckets = listed.buckets;
  skippedVersions = listed.skipped;

  // 2. What this month's folder holds (after `bucket.sh state` copied last
  //    month's blobs in), and the newest trusted index.
  const state = process.env.BACKUP_STATE_DIR;
  const current = parseBlobListing((state && (await readOptional(join(state, "blobs-current.txt")))) || "", prefix);
  /** @type {Map<string, string>} sha256 → the name it was carried to tonight */
  const carried = new Map();
  for (const line of ((state && (await readOptional(join(state, "carried.txt")))) || "").split("\n")) {
    const [sha, name] = line.trim().split(/\s+/);
    if (sha && name) carried.set(sha, name);
  }
  const previousText = state ? await readOptional(join(state, "previous-index.json")) : null;
  let parsed = null;
  try {
    parsed = previousText ? JSON.parse(previousText) : null;
  } catch {
    parsed = { unreadable: true };
  }
  const previous = readPreviousIndex(parsed, environment, indexKey);
  // `bucket.sh state` only keeps an index that verifies, and warns about
  // the others; this is for a run without it.
  if (!state) console.log("No bucket state given (BACKUP_STATE_DIR); every file is downloaded.");
  else if (previous.reason === "none") console.log("No trusted previous index; every file is downloaded.");
  else if (previous.reason !== null) console.log(`The previous index cannot be used (${previous.reason}); every file is downloaded again.`);
  if (previous.usable && previous.blobPrefix === prefix) {
    const records = [...previous.blobs.values()];
    const gone = records.filter((r) => !current.has(blobFileName(r))).length;
    const resized = records.filter((r) => current.has(blobFileName(r)) && current.get(blobFileName(r)) !== r.encSize).length;
    if (gone > 0) {
      console.log(
        `::warning::${gone} blob(s) the previous backup stored in ${prefix} are no longer there; their files are downloaded again. Check the bucket's lifecycle rules and who can delete objects.`,
      );
    }
    if (resized > 0) {
      console.log(
        `::warning::${resized} blob(s) in ${prefix} no longer have the encrypted size recorded when they were stored (damaged copies); their files are downloaded again and stored under another name.`,
      );
    }
  }
  const known = knownBlobs(previous, prefix, current, carried);

  const plan = planObjects(listed.objects, previous.files, known);
  const blobs = join(out, "blobs");
  await mkdir(blobs, { recursive: true, mode: 0o700 });

  /**
   * @param {import("./lib.mjs").StoredObject} o
   * @param {string} sha256
   * @param {number} size
   * @param {string} fp
   * @param {import("./lib.mjs").BlobRecord} record
   */
  const keep = (o, sha256, size, fp, record) => {
    objects.push({ bucket: o.bucket, path: o.path, size, sha256, contentType: o.contentType, cacheControl: o.cacheControl ?? null, blob: `${prefix}${blobFileName(record)}` });
    indexFiles.push({ fp, sha256, size });
    blobRecords.set(sha256, mergeBlobRecord(blobRecords.get(sha256), record));
  };

  // 3. Unchanged files: nothing to download.
  for (const item of plan) {
    if (item.action !== "keep" || item.sha256 === null) continue;
    keep(item.object, item.sha256, /** @type {number} */ (item.size), item.fp, /** @type {import("./lib.mjs").BlobRecord} */ (known.get(item.sha256)));
  }

  // 4. New or changed files: download, hash and encrypt, then decide. A
  //    name that cannot be restored as it is is reported, not copied.
  const storage = storageClient(url, key);
  /** @type {{ bucket: string, path: string }[]} */
  const notFound = [];
  /** @type {{ o: import("./lib.mjs").StoredObject, got: { size: number, md5: string } }[]} */
  const suspect = [];
  const toDownload = [];
  for (const item of plan) {
    if (item.action !== "download") continue;
    const problem = objectNameProblem(item.object.bucket, item.object.path);
    if (problem) errors.push({ bucket: item.object.bucket, path: item.object.path, error: `not copied: ${problem}` });
    else toDownload.push(item);
  }
  if (previous.usable && previous.tag !== tag && toDownload.length > 0) {
    console.log(
      `::warning::The custodians' keys (BACKUP_AGE_RECIPIENT) changed since the previous backup: tonight ${toDownload.length} file(s) are downloaded again and encrypted to the new keys, once (Supabase traffic about the size of those files).`,
    );
  }
  const store = createBlobStore({
    listing: current,
    known,
    // The first file of a content: its encrypted copy becomes the blob.
    seal: async (tmp, name) => {
      const encrypted = await hashFile(tmp);
      await rename(tmp, join(blobs, name));
      return encrypted;
    },
    discard: (tmp) => rm(tmp, { force: true }),
  });
  await eachLimited(toDownload, concurrency, async (item) => {
    const o = item.object;
    const tmp = join(blobs, `.${randomUUID()}.tmp`);
    for (let attempt = 1; ; attempt += 1) {
      try {
        const source = await storage.open(o.bucket, o.path);
        if (!source) {
          notFound.push({ bucket: o.bucket, path: o.path });
          return;
        }
        const got = await encryptTo(source, tmp, recipients);
        filesRead += 1;
        const wantMd5 = md5OfETag(o.eTag);
        if ((o.size !== null && got.size !== o.size) || (wantMd5 !== null && got.md5 !== wantMd5)) suspect.push({ o, got });
        const { record, stored } = await store.store(got.sha256, tmp);
        if (stored) newBlobs += 1;
        keep(o, got.sha256, got.size, item.fp, record);
        return;
      } catch (error) {
        await rm(tmp, { force: true });
        if (attempt < 2) continue;
        errors.push({ bucket: o.bucket, path: o.path, error: scrub(/** @type {Error} */ (error).message, o.path) });
        return;
      }
    }
  });

  // 5. Files Storage no longer has, or whose bytes do not match the size or
  //    MD5 the database lists: deleted or replaced while the backup ran, or
  //    lost or damaged at the source? The database's row says which.
  const toAsk = [...notFound, ...suspect.map((s) => ({ bucket: s.o.bucket, path: s.o.path }))];
  if (toAsk.length > 0) {
    /** @type {Map<string, string | null> | null} */
    let rows = null;
    let reason = "";
    try {
      rows = await currentVersions(toAsk);
    } catch (error) {
      reason = /** @type {Error} */ (error).message;
    }
    for (const o of notFound) {
      if (rows === null) errors.push({ ...o, error: `Storage has no bytes for it, and ${reason}` });
      else if (rows.has(`${o.bucket}/${o.path}`)) errors.push({ ...o, error: "Storage has no bytes for a file the database still lists" });
      else deletedDuringBackup.push(o);
    }
    for (const { o, got } of suspect) {
      const at = { bucket: o.bucket, path: o.path };
      const detail = `the database lists ${o.size ?? "?"} bytes${md5OfETag(o.eTag) ? " and an MD5" : ""}; Storage sent ${got.size} bytes${md5OfETag(o.eTag) && got.md5 !== md5OfETag(o.eTag) ? " with another MD5" : ""}`;
      const key = `${o.bucket}/${o.path}`;
      if (rows === null) errors.push({ ...at, error: `Storage sent bytes that do not match the database's record, and ${reason}`, detail });
      else if (rows.has(key) && rows.get(key) === o.version) {
        errors.push({ ...at, error: "Storage sent bytes that do not match the database's size or MD5 for this version (damaged at the source, or cut short)", detail });
      } else warnings.push({ ...at, warning: `${detail} (changed while the backup ran)` });
    }
  }

  // 6. Every file the database lists must be in the backup, or recorded as
  //    a problem or as deleted while it ran.
  const unaccounted = unaccountedObjects(listed.objects, [objects, errors, deletedDuringBackup]);
  if (unaccounted > 0) errors.push({ bucket: "*", path: "*", error: `${unaccounted} file(s) the database lists were neither copied nor recorded (a fault in the export)` });

  const perBucket = new Map();
  for (const item of plan) {
    const entry = perBucket.get(item.object.bucket) ?? { files: 0, downloaded: 0 };
    entry.files += 1;
    if (item.action === "download") entry.downloaded += 1;
    perBucket.set(item.object.bucket, entry);
  }
  for (const [id, entry] of perBucket) {
    console.log(`${id}: ${entry.files} files, ${entry.downloaded} new or changed.`);
  }
  renamedBlobs = store.renamed();
}

let crashed = null;
try {
  await run();
} catch (error) {
  crashed = /** @type {Error} */ (error).message;
  errors.push({ bucket: "*", path: "*", error: `The file export stopped: ${crashed}` });
}

try {
  await mkdir(join(work, "storage"), { recursive: true, mode: 0o700 });
  const blobList = [...blobRecords.values()];
  await writeFile(
    join(work, "storage", "index.json"),
    `${JSON.stringify(
      {
        buckets,
        objects,
        blobPrefix: prefix || null,
        recipients: tag || null,
        blobs: blobList,
        errors,
        warnings,
        deletedDuringBackup,
        skippedVersions,
        read: { storageBytes: bytesRead, storageFiles: filesRead },
      },
      null,
      2,
    )}\n`,
    { mode: 0o600 },
  );
  await mkdir(out, { recursive: true, mode: 0o700 });
  await writeFile(join(out, "index-files.json"), `${JSON.stringify({ recipients: tag || null, files: indexFiles, blobs: blobList })}\n`, { mode: 0o600 });
} catch (error) {
  console.error(`Could not write the export's results: ${/** @type {Error} */ (error).message}`);
  process.exit(1);
}

const total = objects.reduce((sum, o) => sum + o.size, 0);
const seconds = ((Date.now() - started) / 1000).toFixed(1);
console.log(
  `Storage: ${objects.length} files (${formatBytes(total)}) in this backup. ` +
    `Read from Supabase: ${filesRead} files, ${formatBytes(bytesRead)} (${bytesRead} bytes); ` +
    `${objects.length - filesRead} unchanged since the last backup, not downloaded. ` +
    `Blobs: ${newBlobs} new. ${seconds}s.`,
);
if (renamedBlobs > 0) {
  // Counts only: the log is public, and names and hashes stay out of it.
  console.log(
    `::warning::${renamedBlobs} new blob(s) stored under another name (<sha256>.<n>.age), because their usual name in ${prefix} holds an object no signed index vouches for (left by a run that failed, or put there by someone holding the bucket key). Nothing is lost; see the runbook, "Objects the backup did not make".`,
  );
}
if (deletedDuringBackup.length > 0) console.log(`${deletedDuringBackup.length} file(s) were deleted while the backup ran (recorded, not an error).`);
if (warnings.length > 0) console.log(`::warning::${warnings.length} file(s) changed while the backup ran; the manifest's storage.warnings names them.`);
if (errors.length > 0) {
  // Only the general reason is printed; the manifest, inside the encrypted
  // archive, names the files and keeps the details.
  for (const e of errors) console.error(`Could not copy a file${e.bucket === "*" ? "" : ` in ${e.bucket}`}: ${e.error}`);
  console.error(`${errors.length} problem(s) with uploaded files; the manifest's storage.errors names them.`);
  process.exit(3);
}
