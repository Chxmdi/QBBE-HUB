#!/usr/bin/env node
// Keeps the Workspace OS switch convention in the browser specs.
//
//   node scripts/ci/switch-tests.mjs            # exits 1 and names each offender
//
// CI runs the signed-in suite twice: with every Workspace OS switch off (the
// default) and with WORKSPACE_OS_FLAGS=all. The override can only turn a
// switch on (src/lib/feature-flags.ts), so a test that asserts a screen is
// hidden while its switch is off cannot pass in the all-on run, and a test
// that needs the override cannot pass in the off run. The two runs exclude
// them by title:
//
//   off run:  npx playwright test … --grep-invert "\[switches on\]"
//   all run:  npx playwright test … --grep-invert "\[switch off\]"
//
// So every test that checks the off state must end its title with
// " [switch off]", and every test that needs the switches on must end with
// " [switches on]". This script fails when a title talks about the off state
// without the suffix, so a new spec cannot quietly break the all-on run.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const DIR = "tests/e2e";
export const OFF_SUFFIX = " [switch off]";
export const ON_SUFFIX = " [switches on]";

/** Title phrases that describe the off state. Case-insensitive. */
export const OFF_PHRASES = [
  /switch(?:es)? (?:is|are) off/i,
  /switch(?:es)? off/i,
  /switched[ -]off/i,
  /off by default/i,
  /hidden while/i,
];

/**
 * Every `test("…", …)` title in a spec, with its line. Only string literals
 * are read: a title built from a template or a variable is not a title the
 * grep can see either, and the specs use plain strings.
 */
export function testTitles(source) {
  const titles = [];
  const pattern = /\btest(?:\.only|\.skip|\.fixme|\.fail)?\(\s*(["'])((?:\\.|(?!\1)[^\\])*)\1/g;
  for (const match of source.matchAll(pattern)) {
    const line = source.slice(0, match.index).split("\n").length;
    titles.push({ title: match[2], line });
  }
  return titles;
}

/** The titles that break the convention, with why. */
export function offenders(fileName, source) {
  const found = [];
  for (const { title, line } of testTitles(source)) {
    const mentionsOff = OFF_PHRASES.some((phrase) => phrase.test(title));
    const endsOff = title.endsWith(OFF_SUFFIX);
    const endsOn = title.endsWith(ON_SUFFIX);
    const hasOff = title.includes("[switch off]");
    const hasOn = title.includes("[switches on]");
    if (mentionsOff && !endsOff) {
      found.push({ file: fileName, line, title, reason: `describes the off state but does not end with "${OFF_SUFFIX.trim()}"` });
    } else if (hasOff && !endsOff) {
      found.push({ file: fileName, line, title, reason: `"[switch off]" must be the end of the title` });
    } else if (hasOn && !endsOn) {
      found.push({ file: fileName, line, title, reason: `"[switches on]" must be the end of the title` });
    } else if (hasOff && hasOn) {
      found.push({ file: fileName, line, title, reason: "a test cannot need the switches both off and on" });
    }
  }
  return found;
}

export function check(dir = DIR) {
  const files = readdirSync(dir).filter((f) => f.endsWith(".spec.ts")).sort();
  return files.flatMap((f) => offenders(f, readFileSync(join(dir, f), "utf8")));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const found = check();
  for (const { file, line, title, reason } of found) {
    console.error(`${join(DIR, file)}:${line}: "${title}"\n  ${reason}`);
  }
  if (found.length) {
    console.error(`\n${found.length} test title(s) break the switch convention (scripts/ci/switch-tests.mjs).`);
    process.exit(1);
  }
  console.log("Every switch-state test title carries its suffix.");
}
