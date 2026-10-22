import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";

/**
 * Stand-ins for the tools the backup scripts call (DATA-001), so
 * tests/unit/backup-scripts.test.ts can run the real scripts without age,
 * the AWS CLI or a Supabase project: a fake `age`, a fake `aws` that keeps
 * objects in a folder, and a fake Storage API in this process. None of them
 * encrypts anything; they only keep the shapes and the failure modes the
 * scripts must handle.
 */

/**
 * A fake age: "encrypts" by writing age's header, 16 random bytes (a real
 * age file differs on every run too) and the bytes XOR 0x5a; decrypts by
 * undoing that. With FAKE_AGE_LAZY_OUTPUT=1 it behaves like age 1.1.1: with
 * -o, the output file is created only when there is something to write, so
 * an empty plaintext leaves no file.
 */
const FAKE_AGE = `#!/usr/bin/env node
const fs = require("fs");
const crypto = require("crypto");
const args = process.argv.slice(2);
let out = null;
let decrypt = false;
const rest = [];
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === "-o") out = args[++i];
  else if (args[i] === "-r" || args[i] === "-i") i += 1;
  else if (args[i] === "-d") decrypt = true;
  else rest.push(args[i]);
}
const input = rest[0] ? fs.readFileSync(rest[0]) : fs.readFileSync(0);
const header = Buffer.from("age-encryption.org/v1\\n");
const xor = (b) => Buffer.from(b.map((x) => x ^ 0x5a));
let output;
if (decrypt) {
  if (!input.subarray(0, header.length).equals(header)) {
    process.stderr.write("age: error: not an age file\\n");
    process.exit(1);
  }
  output = xor(input.subarray(header.length + 16));
} else {
  output = Buffer.concat([header, crypto.randomBytes(16), xor(input)]);
}
if (out === null) process.stdout.write(output);
else if (output.length > 0 || process.env.FAKE_AGE_LAZY_OUTPUT !== "1") fs.writeFileSync(out, output);
`;

/**
 * A fake AWS CLI over a folder (FAKE_S3_ROOT/<bucket>/<key>), with the calls
 * bucket.sh makes: s3 cp (both ways, --recursive, to and from stdout),
 * s3api list-objects / list-objects-v2 (key<TAB>size lines, "None" when
 * empty) and s3api get-object with --range. With FAKE_S3_NO_OVERWRITE=1 a
 * put to an existing key fails, as an Oracle key without OBJECT_OVERWRITE
 * does. Every call is appended to FAKE_S3_LOG when set.
 */
const FAKE_AWS = `#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const root = process.env.FAKE_S3_ROOT;
const flags = new Set(["recursive", "only-show-errors", "no-progress"]);
const opts = {};
const pos = [];
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 1) {
  const a = argv[i];
  if (a.startsWith("--")) {
    const name = a.slice(2);
    if (flags.has(name)) opts[name] = true;
    else opts[name] = argv[++i];
  } else pos.push(a);
}
const [service, op, ...rest] = pos;
if (process.env.FAKE_S3_LOG) fs.appendFileSync(process.env.FAKE_S3_LOG, [service, op, ...rest].join(" ") + "\\n");
const file = (bucket, key) => path.join(root, bucket, ...key.split("/"));
const s3url = (u) => {
  const m = /^s3:\\/\\/([^/]+)\\/(.*)$/.exec(u);
  return m ? { bucket: m[1], key: m[2] } : null;
};
const die = (message) => {
  process.stderr.write(message + "\\n");
  process.exit(1);
};
function put(bucket, key, bytes) {
  const target = file(bucket, key);
  if (fs.existsSync(target) && process.env.FAKE_S3_NO_OVERWRITE === "1") die("An error occurred (403) when calling the PutObject operation: overwrite not allowed");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, bytes);
}
function walk(dir, base = "") {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(dir, e.name), base + e.name + "/") : [base + e.name],
  );
}
if (service === "s3" && op === "cp") {
  const [src, dst] = rest;
  const from = s3url(src);
  const to = s3url(dst);
  if (from) {
    const source = file(from.bucket, from.key);
    if (!fs.existsSync(source)) die("fatal error: An error occurred (404) when calling the HeadObject operation: Key not found");
    const bytes = fs.readFileSync(source);
    if (dst === "-") process.stdout.write(bytes);
    else fs.writeFileSync(dst, bytes);
  } else if (to && opts.recursive) {
    for (const rel of walk(src)) put(to.bucket, to.key + rel, fs.readFileSync(path.join(src, rel)));
  } else if (to) {
    put(to.bucket, to.key, fs.readFileSync(src));
  } else die("unsupported cp");
} else if (service === "s3api" && (op === "list-objects" || op === "list-objects-v2")) {
  const keys = walk(path.join(root, opts.bucket)).filter((k) => k.startsWith(opts.prefix || "")).sort();
  if (keys.length === 0) console.log("None");
  for (const k of keys) console.log(k + "\\t" + fs.statSync(file(opts.bucket, k)).size);
} else if (service === "s3api" && op === "get-object") {
  const source = file(opts.bucket, opts.key);
  if (!fs.existsSync(source)) die("An error occurred (NoSuchKey) when calling the GetObject operation");
  let bytes = fs.readFileSync(source);
  const range = /^bytes=(\\d+)-(\\d+)$/.exec(opts.range || "");
  if (range) bytes = bytes.subarray(Number(range[1]), Number(range[2]) + 1);
  fs.writeFileSync(rest[0], bytes);
  console.log("{}");
} else die("fake aws: unsupported call " + [service, op].join(" "));
`;

/** Writes the fake age and aws into `dir` and returns that folder, for PATH. */
export function writeFakeTools(dir: string) {
  mkdirSync(dir, { recursive: true });
  for (const [name, text] of [
    ["age", FAKE_AGE],
    ["aws", FAKE_AWS],
  ] as const) {
    writeFileSync(join(dir, name), text);
    chmodSync(join(dir, name), 0o755);
  }
  return dir;
}

/** Bytes the fake age writes for `plain` (any random part will do). */
export function fakeEncrypt(plain: Buffer) {
  return Buffer.concat([Buffer.from("age-encryption.org/v1\n"), Buffer.alloc(16, 7), Buffer.from(plain.map((x) => x ^ 0x5a))]);
}

/**
 * A storage.objects / storage.buckets data dump, as data.sql holds it, for
 * the given files.
 */
export function dataDump(buckets: string[], files: { bucket: string; path: string; id: string; size: number; md5: string }[]) {
  const copyText = (text: string) => text.replace(/\\/g, "\\\\");
  const lines = ['COPY "storage"."buckets" ("id", "public", "file_size_limit", "allowed_mime_types") FROM stdin;'];
  for (const b of buckets) lines.push(`${b}\tf\t\\N\t\\N`);
  lines.push("\\.");
  lines.push('COPY "storage"."objects" ("id", "bucket_id", "name", "updated_at", "metadata", "version", "archived_at", "is_delete_marker") FROM stdin;');
  for (const f of files) {
    const metadata = JSON.stringify({ eTag: `"${f.md5}"`, size: f.size, mimetype: "application/pdf" });
    lines.push(`${f.id}\t${f.bucket}\t${f.path}\t2026-10-22 03:00:00+00\t${copyText(metadata)}\tv-${f.id}\t\\N\tf`);
  }
  lines.push("\\.");
  return `${lines.join("\n")}\n`;
}

type Handler = (req: IncomingMessage, res: ServerResponse, body: Buffer) => void | Promise<void>;

/** A local HTTP server; `handler` answers every request. */
export async function startServer(handler: Handler) {
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      Promise.resolve(handler(req, res, Buffer.concat(chunks))).catch((error: Error) => {
        res.statusCode = 500;
        res.end(JSON.stringify({ message: error.message }));
      });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
