// Finds client handlers that can leave a button busy forever.
//
//   node scripts/ci/check-stuck-busy.mjs [folder ...]
//
// The shape: `setSaving(true)` (or busy, pending, loading, submitting, …),
// then an `await`, then `setSaving(false)` with no try/finally around the
// await. If the awaited call rejects (network drop, server error, a tab from
// before a release) the reset never runs and the button stays on "Saving…"
// with nothing said. Use useServerAction / runServerAction
// (src/lib/use-server-action.ts) or a try/finally instead.
// tests/unit/stuck-busy.test.ts keeps the count at zero in the folders that
// have been swept.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(import.meta.url), "../../..");
const BUSY = /\bset(?:Saving|Busy|Pending|Loading|Submitting|Sending|Working|Deleting|Removing|Creating|Adding|Updating|Publishing|Uploading|Running|Processing|Importing|Exporting|Approving|Rejecting|Posting|Voiding|Archiving|Restoring|Inviting|Connecting|Disconnecting|Syncing|Generating|Applying|Marking|Moving|Closing|Opening|Signing|Sharing|InFlight|Busy\w*|Saving\w*|Pending\w*)\(\s*true\s*\)/;

const NAMED_BUSY = /\bset(?:Pending|Busy|Saving|Loading|Working)\w*\(\s*(?!false\b|null\b|undefined\b|true\b|\(|[a-z]+\s*=>|!)[^)\s][^)]*\)/;

/** 1-based lines of `setX(true)` whose following await is not guarded. */
export function findStuckBusy(source) {
  const lines = source.split("\n");
  const found = [];
  for (let i = 0; i < lines.length; i += 1) {
    // Also a busy value naming what is busy: setPending("delete"), setBusyId(row.id).
    const match = BUSY.exec(lines[i]) ?? NAMED_BUSY.exec(lines[i]);
    if (!match) continue;
    // An adapter handed to runServerAction (`setBusy: (on) => setPending(...)`).
    if (/=>\s*$/.test(lines[i].slice(0, match.index))) continue;
    const setter = match[0].slice(0, match[0].indexOf("("));
    let guarded = false;
    for (let j = i; j < Math.min(lines.length, i + 60); j += 1) {
      const line = j === i ? lines[j].slice(match.index + match[0].length) : lines[j];
      if (/\btry\s*\{/.test(line)) {
        guarded = true;
        break;
      }
      if (new RegExp(`\\b${setter}\\(\\s*(false|null|undefined|""|'')\\s*\\)`).test(line)) break;
      if (/\bawait\b/.test(line)) {
        if (!guarded) found.push(i + 1);
        break;
      }
    }
  }
  return found;
}

function clientFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...clientFiles(path));
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) {
      const text = readFileSync(path, "utf8");
      if (/^\s*["']use client["']/.test(text)) out.push(path);
    }
  }
  return out;
}

/** { path: [lines] } for every client file under the given folders. */
export function scan(folders = ["src"], root = ROOT) {
  const result = {};
  for (const folder of folders) {
    for (const file of clientFiles(join(root, folder))) {
      const lines = findStuckBusy(readFileSync(file, "utf8"));
      if (lines.length > 0) result[relative(root, file).split("\\").join("/")] = lines;
    }
  }
  return result;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const folders = process.argv.slice(2);
  const found = scan(folders.length ? folders : ["src"]);
  let total = 0;
  for (const [path, lines] of Object.entries(found)) {
    total += lines.length;
    console.log(`${path}: ${lines.join(", ")}`);
  }
  console.log(`${total} unguarded busy handlers in ${Object.keys(found).length} files.`);
  process.exit(total > 0 ? 1 : 0);
}
