#!/usr/bin/env node
// Splits the signed-in browser specs across CI machines by measured time.
//
//   node scripts/ci/spec-groups.mjs <part> <parts>   # prints that part's spec paths
//
// Playwright's own --shard splits by file count, which put a 6-minute file
// and a 2-minute file on one machine and 4 minutes on another. This packs by
// the seconds in tests/e2e/durations.json instead (longest first, each onto
// the lightest machine so far).
//
// Some specs read what earlier specs created, on purpose: the French finance
// walk (translated-finance) visits the entries, bills, runs and
// reconciliations the finance specs post before it. Those files form one
// group that always lands on one machine; Playwright then runs a machine's
// files in name order, which keeps the order the specs were written for.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DIR = "tests/e2e";
const EXCLUDED = new Set(["public-routes.spec.ts", "qa-matrix.spec.ts"]);
export const GROUPS = [
  [
    "bank.spec.ts", "budgets.spec.ts", "fund-accounting.spec.ts", "gifts.spec.ts",
    "ledger.spec.ts", "payables.spec.ts", "payroll.spec.ts", "receipts.spec.ts",
    "sales-tax.spec.ts", "translated-finance.spec.ts", "year-end.spec.ts",
  ],
];
const DEFAULT_SECONDS = 30;

export function assign(files, durations, parts) {
  const grouped = new Set(GROUPS.flat());
  const units = [
    ...GROUPS.map((g) => g.filter((f) => files.includes(f))).filter((g) => g.length),
    ...files.filter((f) => !grouped.has(f)).map((f) => [f]),
  ].map((unit) => ({
    files: unit,
    seconds: unit.reduce((sum, f) => sum + (durations[f] ?? DEFAULT_SECONDS), 0),
  }));
  // Longest first; ties by name so every machine computes the same answer.
  units.sort((a, b) => b.seconds - a.seconds || a.files[0].localeCompare(b.files[0]));
  const bins = Array.from({ length: parts }, () => ({ files: [], seconds: 0 }));
  for (const unit of units) {
    const lightest = bins.reduce((min, bin) => (bin.seconds < min.seconds ? bin : min));
    lightest.files.push(...unit.files);
    lightest.seconds += unit.seconds;
  }
  for (const bin of bins) bin.files.sort();
  return bins;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [part, parts] = process.argv.slice(2).map(Number);
  if (!Number.isInteger(part) || !Number.isInteger(parts) || part < 1 || part > parts) {
    console.error("usage: spec-groups.mjs <part> <parts>");
    process.exit(2);
  }
  const files = readdirSync(DIR).filter((f) => f.endsWith(".spec.ts") && !EXCLUDED.has(f));
  const durations = JSON.parse(readFileSync(join(DIR, "durations.json"), "utf8"));
  const bins = assign(files, durations, parts);
  for (const [i, bin] of bins.entries()) console.error(`part ${i + 1}: ~${bin.seconds}s, ${bin.files.length} files`);
  console.log(bins[part - 1].files.map((f) => join(DIR, f)).join("\n"));
}
