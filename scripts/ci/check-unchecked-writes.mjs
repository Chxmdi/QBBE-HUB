// Finds database writes whose result is never read.
//
//   node scripts/ci/check-unchecked-writes.mjs            report, exit 1 on new ones
//   node scripts/ci/check-unchecked-writes.mjs --update   rewrite the allowlist
//
// A statement such as `await supabase.from("x").insert(...)` with nothing
// taking its `{ error }` reports success whatever happened: the row may not be
// there. The same goes for a database function called with `.rpc(` whose
// result is dropped, and for `await recordAudit(...)` in a route, whose
// true/false says whether the download may go ahead. Each file keeps exactly
// the number of such statements recorded in unchecked-writes-allowlist.json
// (the ones that existed when the check was added): a new one fails the
// check, and so does fixing one without lowering the count (run --update),
// so the allowance can never be reused.
// tests/unit/unchecked-writes.test.ts runs the same check in CI.

import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(import.meta.url), "../../..");
const ALLOWLIST = join(ROOT, "scripts/ci/unchecked-writes-allowlist.json");
const WRITE = /\.(insert|update|upsert|delete)\(/;

/** Line numbers (1-based) of bare awaited writes, rpc calls and route audit calls. */
export function findUncheckedWrites(source, { route = false } = {}) {
  const lines = source.split("\n");
  const found = [];
  for (let i = 0; i < lines.length; i += 1) {
    // A statement that starts with `await`: nothing receives its result.
    if (!/^\s*await\s/.test(lines[i])) continue;
    let statement = lines[i];
    let end = i;
    while (!/;\s*(\/\/.*)?$/.test(lines[end]) && end + 1 < lines.length && end - i < 40) {
      end += 1;
      statement += `\n${lines[end]}`;
    }
    if (route && /^\s*await\s+recordAudit\(/.test(statement)) {
      found.push(i + 1);
      continue;
    }
    // A dropped database function result: almost always a write.
    if (/^\s*await\s+[\w.]+\s*\.rpc\(/.test(statement)) {
      found.push(i + 1);
      continue;
    }
    // Only the chain itself, not arguments: `.from(` must come before the write.
    const from = statement.search(/(?<![A-Z]\w*)\.from\(/);
    if (from === -1) continue;
    if (WRITE.test(statement.slice(from))) found.push(i + 1);
  }
  return found;
}

function sourceFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name === "node_modules" || name === "tests" || name === "testing") continue;
      out.push(...sourceFiles(path));
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) {
      out.push(path);
    }
  }
  return out;
}

/** Every file with unchecked writes, as { path: [lines] }. */
export function scan(root = ROOT) {
  const result = {};
  for (const file of sourceFiles(join(root, "src"))) {
    const lines = findUncheckedWrites(readFileSync(file, "utf8"), { route: /[/\\]route\.ts$/.test(file) });
    if (lines.length > 0) result[relative(root, file).split("\\").join("/")] = lines;
  }
  return result;
}

/** Files whose count differs from their allowance, in either direction. */
export function violations(found, allowed) {
  const paths = new Set([...Object.keys(found), ...Object.keys(allowed)]);
  return [...paths]
    .filter((path) => (found[path]?.length ?? 0) !== (allowed[path] ?? 0))
    .map((path) => ({ path, lines: found[path] ?? [], allowed: allowed[path] ?? 0 }));
}

export function readAllowlist() {
  return JSON.parse(readFileSync(ALLOWLIST, "utf8"));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const found = scan();
  if (process.argv.includes("--update")) {
    const counts = Object.fromEntries(Object.entries(found).sort().map(([path, lines]) => [path, lines.length]));
    writeFileSync(ALLOWLIST, `${JSON.stringify(counts, null, 2)}\n`);
    console.log(`Allowlist rewritten: ${Object.keys(counts).length} files.`);
  } else {
    const bad = violations(found, readAllowlist());
    for (const { path, lines, allowed } of bad) {
      console.error(
        lines.length > allowed
          ? `${path}: ${lines.length} unchecked writes (allowed ${allowed}) at lines ${lines.join(", ")}`
          : `${path}: ${lines.length} unchecked writes but ${allowed} allowed; run with --update to lower the count`,
      );
    }
    if (bad.length > 0) {
      console.error("Read the { error } of each write, or throw on it, then run with --update. See scripts/ci/check-unchecked-writes.mjs.");
      process.exit(1);
    }
    console.log("Unchecked writes match the allowlist.");
  }
}
