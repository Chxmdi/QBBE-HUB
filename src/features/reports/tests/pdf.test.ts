import { describe, expect, it } from "vitest";
import { buildSimplePdf } from "@/lib/simple-pdf";

describe("buildSimplePdf", () => {
  it("emits a PDF header from snapshot text only", () => {
    const bytes = buildSimplePdf("Q1 report", "2026-08-14T00:00:00.000Z", [
      { heading: "Metrics", lines: ["tasks_completed: 3"] },
    ]);
    const text = Buffer.from(bytes).toString("latin1");
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text).toContain("Q1 report");
    expect(text).toContain("tasks_completed: 3");
    expect(text).toContain("%%EOF");
  });
});
