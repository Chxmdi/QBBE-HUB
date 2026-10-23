import { describe, expect, it } from "vitest";
import { findStuckBusy, scan } from "../../scripts/ci/check-stuck-busy.mjs";

/**
 * A handler that sets a busy flag and awaits without a try/finally leaves
 * its button busy forever when the request rejects. All client code has
 * been swept (useServerAction / runServerAction or try/finally); this keeps
 * it that way.
 */

describe("stuck busy buttons", () => {
  it("finds a busy flag reset after an unguarded await", () => {
    const source = [
      "async function save() {",
      "  setSaving(true);",
      "  const result = await createThing(values);",
      "  setSaving(false);",
      "}",
    ].join("\n");
    expect(findStuckBusy(source)).toEqual([2]);
  });

  it("accepts a try/finally, and a reset that comes before any await", () => {
    const guarded = ["setBusy(true);", "try {", "  await save();", "} finally {", "  setBusy(false);", "}"].join("\n");
    const synchronous = ["setBusy(true);", "setBusy(false);", "await later();"].join("\n");
    expect(findStuckBusy(guarded)).toEqual([]);
    expect(findStuckBusy(synchronous)).toEqual([]);
  });

  it("finds none in src", () => {
    expect(scan(["src"])).toEqual({});
  });
});
