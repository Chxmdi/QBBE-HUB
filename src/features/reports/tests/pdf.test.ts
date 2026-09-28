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

describe("buildSimplePdf in French", () => {
  it("writes accents as single WinAnsi bytes the Helvetica font can show", () => {
    const bytes = buildSimplePdf(
      "Rapport du 1er trimestre",
      "2026-08-14T00:00:00.000Z",
      [{ heading: "Échéances", lines: ["Tâches terminées : 3"] }],
      "Produit le 14 août 2026 — instantané figé (RPT-001)",
    );
    const text = Buffer.from(bytes).toString("latin1");
    expect(text).toContain("Échéances");
    expect(text).toContain("Tâches terminées");
    expect(text).toContain("14 août 2026 \x97 instantané");
    expect(text).not.toContain("Ã");
  });
});
