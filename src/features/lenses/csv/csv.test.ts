import { describe, expect, it } from "vitest";
import type { CatalogType } from "@/lib/query/catalog";
import type { LensResult } from "@/lib/query/run";
import { csvField, csvFileName, exportValue, lensToCsv } from "./export";
import {
  parseImportBoolean,
  parseImportDate,
  parseImportNumber,
  resolvePerson,
  toCreateInput,
  validateRows,
  type ImportRefs,
} from "./import";
import { importableProperties, mappingProblems, normalizeLabel, suggestMapping } from "./mapping";
import { CSV_BOM, detectDelimiter, parseCsv, splitCsv } from "./parse";

const task: CatalogType = {
  key: "task",
  name: { en: "Task", fr: "Tâche" },
  properties: [
    { key: "title", kind: "text", propertyKind: "text", name: { en: "Title", fr: "Titre" }, sortable: true, groupable: false },
    {
      key: "status", kind: "select", propertyKind: "status", name: { en: "Status", fr: "Statut" }, sortable: true, groupable: true,
      choices: [
        { key: "not_started", label: { en: "Not started", fr: "Non commencée" } },
        { key: "in_progress", label: { en: "In progress", fr: "En cours" } },
        { key: "blocked", label: { en: "Blocked", fr: "Bloquée" } },
      ],
    },
    {
      key: "priority", kind: "select", propertyKind: "select", name: { en: "Priority", fr: "Priorité" }, sortable: true, groupable: true,
      choices: [{ key: "low", label: { en: "Low", fr: "Basse" } }, { key: "high", label: { en: "High", fr: "Haute" } }],
    },
    { key: "assignee", kind: "person", propertyKind: "person", name: { en: "Assignee", fr: "Responsable" }, sortable: false, groupable: true, ref: { table: "user_profile", label: "full_name" } },
    { key: "due", kind: "date", propertyKind: "date", name: { en: "Due", fr: "Échéance" }, sortable: true, groupable: false },
    { key: "estimate", kind: "number", propertyKind: "number", name: { en: "Estimate (hours)", fr: "Estimation (heures)" }, sortable: true, groupable: false },
    { key: "project", kind: "relation", propertyKind: "relation", name: { en: "Project", fr: "Projet" }, sortable: false, groupable: true, target: "project" },
    { key: "program", kind: "select", propertyKind: "relation", name: { en: "Program", fr: "Programme" }, sortable: false, groupable: true, ref: { table: "program", label: "name" } },
    { key: "review_role", kind: "person", propertyKind: "person", name: { en: "Reviewer or approver (task role)", fr: "Réviseur ou approbateur (rôle)" }, sortable: false, groupable: false, filterOnly: true },
    { key: "created_by", kind: "person", propertyKind: "created_by", name: { en: "Created by", fr: "Créée par" }, sortable: false, groupable: true, ref: { table: "user_profile", label: "full_name" } },
    { key: "created_time", kind: "date", propertyKind: "created_time", name: { en: "Created", fr: "Créée le" }, sortable: true, groupable: false, timestamp: true },
  ],
};

const refs: ImportRefs = {
  people: [
    { id: "p1", name: "Marie Tremblay", email: "marie@example.com" },
    { id: "p2", name: "Jean Côté", email: "jean@example.com" },
    { id: "p3", name: "Jean Côté", email: "jean2@example.com" },
  ],
  projects: [{ id: "pr1", name: "Fall Community Workshop Series" }],
  programs: [{ id: "pg1", name: "Family First" }],
  milestones: [{ id: "m1", name: "Kickoff", projectId: "pr1" }],
};

describe("parseCsv", () => {
  it("reads RFC 4180 quoting: doubled quotes, delimiters and newlines inside quotes", () => {
    const text = 'Title,Notes\r\n"Say ""hi""","a, b"\r\n"two\nlines",plain\r\n';
    const parsed = parseCsv(text);
    expect(parsed.headers).toEqual(["Title", "Notes"]);
    expect(parsed.rows).toEqual([
      ['Say "hi"', "a, b"],
      ["two\nlines", "plain"],
    ]);
  });

  it("drops the byte-order mark Excel writes and blank lines", () => {
    const parsed = parseCsv(`${CSV_BOM}Title,Due\n\nAlpha,2026-01-02\n   \n`);
    expect(parsed.headers).toEqual(["Title", "Due"]);
    expect(parsed.rows).toEqual([["Alpha", "2026-01-02"]]);
  });

  it("detects a semicolon file (Excel in French Canada) and a tab file", () => {
    expect(detectDelimiter("Titre;Échéance\nA;B")).toBe(";");
    expect(detectDelimiter("Titre\tÉchéance\nA\tB")).toBe("\t");
    expect(parseCsv("Titre;Échéance\nAlpha;02/01/2026").rows).toEqual([["Alpha", "02/01/2026"]]);
  });

  it("squares short and long rows to the header", () => {
    const parsed = parseCsv("A,B,C\n1\n1,2,3,4");
    expect(parsed.rows).toEqual([["1", "", ""], ["1", "2", "3"]]);
  });

  it("names an empty header after its position", () => {
    expect(parseCsv("Title,,Due\nx,y,z").headers).toEqual(["Title", "column_2", "Due"]);
  });

  it("keeps a quoted field's inner spaces and trims unquoted ones", () => {
    expect(splitCsv('"  kept  ",  trimmed  ')).toEqual([["  kept  ", "trimmed"]]);
  });
});

describe("csvField", () => {
  it("quotes only what needs it and doubles quotes", () => {
    expect(csvField("plain")).toBe("plain");
    expect(csvField("a, b")).toBe('"a, b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField("line\nbreak")).toBe('"line\nbreak"');
    expect(csvField(null)).toBe("");
    expect(csvField(3.5)).toBe("3.5");
    expect(csvField(true)).toBe("true");
  });

  it("neutralises a leading formula character", () => {
    expect(csvField("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(csvField("+SUM(A1)")).toBe("'+SUM(A1)");
    expect(csvField("@cmd")).toBe("'@cmd");
    expect(csvField(-2)).toBe("-2");
    // Numeric text (how lens values arrive) is data, and imports back as a number.
    expect(csvField("-5")).toBe("-5");
    expect(csvField("+2.5")).toBe("+2.5");
    expect(csvField("-5 apples")).toBe("'-5 apples");
  });
});

describe("lensToCsv", () => {
  const result: LensResult = {
    type: "task",
    columns: [
      { key: "status", kind: "select", propertyKind: "status" },
      { key: "assignee", kind: "person", propertyKind: "person" },
      { key: "due", kind: "date", propertyKind: "date" },
      { key: "project", kind: "relation", propertyKind: "relation" },
      { key: "estimate", kind: "number", propertyKind: "number" },
    ],
    groupBy: null,
    rows: [
      {
        id: "t1", title: "Café, Montréal", group: null,
        values: { status: "in_progress", assignee: { id: "p1", label: "Marie Tremblay" }, due: "2026-03-04", project: { id: "pr1", label: "Fall Community Workshop Series" }, estimate: 2.5 },
      },
      { id: "t2", title: "=danger", group: null, values: { status: null, assignee: null, due: null, project: null, estimate: null } },
    ],
    total: 2, groups: null, limit: 1000, offset: 0,
  };

  it("starts with a byte-order mark, heads columns in the viewer's language and names references", () => {
    const csv = lensToCsv(result, task, "en");
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    const lines = csv.slice(1).split("\r\n");
    expect(lines[0]).toBe("Title,Status,Assignee,Due,Project,Estimate (hours)");
    expect(lines[1]).toBe('"Café, Montréal",In progress,Marie Tremblay,2026-03-04,Fall Community Workshop Series,2.5');
    expect(lines[2]).toBe("'=danger,,,,,");
    expect(lines[3]).toBe("");
  });

  it("uses French headers and labels for a French viewer", () => {
    const lines = lensToCsv(result, task, "fr-CA").slice(1).split("\r\n");
    expect(lines[0]).toBe("Titre,Statut,Responsable,Échéance,Projet,Estimation (heures)");
    expect(lines[1]).toContain("En cours");
  });

  it("limits and orders the columns to the fields asked for, the title always first", () => {
    const lines = lensToCsv(result, task, "en", ["due", "title", "status", "due"]).slice(1).split("\r\n");
    expect(lines[0]).toBe("Title,Due,Status");
  });

  it("formats values by kind", () => {
    expect(exportValue(task.properties[1], "in_progress", "fr-CA")).toBe("En cours");
    expect(exportValue(task.properties[4], "2026-03-04T00:00:00", "en")).toBe("2026-03-04");
    expect(exportValue(undefined, true, "en")).toBe("true");
    expect(exportValue(undefined, { id: "x", label: null }, "en")).toBe("");
  });

  it("names the file safely and dates it", () => {
    expect(csvFileName(["Tâches", "Mon équipe / Q1"], new Date("2026-10-01T12:00:00Z"))).toBe("taches-mon-equipe-q1-2026-10-01.csv");
    expect(csvFileName([null, ""], new Date("2026-10-01T12:00:00Z"))).toBe("lens-2026-10-01.csv");
  });
});

describe("mapping", () => {
  const properties = importableProperties(task);

  it("offers only what the create command accepts, without filter-only or read-only properties", () => {
    const keys = properties.map((p) => p.key);
    expect(keys).toEqual(["title", "description", "status", "priority", "assignee", "due", "project", "program"]);
    expect(properties.find((p) => p.key === "status")?.choices?.map((c) => c.key)).not.toContain("blocked");
  });

  it("suggests properties from English and French headers, aliases and keys", () => {
    const mapping = suggestMapping(["Titre", "Échéance", "Assigned to", "status", "Projet", "Notes", "Mystery"], properties);
    expect(mapping).toEqual({
      Titre: "title",
      Échéance: "due",
      "Assigned to": "assignee",
      status: "status",
      Projet: "project",
      Notes: "description",
      Mystery: null,
    });
  });

  it("gives each property to one column only", () => {
    const mapping = suggestMapping(["Title", "Name"], properties);
    expect(mapping).toEqual({ Title: "title", Name: null });
  });

  it("reports a missing title and duplicated targets", () => {
    expect(mappingProblems({ A: "due", B: "due" }, "task")).toEqual({ missing: ["title"], duplicated: ["due"] });
    expect(mappingProblems({ A: "title" }, "task")).toEqual({ missing: [], duplicated: [] });
  });

  it("normalises accents, case and punctuation", () => {
    expect(normalizeLabel("  Date d’échéance ")).toBe("date d echeance");
  });
});

describe("cell readers", () => {
  it("accepts ISO and Quebec dates and refuses the rest", () => {
    expect(parseImportDate("2026-03-04")).toBe("2026-03-04");
    expect(parseImportDate("04/03/2026")).toBe("2026-03-04");
    expect(parseImportDate("4/3/2026")).toBe("2026-03-04");
    expect(parseImportDate("2026/03/04")).toBe("2026-03-04");
    expect(parseImportDate("2026-03-04 10:00")).toBe("2026-03-04");
    expect(parseImportDate("31/02/2026")).toBeNull();
    expect(parseImportDate("2026-13-01")).toBeNull();
    expect(parseImportDate("March 4, 2026")).toBeNull();
    expect(parseImportDate("")).toBeNull();
  });

  it("reads numbers written the French or English way", () => {
    expect(parseImportNumber("1 234,5")).toBe(1234.5);
    expect(parseImportNumber("1,234.5")).toBe(1234.5);
    expect(parseImportNumber("12,5")).toBe(12.5);
    expect(parseImportNumber("12.5")).toBe(12.5);
    expect(parseImportNumber("-3")).toBe(-3);
    expect(parseImportNumber("abc")).toBeNull();
    // Thousands or decimal? Refused rather than off by a factor of 1000.
    expect(parseImportNumber("1,234")).toBeNull();
    expect(parseImportNumber("1,2,3")).toBeNull();
  });

  it("reads yes/no in both languages", () => {
    expect(parseImportBoolean("Oui")).toBe(true);
    expect(parseImportBoolean("non")).toBe(false);
    expect(parseImportBoolean("maybe")).toBeNull();
  });

  it("resolves a person by exact name or email, and refuses a shared name", () => {
    expect(resolvePerson("marie tremblay", refs.people)).toEqual({ id: "p1" });
    expect(resolvePerson("MARIE@example.com", refs.people)).toEqual({ id: "p1" });
    expect(resolvePerson("Jean Côté", refs.people)).toEqual({ problem: "ambiguous" });
    expect(resolvePerson("jean2@example.com", refs.people)).toEqual({ id: "p3" });
    expect(resolvePerson("Nobody", refs.people)).toEqual({ problem: "unknown" });
  });
});

describe("validateRows", () => {
  const headers = ["Title", "Status", "Assignee", "Due", "Project", "Program"];
  const mapping = { Title: "title", Status: "status", Assignee: "assignee", Due: "due", Project: "project", Program: "program" };

  it("resolves every kind and skips a row with a bad date, saying why in both languages", () => {
    const rows = [
      ["Plan the workshop", "En cours", "marie@example.com", "04/03/2026", "Fall Community Workshop Series", ""],
      ["Bad date", "in_progress", "", "not a date", "", ""],
      ["No status", "", "Marie Tremblay", "2026-05-06", "", "Family First"],
    ];
    const v = validateRows({ type: task, headers, rows, mapping, refs });
    expect(v.total).toBe(3);
    expect(v.rows).toEqual([
      { row: 1, values: { title: "Plan the workshop", status: "in_progress", assignee: "p1", due: "2026-03-04", project: "pr1" } },
      { row: 3, values: { title: "No status", assignee: "p1", due: "2026-05-06", program: "pg1" } },
    ]);
    expect(v.errors).toHaveLength(1);
    expect(v.errors[0]).toMatchObject({ row: 2, column: "Due" });
    expect(v.errors[0].message.en).toBe("Due: “not a date” is not a date. Use YYYY-MM-DD or DD/MM/YYYY.");
    expect(v.errors[0].message.fr).toBe("Échéance : « not a date » n’est pas une date. Utilisez AAAA-MM-JJ ou JJ/MM/AAAA.");
  });

  it("reports an unknown option, person and project on the same row", () => {
    const v = validateRows({
      type: task, headers, mapping, refs,
      rows: [["X", "Someday", "Nobody", "", "Unknown project", ""]],
    });
    expect(v.rows).toEqual([]);
    expect(v.errors.map((e) => e.column)).toEqual(["Status", "Assignee", "Project"]);
    expect(v.errors[0].message.en).toContain("is not one of Not started, In progress");
    expect(v.errors[2].message.fr).toBe("Projet : aucun projet ne s’appelle « Unknown project ».");
  });

  it("finds a milestone among the row's own project's milestones", () => {
    const withTwo: ImportRefs = {
      ...refs,
      projects: [...refs.projects, { id: "pr2", name: "Other" }],
      milestones: [{ id: "m1", name: "Kickoff", projectId: "pr1" }, { id: "m2", name: "Kickoff", projectId: "pr2" }],
    };
    const typed: CatalogType = {
      ...task,
      properties: [...task.properties, { key: "milestone", kind: "select", propertyKind: "relation", name: { en: "Milestone", fr: "Jalon" }, sortable: false, groupable: true, ref: { table: "milestone", label: "name" } }],
    };
    const v = validateRows({
      type: typed, refs: withTwo,
      headers: ["Milestone", "Title", "Project"],
      mapping: { Milestone: "milestone", Title: "title", Project: "project" },
      rows: [["Kickoff", "a", "Other"], ["Kickoff", "b", ""]],
    });
    expect(v.rows).toEqual([{ row: 1, values: { title: "a", project: "pr2", milestone: "m2" } }]);
    expect(v.errors[0]).toMatchObject({ row: 2, column: "Milestone" });
    expect(v.errors[0].message.en).toContain("several milestones");
  });

  it("requires a title", () => {
    const v = validateRows({ type: task, headers, mapping, refs, rows: [["", "in_progress", "", "", "", ""]] });
    expect(v.errors).toEqual([{ row: 1, column: "Title", message: { en: "Title is required.", fr: "Titre est obligatoire." } }]);
  });

  it("refuses the file when the mapping has no title or doubles a property", () => {
    const v = validateRows({ type: task, headers, mapping: { Title: null, Status: "due", Due: "due" }, refs, rows: [["a", "b", "", "", "", ""]] });
    expect(v.rows).toEqual([]);
    expect(v.errors.map((e) => e.row)).toEqual([0, 0]);
    expect(v.errors[1].message.fr).toBe("Plusieurs colonnes sont associées à Échéance.");
  });

  it("refuses a blocked status, which needs a reason the file cannot give", () => {
    const v = validateRows({ type: task, headers, mapping, refs, rows: [["a", "Blocked", "", "", "", ""]] });
    expect(v.errors[0].column).toBe("Status");
  });
});

describe("toCreateInput", () => {
  it("maps task values to the shared create action's input, program only without a project", () => {
    expect(toCreateInput("task", { title: "A", status: "ready", assignee: "p1", due: "2026-01-02", project: "pr1", program: "pg1" })).toEqual({
      title: "A", description: undefined, status: "ready", priority: undefined, assigneeId: "p1", reviewerId: undefined, approverId: undefined,
      dueAt: "2026-01-02", projectId: "pr1", programId: undefined, milestoneId: undefined, source: { type: "manual", id: null },
    });
    expect(toCreateInput("task", { title: "A", program: "pg1" }).programId).toBe("pg1");
  });

  it("maps project values to the project command's input", () => {
    expect(toCreateInput("project", { title: "P", stage: "planning", owner: "p1", start: "2026-01-02", target: "2026-02-03" })).toMatchObject({
      name: "P", stage: "planning", ownerId: "p1", startDate: "2026-01-02", targetDate: "2026-02-03",
    });
  });
});

describe("parseCsv header names", () => {
  it("numbers a repeated header so each column can be mapped on its own", () => {
    expect(parseCsv("Notes,Notes,Title\na,b,c").headers).toEqual(["Notes", "Notes (2)", "Title"]);
  });
});
