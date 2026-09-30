import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Spike results go to docs/design/spikes/evidence/<name>.json, which the spike notes quote. */
export function writeEvidence(name: string, data: unknown) {
  const dir = join(process.cwd(), process.env.SPIKE_EVIDENCE_DIR ?? "docs/design/spikes/evidence");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name}.json`), `${JSON.stringify(data, null, 2)}\n`);
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}
