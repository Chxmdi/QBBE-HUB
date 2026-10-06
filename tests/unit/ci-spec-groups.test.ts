import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { assign, GROUPS } from "../../scripts/ci/spec-groups.mjs";

const files: string[] = readdirSync("tests/e2e").filter(
  (f) => f.endsWith(".spec.ts") && f !== "public-routes.spec.ts" && f !== "qa-matrix.spec.ts",
);
const durations = JSON.parse(readFileSync("tests/e2e/durations.json", "utf8"));

describe("CI spec split", () => {
  const bins: { files: string[]; seconds: number }[] = assign(files, durations, 4);

  it("runs every signed-in spec exactly once", () => {
    const all = bins.flatMap((b) => b.files).sort();
    expect(all).toEqual([...files].sort());
  });

  it("keeps each dependent group on one machine", () => {
    for (const group of GROUPS as string[][]) {
      const present = group.filter((f) => files.includes(f));
      const holders = bins.filter((b) => present.some((f) => b.files.includes(f)));
      expect(holders).toHaveLength(1);
      expect(present.every((f) => holders[0].files.includes(f))).toBe(true);
    }
  });

  it("gives an unmeasured new spec a machine too", () => {
    const withNew = assign([...files, "zz-new-feature.spec.ts"], durations, 4);
    expect(withNew.flatMap((b: { files: string[] }) => b.files)).toContain("zz-new-feature.spec.ts");
  });

  it("is the same on every machine", () => {
    expect(assign([...files].reverse(), durations, 4)).toEqual(bins);
  });
});
