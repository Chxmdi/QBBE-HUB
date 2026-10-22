#!/usr/bin/env node
// Puts a backup's uploaded files back into a scratch Supabase project, then
// downloads every one of them again and checks it against the manifest
// (DATA-001; run by scripts/backup/restore-drill.sh).
//
//   TARGET_SUPABASE_URL=https://<scratch ref>.supabase.co TARGET_SERVICE_ROLE_KEY=… \
//   PROTECT_SUPABASE_URL=https://<production ref>.supabase.co \
//     node scripts/backup/restore-storage.mjs <unpacked-backup-dir> [--bucket <id>[=<into id>]]…
//
// Runs after the database restore, which has already put back the buckets
// and the rows that list each file (storage.buckets, storage.objects), but
// not the bytes, and after `manifest.mjs unpack-blobs` has decrypted the
// files into the unpacked backup. Each file is uploaded with "upsert", as
// Supabase's own migration guide does, so Storage fills in the bytes for the
// row that is already there.
//
// Storage applies a bucket's current size limit and allowed file types to
// every upload, and the backed-up settings can be stricter than the files
// they hold (a limit lowered after larger files were stored). So each
// bucket's limit and type list are lifted for the upload and put back
// afterwards: the backup's own settings for a bucket restored under its own
// id (so a run interrupted earlier, which left them lifted, is repaired),
// and the target's settings for a different bucket named with --bucket a=b.
// They are put back whatever happens: also when the upload or a later lift
// fails, and on Ctrl-C (SIGINT) or SIGTERM. A bucket missing from the
// target is created, and given the backed-up settings at the end. Every
// bucket's settings are then read again to check they took. The project's
// own upload limit (Storage settings in the dashboard) must still be at
// least the largest file; the manifest summary shows it. A file over 2 GiB
// cannot be sent by this script and is reported (upload it by hand).
//
// ALLOW_MISSING_FILES=1 (the partial restore; restore-drill.sh) skips the
// files the backup could not give back, listed in <unpacked>/lost-files.json,
// and checks the rest.
//
// --bucket restores only the buckets named, optionally into another bucket
// (documents=documents-recovered), for example to get back a few lost files
// without touching what is there.
//
// The drill script refuses production before this runs; this script refuses
// it again on its own (lib.mjs checkFilesTarget). File names are never
// printed: only counts.
//
// Exit status 0 only when every file in the manifest came back with the
// same size and sha256.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { checkFilesTarget, compareObjects, formatBytes, objectFilePath, parseConcurrency } from "./lib.mjs";
import { eachLimited, storageClient } from "./storage-api.mjs";

const args = process.argv.slice(2);
const work = args[0];
if (!work || work.startsWith("--")) {
  console.error("Usage: node scripts/backup/restore-storage.mjs <unpacked-backup-dir> [--bucket <id>[=<into id>]]…");
  process.exit(2);
}
/** @type {Map<string, string>} backed-up bucket → target bucket */
const only = new Map();
for (let i = 1; i < args.length; i += 1) {
  if (args[i] !== "--bucket" || !args[i + 1]) {
    console.error(`Unknown argument: ${args[i]}`);
    process.exit(2);
  }
  const [from, into] = args[i + 1].split("=");
  only.set(from, into || from);
  i += 1;
}

const decision = checkFilesTarget(process.env);
if (!decision.ok) {
  console.error(`Refusing: ${decision.reason}`);
  process.exit(1);
}

const manifest = JSON.parse(await readFile(join(work, "manifest.json"), "utf8"));
const allowMissing = process.env.ALLOW_MISSING_FILES === "1";
/** @type {Set<string>} */
const lost = new Set(allowMissing ? JSON.parse(await readFile(join(work, "lost-files.json"), "utf8").catch(() => "[]")) : []);
/** @param {string} id */
const targetOf = (id) => (only.size === 0 ? id : only.get(id));
/** @typedef {{ id: string, public: boolean, file_size_limit: number | null, allowed_mime_types: string[] | null }} BucketSettings */
/** @type {BucketSettings[]} */
const buckets = manifest.storage.buckets.filter((/** @type {{ id: string }} */ b) => targetOf(b.id));
for (const id of only.keys()) {
  if (!buckets.some((b) => b.id === id)) {
    console.error(`The backup has no bucket ${id}.`);
    process.exit(2);
  }
}
/** @type {import("./lib.mjs").ManifestObject[]} */
const objects = manifest.storage.objects.filter(
  (/** @type {{ bucket: string, path: string }} */ o) => targetOf(o.bucket) && !lost.has(`${o.bucket}/${o.path}`),
);
const skipped = manifest.storage.objects.filter((/** @type {{ bucket: string }} */ o) => targetOf(o.bucket)).length - objects.length;
/** @param {string} message */
const stop = (message) => {
  console.error(`FAIL  ${message}`);
  process.exit(1);
};
let storage;
let concurrency;
try {
  storage = storageClient(/** @type {string} */ (process.env.TARGET_SUPABASE_URL), process.env.TARGET_SERVICE_ROLE_KEY ?? "");
  concurrency = parseConcurrency(process.env.BACKUP_STORAGE_CONCURRENCY);
} catch (error) {
  stop(/** @type {Error} */ (error).message);
}
const client = /** @type {ReturnType<typeof storageClient>} */ (storage);
const started = Date.now();

/** @type {string[]} */
const failures = [];
/** @type {BucketSettings[]} what to put back, recorded before each bucket is lifted */
const putBack = [];
/** @type {Promise<void> | null} */
let puttingBack = null;
/** Puts every lifted bucket's settings back, once, and checks they took. */
function restoreSettings() {
  puttingBack ??= (async () => {
    for (const bucket of putBack) {
      try {
        await client.updateBucket(bucket);
        const now = await client.getBucket(bucket.id);
        const same =
          now !== null &&
          Boolean(now.public) === Boolean(bucket.public) &&
          (now.file_size_limit ?? null) === (bucket.file_size_limit ?? null) &&
          JSON.stringify(now.allowed_mime_types ?? null) === JSON.stringify(bucket.allowed_mime_types ?? null);
        if (!same) failures.push(`settings of ${bucket.id} not put back: Storage reports other settings`);
      } catch (error) {
        failures.push(`settings of ${bucket.id} not put back: ${/** @type {Error} */ (error).message}`);
      }
    }
  })();
  return puttingBack;
}
for (const signal of /** @type {const} */ (["SIGINT", "SIGTERM"])) {
  process.once(signal, async () => {
    console.error(`${signal}: putting the bucket settings back before stopping…`);
    await restoreSettings();
    for (const f of failures.filter((x) => x.startsWith("settings"))) console.error(`      failed: ${f}`);
    process.exit(signal === "SIGINT" ? 130 : 143);
  });
}

try {
  // 1. Lift each target bucket's size limit and type list, recording first
  //    what to put back: the backup's settings for its own bucket, the
  //    target's for a different bucket that already exists.
  for (const bucket of buckets) {
    const id = /** @type {string} */ (targetOf(bucket.id));
    const existing = await client.getBucket(id);
    const backedUp = { id, public: bucket.public, file_size_limit: bucket.file_size_limit ?? null, allowed_mime_types: bucket.allowed_mime_types ?? null };
    if (existing) {
      putBack.push(
        id === bucket.id
          ? backedUp
          : { id, public: existing.public, file_size_limit: existing.file_size_limit ?? null, allowed_mime_types: existing.allowed_mime_types ?? null },
      );
      await client.updateBucket({ id, public: existing.public, file_size_limit: null, allowed_mime_types: null });
    } else {
      putBack.push(backedUp);
      await client.createBucket({ id, public: bucket.public, file_size_limit: null, allowed_mime_types: null });
      console.log(`Created bucket ${id}.`);
    }
  }
  console.log(`Lifted the size limit and file types of ${putBack.length} bucket(s) for the upload; the largest file is ${formatBytes(manifest.storage.largestBytes ?? 0)}.`);

  // 2. Upload.
  await eachLimited(objects, concurrency, async (o) => {
    try {
      await client.upload(
        /** @type {string} */ (targetOf(o.bucket)),
        o.path,
        join(work, objectFilePath(o.bucket, o.path)),
        o.contentType,
        o.cacheControl ?? null,
      );
    } catch (error) {
      failures.push(`${o.bucket}: ${/** @type {Error} */ (error).message.split(o.path).join("<file>").slice(0, 300)}`);
    }
  });
} catch (error) {
  failures.push(`bucket set-up: ${/** @type {Error} */ (error).message}`);
} finally {
  // 3. The settings back, whatever happened.
  await restoreSettings();
}
const uploadSeconds = ((Date.now() - started) / 1000).toFixed(1);
const settingsFailed = failures.some((f) => f.startsWith("settings"));
const setUpFailed = failures.some((f) => f.startsWith("bucket set-up"));
console.log(
  `${setUpFailed ? "Nothing uploaded: the bucket set-up failed" : `Uploaded ${objects.length - failures.filter((f) => !f.startsWith("settings")).length} of ${objects.length} files in ${uploadSeconds}s`}; ` +
    `${settingsFailed ? "bucket settings NOT all put back (see below)" : "bucket settings put back and checked"}.`,
);
if (skipped > 0) console.log(`Skipped ${skipped} file(s) the backup could not give back (ALLOW_MISSING_FILES=1).`);
for (const f of failures) console.log(`      failed: ${f}`);
if (setUpFailed) process.exit(1);

// 4. The check: download every file again by its exact name.
/** @type {{ bucket: string, path: string, size: number, sha256: string }[]} */
const actual = [];
await eachLimited(objects, concurrency, async (o) => {
  try {
    const got = await client.hash(/** @type {string} */ (targetOf(o.bucket)), o.path);
    if (got) actual.push({ bucket: o.bucket, path: o.path, ...got });
  } catch {
    // counted as missing
  }
});
const result = compareObjects(objects, actual);
const bytes = actual.reduce((sum, o) => sum + o.size, 0);
console.log(
  `${result.ok ? "ok  " : "FAIL"}  restored files: ${result.checked} downloaded again and compared (${formatBytes(bytes)}), ` +
    `${result.missing.length} missing, ${result.changed.length} different`,
);
const seconds = ((Date.now() - started) / 1000).toFixed(1);
console.log(`Storage restore and check took ${seconds}s.`);
process.exit(result.ok && failures.length === 0 ? 0 : 1);
