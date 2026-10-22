#!/usr/bin/env node
// Builds and checks the manifest at the top of every backup archive, and the
// unencrypted index stored next to it (DATA-001; the rules live in
// scripts/backup/lib.mjs).
//
//   node scripts/backup/manifest.mjs build <work-dir> <environment> <YYYY-MM>
//       after the dumps and the file export: records each SQL file's size
//       and sha256, the rows per table in data.sql, the policies, triggers,
//       queues and schedules in platform.sql, and every stored file with its
//       blob. With <work-dir>/source-tables.txt (TABLES_WITH_ROWS_QUERY run
//       on the source), exits 3 when a table that has rows is missing from
//       the dump: the manifest is written, the run must fail.
//   BACKUP_INDEX_KEY=… node scripts/backup/manifest.mjs index <work-dir> <out-dir> <archive>
//       the index stored next to the archive, signed: which blobs it needs
//       (with each one's encrypted size and sha256), and the fingerprints
//       the next night compares with. Names no file.
//   node scripts/backup/manifest.mjs check-files <work-dir> [--db-only] [--remove-bad]
//       every SQL file, and (unless --db-only) every stored file, against
//       the manifest: same size, same sha256, nothing missing, nothing extra;
//       and each file against the size and MD5 its row in data.sql records.
//       --remove-bad deletes the unpacked files that fail and writes their
//       names, with the missing ones, to <work-dir>/lost-files.json (the
//       partial restore, ALLOW_MISSING_FILES=1).
//   node scripts/backup/manifest.mjs unpack-blobs <work-dir> <blob-dir>
//       decrypts each file's blob (AGE_IDENTITY_FILE) into
//       <work-dir>/storage/objects/<bucket>/<path>, for check-files and the
//       file restore.
//   node scripts/backup/manifest.mjs count-sql <work-dir>
//       the query that counts the same tables in a restored database.
//   node scripts/backup/manifest.mjs compare-rows <work-dir> <counts-file> [--skip-schema a,b]
//   node scripts/backup/manifest.mjs compare-platform <work-dir> <counts-file> [--skip name,…]
//       a restored database's counts (psql -At output of the two queries)
//       against the manifest.
//   node scripts/backup/manifest.mjs compare-file-rows <work-dir> <rows.json> [--lost <lost-files.json>]
//       the restored storage.objects rows against the manifest's files.
//   node scripts/backup/manifest.mjs compare-buckets <work-dir> <buckets.json>
//       the restored buckets' public flag, size limit and file types against
//       the backup's.
//   node scripts/backup/manifest.mjs guard
//       the restore drill's refusal to touch production (lib.mjs
//       checkRestoreTarget): exits 1 with the reason.
//   node scripts/backup/manifest.mjs info <work-dir>
//       the backup's environment and time, one per line.
//   node scripts/backup/manifest.mjs summary <work-dir>
//       a short Markdown summary for the workflow run: counts only, no
//       file names (they can carry people's names), and no count of
//       sign-in accounts or MFA factors (the summary of a public
//       repository's run is public).
//   node scripts/backup/manifest.mjs traffic <work-dir>
//       what this run read from Supabase and the month at that rate, with a
//       ::warning:: above 2 GB a month for this environment.
//
// Row counts come from data.sql itself, not from the live database, so they
// are exactly what a restore inserts even when people kept working while the
// dump ran.

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, sep } from "node:path";
import { createInterface } from "node:readline";
import {
  CATALOG_READ_BYTES,
  DB_FILES,
  MANIFEST_FORMAT,
  TRAFFIC_WARN_BYTES,
  buildIndex,
  buildManifest,
  checkRestoreTarget,
  compareBuckets,
  compareCounts,
  compareObjects,
  countQuery,
  createRowCounter,
  formatBytes,
  objectFilePath,
  parseCounts,
  parseIndexKey,
  platformCounts,
  rowsWithoutFiles,
  storageFromDump,
  tablesMissingFromDump,
  trafficEstimate,
} from "./lib.mjs";

const [command, ...args] = process.argv.slice(2);

/** @param {string} file */
async function hashFile(file) {
  const hash = createHash("sha256");
  const md5 = createHash("md5");
  let size = 0;
  for await (const chunk of createReadStream(file)) {
    hash.update(chunk);
    md5.update(chunk);
    size += chunk.length;
  }
  return { size, sha256: hash.digest("hex"), md5: md5.digest("hex") };
}

/**
 * Where an object is unpacked, or null when its name cannot be a file
 * (counted as a failure by the caller, never thrown past it).
 * @param {string} work
 * @param {{ bucket: string, path: string }} o
 */
function unpackedPath(work, o) {
  try {
    return join(work, objectFilePath(o.bucket, o.path));
  } catch {
    return null;
  }
}

/** @param {string} file */
async function rowsInDump(file) {
  const counter = createRowCounter();
  const lines = createInterface({ input: createReadStream(file, { encoding: "utf8" }), crlfDelay: Infinity });
  for await (const line of lines) counter.line(line);
  return counter.counts();
}

/** @param {string} file */
async function readOptional(file) {
  try {
    return await readFile(file, "utf8");
  } catch {
    return null;
  }
}

/** @param {string} work */
async function readManifest(work) {
  const manifest = JSON.parse(await readFile(join(work, "manifest.json"), "utf8"));
  if (manifest.format !== MANIFEST_FORMAT) throw new Error(`Unknown manifest format: ${manifest.format} (expected ${MANIFEST_FORMAT}).`);
  return manifest;
}

/** @param {string} dir @returns {Promise<string[]>} every file below dir */
async function listFiles(dir) {
  /** @type {string[]} */
  const out = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await listFiles(full)));
    else out.push(full);
  }
  return out;
}

/** @param {string} name */
function option(name) {
  const at = args.indexOf(name);
  return at >= 0 ? (args[at + 1] ?? "").split(",").filter(Boolean) : [];
}

function usage() {
  console.error(
    "Usage: node scripts/backup/manifest.mjs <build|index|check-files|unpack-blobs|count-sql|compare-rows|compare-platform|compare-file-rows|compare-buckets|guard|info|summary|traffic> …",
  );
  process.exit(2);
}

async function build() {
  const [work, environment, generation] = args;
  if (!work || !environment || !generation) usage();
  /** @type {Record<string, { size: number, sha256: string }>} */
  const files = {};
  for (const name of DB_FILES) files[name] = await hashFile(join(work, "db", name));
  const rows = await rowsInDump(join(work, "db", "data.sql"));
  const history = await rowsInDump(join(work, "db", "history_data.sql"));
  const platform = platformCounts(await readFile(join(work, "db", "platform.sql"), "utf8"));
  const index = JSON.parse(await readFile(join(work, "storage", "index.json"), "utf8"));
  const sourceTables = await readOptional(join(work, "source-tables.txt"));
  const tables = sourceTables === null ? { missing: [], unreadable: [] } : tablesMissingFromDump(sourceTables, [...Object.keys(rows), ...Object.keys(history)]);
  const databaseBytes = DB_FILES.filter((name) => name !== "platform.sql").reduce((sum, name) => sum + files[name].size, 0);
  // A dump redone because a migration landed meanwhile read its first
  // attempt too (create-backup.sh writes that attempt's size here).
  const extraDatabaseBytes = Number((await readOptional(join(work, "redo-bytes.txt")))?.trim() || 0);
  const manifest = buildManifest({
    environment,
    createdAt: new Date().toISOString(),
    source: process.env.SUPABASE_URL ? { supabaseUrl: process.env.SUPABASE_URL.replace(/\/+$/, "") } : {},
    files,
    // The migration history's rows are counted too, so a restore that
    // misses them fails step 6.
    rows: { ...rows, ...history },
    platform,
    missingTables: tables.missing,
    unreadableTables: tables.unreadable,
    generation,
    blobPrefix: index.blobPrefix ?? undefined,
    buckets: index.buckets,
    objects: index.objects,
    blobs: index.blobs ?? [],
    errors: index.errors,
    warnings: index.warnings,
    deletedDuringBackup: index.deletedDuringBackup,
    skippedVersions: index.skippedVersions,
    read: {
      databaseBytes,
      extraDatabaseBytes,
      catalogBytesEstimate: CATALOG_READ_BYTES,
      storageBytes: index.read?.storageBytes ?? 0,
      storageFiles: index.read?.storageFiles ?? 0,
    },
  });
  await writeFile(join(work, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  await rm(join(work, "storage"), { recursive: true, force: true });
  await rm(join(work, "source-tables.txt"), { force: true });
  console.log(
    `Manifest: ${manifest.database.tables} tables, ${manifest.database.totalRows} rows; ` +
      `${manifest.storage.objectCount} files, ${formatBytes(manifest.storage.totalBytes)} (largest ${formatBytes(manifest.storage.largestBytes)}); ` +
      `${platform.policies} policies, ${platform.triggers} triggers, ${platform.queues} queues, ${platform.cronJobs} scheduled jobs.`,
  );
  if (sourceTables === null) console.log("Note: no source-tables.txt, so the dump was not compared with the tables that have rows.");
  if (tables.unreadable.length > 0) {
    console.log(`Note: ${tables.unreadable.length} table(s) the backup role cannot read, so not in the dump: ${tables.unreadable.join(", ")}`);
  }
  if (tables.missing.length > 0) {
    // Table names are the app's schema, not people's data: safe to print.
    console.log(`::error::${tables.missing.length} table(s) hold rows but are not in the dump: ${tables.missing.join(", ")}`);
    process.exit(3);
  }
}

async function index() {
  const [work, out, archive] = args;
  if (!work || !out || !archive) usage();
  const key = parseIndexKey(process.env.BACKUP_INDEX_KEY);
  const manifest = await readManifest(work);
  const exported = JSON.parse(await readFile(join(out, "index-files.json"), "utf8"));
  if (!exported.recipients) throw new Error("index-files.json names no recipient tag (the file export did not start); no index is written.");
  const { size, sha256 } = await hashFile(archive);
  const value = buildIndex(
    {
      environment: manifest.environment,
      generation: manifest.storage.generation,
      recipients: exported.recipients,
      createdAt: manifest.createdAt,
      archive: basename(archive),
      archiveSize: size,
      archiveSha256: sha256,
      files: exported.files,
      blobs: exported.blobs,
    },
    key,
  );
  const name = basename(archive).replace(/\.tar\.gz\.age$/, ".index.json");
  await writeFile(join(dirname(archive), name), `${JSON.stringify(value)}\n`, { mode: 0o600 });
  console.log(join(dirname(archive), name));
}

async function checkFiles() {
  const [work] = args;
  if (!work) usage();
  const dbOnly = args.includes("--db-only");
  const removeBad = args.includes("--remove-bad");
  const manifest = await readManifest(work);
  let failed = false;
  for (const [name, want] of Object.entries(manifest.database.files)) {
    let got;
    try {
      got = await hashFile(join(work, "db", name));
    } catch {
      console.log(`FAIL  db/${name} is missing`);
      failed = true;
      continue;
    }
    const same = got.size === want.size && got.sha256 === want.sha256;
    console.log(`${same ? "ok  " : "FAIL"}  db/${name} (${formatBytes(got.size)})`);
    failed ||= !same;
  }
  if (dbOnly) process.exit(failed ? 1 : 0);
  const root = join(work, "storage", "objects");
  /** @type {import("./lib.mjs").ManifestObject[]} */
  const objects = manifest.storage.objects;
  /** @type {{ bucket: string, path: string, size: number, sha256: string }[]} */
  const actual = [];
  /** @type {Map<string, string>} unpacked file → its object's key */
  const fileOf = new Map();
  /** @type {Map<string, import("./lib.mjs").ManifestObject>} */
  const expectedFiles = new Map();
  /** @type {string[]} */
  const unwritable = [];
  for (const o of objects) {
    const file = unpackedPath(work, o);
    if (file === null) unwritable.push(`${o.bucket}/${o.path}`);
    else expectedFiles.set(relative(work, file).split(sep).join("/"), o);
  }
  // What the database itself recorded for each file (data.sql, whose sha256
  // was checked above): its size, and its MD5 when Storage's eTag is one.
  // This does not depend on the manifest or the bucket's index.
  const counter = createRowCounter(["storage.buckets", "storage.objects"]);
  const lines = createInterface({ input: createReadStream(join(work, "db", "data.sql"), { encoding: "utf8" }), crlfDelay: Infinity });
  for await (const line of lines) counter.line(line);
  const rows = new Map(storageFromDump(counter.rows()).objects.map((o) => [`${o.bucket}/${o.path}`, o]));
  const changedAtSource = new Set(manifest.storage.warnings.map((/** @type {{ bucket: string, path: string }} */ w) => `${w.bucket}/${w.path}`));
  /** @type {string[]} */
  const differsFromDatabase = [];
  /** @type {string[]} unpacked files that fail, to remove with --remove-bad */
  const badFiles = [];
  for (const file of await listFiles(root)) {
    const rel = relative(work, file).split(sep).join("/");
    const known = expectedFiles.get(rel);
    if (known) {
      const got = await hashFile(file);
      const key = `${known.bucket}/${known.path}`;
      actual.push({ bucket: known.bucket, path: known.path, size: got.size, sha256: got.sha256 });
      fileOf.set(file, key);
      if (got.size !== known.size || got.sha256 !== known.sha256) badFiles.push(file);
      const row = rows.get(key);
      const md5 = /^"?([0-9a-f]{32})"?$/.exec(row?.eTag ?? "")?.[1];
      if (row && !changedAtSource.has(key) && ((row.size !== null && row.size !== got.size) || (md5 !== undefined && md5 !== got.md5))) {
        differsFromDatabase.push(key);
        if (!badFiles.includes(file)) badFiles.push(file);
      }
    } else {
      const [bucket, ...rest] = relative(root, file).split(sep);
      actual.push({ bucket, path: rest.join("/"), size: -1, sha256: "" });
      badFiles.push(file);
    }
  }
  const result = compareObjects(
    objects.filter((o) => !unwritable.includes(`${o.bucket}/${o.path}`)),
    actual,
  );
  const ok = result.ok && differsFromDatabase.length === 0 && unwritable.length === 0;
  console.log(
    `${ok ? "ok  " : "FAIL"}  files: ${result.checked} checked against their sha256 and the database's size and MD5, ` +
      `${result.missing.length} missing, ${result.changed.length} changed, ${differsFromDatabase.length} not what the database recorded, ` +
      `${result.extra.length} not in the manifest${unwritable.length > 0 ? `, ${unwritable.length} with a name a disk cannot hold` : ""}`,
  );
  // Names only on the custodian's own screen (this command runs in the
  // restore drill, never in the nightly job, which uses --db-only).
  for (const key of result.missing) console.log(`      missing: ${key}`);
  for (const c of result.changed) console.log(`      changed: ${c.key} (manifest ${c.expected}; now ${c.actual})`);
  for (const key of differsFromDatabase) console.log(`      not as the database recorded (size or MD5): ${key}`);
  for (const key of result.extra) console.log(`      extra:   ${key}`);
  for (const key of unwritable) console.log(`      name cannot be a file: ${key}`);
  if (manifest.storage.errors.length > 0) {
    console.log(`note  ${manifest.storage.errors.length} file problem(s) when this backup was made (manifest storage.errors).`);
  }
  if (removeBad) {
    const lost = new Set([...result.missing, ...unwritable, ...differsFromDatabase, ...result.changed.map((c) => c.key)]);
    for (const file of badFiles) await rm(file, { force: true });
    for (const file of badFiles) {
      const key = fileOf.get(file);
      if (key) lost.add(key);
    }
    await writeFile(join(work, "lost-files.json"), `${JSON.stringify([...lost].sort())}\n`, { mode: 0o600 });
    console.log(`Removed ${badFiles.length} unpacked file(s) that failed; ${lost.size} file(s) of the backup cannot be restored.`);
  }
  process.exit(failed || !ok ? 1 : 0);
}

/**
 * @param {string} identity
 * @param {string} from
 * @param {string} to
 */
function decrypt(identity, from, to) {
  return new Promise((resolve, reject) => {
    const age = spawn(process.env.AGE_BIN || "age", ["-d", "-i", identity, "-o", to, from], { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    age.stderr.on("data", (c) => (stderr += c));
    age.on("error", reject);
    age.on("close", (code) => (code === 0 ? resolve(undefined) : reject(new Error(stderr.trim().slice(0, 200) || `age exited ${code}`))));
  });
}

async function unpackBlobs() {
  const [work, blobDir] = args;
  if (!work || !blobDir) usage();
  const identity = process.env.AGE_IDENTITY_FILE;
  if (!identity) throw new Error("AGE_IDENTITY_FILE is not set.");
  const manifest = await readManifest(work);
  /** @type {Map<string, import("./lib.mjs").ManifestObject[]>} */
  const bySha = new Map();
  for (const o of manifest.storage.objects) bySha.set(o.sha256, [...(bySha.get(o.sha256) ?? []), o]);
  let missing = 0;
  let failed = 0;
  let unwritable = 0;
  let written = 0;
  for (const [sha256, list] of bySha) {
    const blob = join(blobDir, `${sha256}.age`);
    try {
      await stat(blob);
    } catch {
      missing += 1;
      continue;
    }
    // A name a disk cannot hold is counted and skipped, so one odd name
    // never stops the other files.
    const targets = list.map((o) => unpackedPath(work, o));
    unwritable += targets.filter((t) => t === null).length;
    const files = /** @type {string[]} */ (targets.filter((t) => t !== null));
    if (files.length === 0) continue;
    await mkdir(dirname(files[0]), { recursive: true, mode: 0o700 });
    try {
      await decrypt(identity, blob, files[0]);
    } catch {
      failed += 1;
      continue;
    }
    written += 1;
    for (const file of files.slice(1)) {
      await mkdir(dirname(file), { recursive: true, mode: 0o700 });
      await copyFile(files[0], file);
      written += 1;
    }
  }
  console.log(
    `Files: ${written} of ${manifest.storage.objects.length} unpacked from ${bySha.size} blob(s); ` +
      `${missing} blob(s) missing from ${blobDir}, ${failed} could not be decrypted` +
      `${unwritable > 0 ? `, ${unwritable} file(s) with a name a disk cannot hold` : ""}.`,
  );
  process.exit(missing === 0 && failed === 0 && unwritable === 0 ? 0 : 1);
}

async function countSql() {
  const [work] = args;
  if (!work) usage();
  const manifest = await readManifest(work);
  process.stdout.write(`${countQuery(Object.keys(manifest.database.rows))}\n`);
}

/**
 * @param {Record<string, number>} expected
 * @param {Record<string, number>} actual
 * @param {string[]} skip
 * @param {string} label
 */
function report(expected, actual, skip, label) {
  const result = compareCounts(expected, actual, { skip });
  console.log(`${result.ok ? "ok  " : "FAIL"}  ${label}: ${result.checked} compared, ${result.mismatches.length} different`);
  for (const m of result.mismatches) {
    console.log(`      ${m.name}: in the backup ${m.expected}, restored ${m.actual ?? "missing"}`);
  }
  if (skip.length > 0) console.log(`skip  ${label}: not compared here: ${skip.join(", ")}`);
  return result.ok;
}

async function compareRows() {
  const [work, countsFile] = args;
  if (!work || !countsFile) usage();
  const manifest = await readManifest(work);
  const actual = parseCounts(await readFile(countsFile, "utf8"));
  const skipSchemas = option("--skip-schema");
  const skip = Object.keys(manifest.database.rows).filter((name) => skipSchemas.includes(name.split(".")[0]));
  const ok = report(manifest.database.rows, actual, skip, "rows per table, restored against data.sql");
  process.exit(ok ? 0 : 1);
}

async function comparePlatform() {
  const [work, countsFile] = args;
  if (!work || !countsFile) usage();
  const manifest = await readManifest(work);
  const actual = parseCounts(await readFile(countsFile, "utf8"));
  const ok = report(manifest.database.platform, actual, option("--skip"), "policies, triggers, queues, schedules, restored against platform.sql");
  process.exit(ok ? 0 : 1);
}

async function compareFileRows() {
  const [work, rowsFile] = args;
  if (!work || !rowsFile) usage();
  const manifest = await readManifest(work);
  const rows = JSON.parse((await readFile(rowsFile, "utf8")).trim() || "[]").map((/** @type {[string, string]} */ [bucket, path]) => ({ bucket, path }));
  const lostFile = option("--lost")[0];
  /** @type {string[]} */
  const lost = lostFile ? JSON.parse(await readFile(lostFile, "utf8")) : [];
  const result = rowsWithoutFiles(rows, manifest.storage.objects, manifest.storage.deletedDuringBackup, lost);
  console.log(
    `${result.unexpected.length === 0 ? "ok  " : "FAIL"}  file rows: ${rows.length} in storage.objects, ` +
      `${result.unexpected.length} with no file in the backup, ${result.deletedDuringBackup} deleted at the source while the backup ran` +
      `${lostFile ? `, ${result.lost} whose file could not be restored (ALLOW_MISSING_FILES=1)` : ""}`,
  );
  for (const key of result.unexpected) console.log(`      no file: ${key}`);
  process.exit(result.unexpected.length === 0 ? 0 : 1);
}

async function compareBucketSettings() {
  const [work, rowsFile] = args;
  if (!work || !rowsFile) usage();
  const manifest = await readManifest(work);
  const rows = JSON.parse((await readFile(rowsFile, "utf8")).trim() || "[]");
  const result = compareBuckets(manifest.storage.buckets, rows);
  console.log(`${result.ok ? "ok  " : "FAIL"}  bucket settings: ${result.checked} compared (public, size limit, file types), ${result.differences.length} different`);
  for (const d of result.differences) console.log(`      ${d}`);
  process.exit(result.ok ? 0 : 1);
}

function guard() {
  const decision = checkRestoreTarget(process.env);
  if (!decision.ok) {
    console.error(`Refusing: ${decision.reason}`);
    process.exit(1);
  }
  console.log(`Target ${decision.target} is not protected.`);
}

async function info() {
  const [work] = args;
  if (!work) usage();
  const m = await readManifest(work);
  console.log(m.environment);
  console.log(m.createdAt);
}

/** @param {{ read: { databaseBytes: number, extraDatabaseBytes?: number, catalogBytesEstimate?: number, storageBytes: number, storageFiles: number } }} m */
function trafficLine(m) {
  const t = trafficEstimate(m.read);
  return (
    `${formatBytes(t.night)}: database dump ${formatBytes(t.database)}, about ${formatBytes(t.catalog)} of catalog reads by pg_dump (a fixed estimate, not measured per run), ` +
    `${m.read.storageFiles} new or changed files ${formatBytes(t.files)}. At this rate, about ${formatBytes(t.month)} a month`
  );
}

async function summary() {
  const [work] = args;
  if (!work) usage();
  const m = await readManifest(work);
  const p = m.database.platform;
  const s = m.storage;
  const lines = [
    `| What | This backup |`,
    `|---|---|`,
    `| Database tables with rows | ${Object.values(m.database.rows).filter((n) => /** @type {number} */ (n) > 0).length} of ${m.database.tables} |`,
    `| Database rows | ${m.database.totalRows} |`,
    `| Tables with rows missing from the dump | ${m.database.missingTables.length} |`,
    `| Storage buckets | ${s.buckets.length} |`,
    `| Stored files | ${s.objectCount} (${formatBytes(s.totalBytes)}; largest ${formatBytes(s.largestBytes)}) |`,
    `| Files that could not be copied | ${s.errors.length} |`,
    `| Files deleted while the backup ran / changed while it ran | ${s.deletedDuringBackup.length} / ${s.warnings.length} |`,
    `| Storage policies / app triggers / queues / scheduled jobs | ${p.policies} / ${p.triggers} / ${p.queues} / ${p.cronJobs} |`,
    `| Read from Supabase by this run (counts toward its 5 GB monthly allowance) | ${trafficLine(m)} |`,
  ];
  console.log(lines.join("\n"));
}

async function traffic() {
  const [work] = args;
  if (!work) usage();
  const m = await readManifest(work);
  const t = trafficEstimate(m.read);
  console.log(`Read from Supabase: ${trafficLine(m)}.`);
  if (t.warn) {
    console.log(
      `::warning title=Supabase traffic::${m.environment}: about ${formatBytes(t.month)} a month if every night read what this one did, ` +
        `over ${formatBytes(TRAFFIC_WARN_BYTES)} for one environment (the free plan allows 5 GB a month for all projects together). ` +
        `A first night, or the night after the custodians' keys change, reads every file once; if this is not one, see the runbook, "Supabase traffic".`,
    );
  }
}

const commands = {
  build,
  index,
  "check-files": checkFiles,
  "unpack-blobs": unpackBlobs,
  "count-sql": countSql,
  "compare-rows": compareRows,
  "compare-platform": comparePlatform,
  "compare-file-rows": compareFileRows,
  "compare-buckets": compareBucketSettings,
  guard,
  info,
  summary,
  traffic,
};
const run = commands[/** @type {keyof typeof commands} */ (command)];
if (!run) usage();
try {
  await run();
} catch (error) {
  console.error(/** @type {Error} */ (error).message);
  process.exit(1);
}
