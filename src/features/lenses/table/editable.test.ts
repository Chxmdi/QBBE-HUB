import { describe, expect, it } from "vitest";
import type { CatalogChoice } from "@/lib/query/catalog";
import {
  CELL_EDITABLE,
  cellEditorFor,
  EDITOR_KINDS,
  editorFor,
  isoDate,
  parseCellInput,
  parseNumber,
  storedValue,
  type EditorKind,
} from "./editable";

const PERSON = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1";
const PROJECT = "7ad2561f-a935-402e-9ba6-cbab50c9334a";
const choices: CatalogChoice[] = [
  { key: "in_review", label: { en: "In review", fr: "En révision" } },
  { key: "ready", label: { en: "Ready", fr: "Prête" } },
];
const people = [{ id: PERSON, label: "Quinn Owner" }];
const projects = [{ id: PROJECT, label: "Fall Community Workshop Series" }];

describe("D1-1: an editor for every property kind", () => {
  it("knows ten editor kinds", () => {
    expect([...EDITOR_KINDS].sort()).toEqual(
      ["checkbox", "date", "email", "multi_select", "number", "person", "relation", "select", "text", "url"].sort(),
    );
  });

  it("edits every writable task and project column the table shows, and nothing computed", () => {
    expect(cellEditorFor("task", "title")).toBe("text");
    expect(cellEditorFor("task", "estimate")).toBe("number");
    expect(cellEditorFor("task", "start")).toBe("date");
    expect(cellEditorFor("task", "priority")).toBe("select");
    expect(cellEditorFor("task", "requester")).toBe("person");
    expect(cellEditorFor("task", "project")).toBe("relation");
    expect(cellEditorFor("task", "milestone")).toBe("relation");
    expect(cellEditorFor("project", "health")).toBe("select");
    expect(cellEditorFor("project", "program")).toBe("relation");
    for (const computed of ["created_by", "created_time", "edited_time", "completed_time", "review_role"]) {
      expect(cellEditorFor("task", computed), computed).toBeNull();
    }
    expect(cellEditorFor("decision", "title")).toBeNull();
    // Every kind in the map is a kind the editor has.
    for (const byType of Object.values(CELL_EDITABLE)) {
      for (const kind of Object.values(byType)) expect(EDITOR_KINDS).toContain(kind);
    }
  });

  it("keeps the earlier cells while the object switch is off", () => {
    expect(editorFor("task", "title")).toBe("text");
    expect(editorFor("task", "estimate")).toBeNull();
    expect(editorFor("project", "title")).toBeNull();
  });

  const accepted: [EditorKind, string, string, unknown][] = [
    ["text", "Renamed task", "Renamed task", "Renamed task"],
    ["number", "2.5", "2.5", 2.5],
    ["number", "1,234.75", "1234.75", 1234.75],
    ["date", "2026-03-31", "2026-03-31", "2026-03-31"],
    ["select", "In review", "in_review", "in_review"],
    ["select", "prête", "ready", "ready"],
    ["multi_select", "Ready, En révision", '["ready","in_review"]', ["ready", "in_review"]],
    ["person", "quinn owner", PERSON, PERSON],
    ["person", PERSON, PERSON, PERSON],
    ["checkbox", "oui", "true", true],
    ["checkbox", "FALSE", "false", false],
    ["relation", "Fall Community Workshop Series", PROJECT, PROJECT],
    ["url", "https://example.org/a?b=1", "https://example.org/a?b=1", "https://example.org/a?b=1"],
    ["email", "name@example.org", "name@example.org", "name@example.org"],
  ];
  it.each(accepted)("%s accepts %j", (kind, input, raw, stored) => {
    const parsed = parseCellInput(kind, input, { property: "x", locale: "en", choices, options: kind === "person" ? people : projects });
    expect(parsed).toMatchObject({ ok: true, raw });
    expect(storedValue(kind, parsed.ok ? parsed.raw : null)).toEqual(stored);
  });

  it("shows people and related records by name while the save runs", () => {
    expect(parseCellInput("person", PERSON, { property: "assignee", options: people })).toEqual({
      ok: true,
      raw: PERSON,
      value: { id: PERSON, label: "Quinn Owner" },
    });
  });

  it("clears an optional cell and refuses to clear a required one", () => {
    expect(parseCellInput("date", "", { property: "due" })).toEqual({ ok: true, raw: null, value: null });
    expect(parseCellInput("person", "", { property: "assignee" })).toEqual({ ok: true, raw: null, value: null });
    expect(parseCellInput("text", "  ", { property: "title" })).toEqual({ ok: false, error: "required" });
    expect(parseCellInput("select", "", { property: "status", choices })).toEqual({ ok: false, error: "required" });
  });
});

describe("D1-5: invalid values are refused", () => {
  const refused: [EditorKind, string, string][] = [
    ["number", "abc", "number"],
    ["number", "1.2.3", "number"],
    ["number", "12abc", "number"],
    ["date", "2026-02-30", "date"],
    ["date", "31/03/2026", "date"],
    ["date", "tomorrow", "date"],
    ["select", "Someday", "choice"],
    ["multi_select", "Ready, Someday", "choice"],
    ["person", "Nobody Here", "person"],
    ["relation", "No such project", "relation"],
    ["checkbox", "maybe", "checkbox"],
    ["url", "javascript:alert(1)", "url"],
    ["url", "not a url", "url"],
    ["email", "name@", "email"],
  ];
  it.each(refused)("%s refuses %j", (kind, input, error) => {
    expect(parseCellInput(kind, input, { property: "x", locale: "en", choices, options: kind === "person" ? people : projects })).toEqual({
      ok: false,
      error,
    });
  });

  it("refuses text past the column's limit", () => {
    expect(parseCellInput("text", "x".repeat(301), { property: "title" })).toEqual({ ok: false, error: "tooLong" });
    expect(parseCellInput("text", "x".repeat(301), { property: "blocked_reason" })).toMatchObject({ ok: true });
  });

  it("without a list (on the server) accepts only an id for people and relations", () => {
    expect(parseCellInput("person", "Quinn Owner", { property: "assignee" })).toEqual({ ok: false, error: "person" });
    expect(parseCellInput("person", PERSON, { property: "assignee" })).toMatchObject({ ok: true, raw: PERSON });
    expect(parseCellInput("relation", "'; drop table task; --", { property: "project" })).toEqual({ ok: false, error: "relation" });
  });

  it("reads dates strictly", () => {
    expect(isoDate("2024-02-29")).toBe("2024-02-29");
    expect(isoDate("2025-02-29")).toBeNull();
    expect(isoDate("2026-13-01")).toBeNull();
  });

  it("reads numbers the way each language writes them, and never guesses", () => {
    expect(parseNumber("1,500", "en")).toBe(1500);
    expect(parseNumber("1,234.5", "en")).toBe(1234.5);
    expect(parseNumber("2,5", "en")).toBeNull();
    expect(parseNumber("2,5", "fr-CA")).toBe(2.5);
    expect(parseNumber("1 234,5", "fr-CA")).toBe(1234.5);
    expect(parseNumber("1234.5", "fr-CA")).toBe(1234.5);
    expect(parseNumber("1.234,5", "fr-CA")).toBeNull();
    // The server gets the browser's canonical form only.
    expect(parseNumber("4.5")).toBe(4.5);
    expect(parseNumber("4,5")).toBeNull();
    expect(parseNumber("-3", "en")).toBe(-3);
    expect(parseNumber("Infinity", "en")).toBeNull();
    expect(parseNumber("", "en")).toBeNull();
  });
});
