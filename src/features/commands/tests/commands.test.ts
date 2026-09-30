import { describe, expect, it } from "vitest";
import { TASK_STATUSES } from "@/features/tasks/schemas";
import { catalogKeys } from "@/features/universal-tasks/i18n/module-i18n";
import { matchRank, rankNames, suggest, type CommandCatalog } from "../autocomplete";
import { STATUS_LABELS, STATUS_WORDS, fold } from "../grammar";
import { commandsCatalogs } from "../i18n";
import { parseCommand } from "../parse";
import { resolveCommand, resolveName } from "../resolve";

const catalog: CommandCatalog = {
  tasks: [
    { id: "t1", title: "Book the hall" },
    { id: "t2", title: "Book the caterer" },
    { id: "t3", title: "Réserver la salle" },
  ],
  people: [
    { id: "p1", name: "Ada Lovelace" },
    { id: "p2", name: "Adèle Tremblay" },
    { id: "p3", name: "Grace Hopper" },
  ],
  spaces: [
    { id: "s1", name: "Youth Programs" },
    { id: "s2", name: "Éducation" },
  ],
  objects: [{ id: "o1", title: "Fall Community Workshop Series", type: "project", href: "/projects/o1" }],
};

describe("parseCommand: English", () => {
  it.each([
    ["create project Spring gala", { kind: "create_project", name: "Spring gala", space: null }],
    ["new project Spring gala in Youth Programs", { kind: "create_project", name: "Spring gala", space: "Youth Programs" }],
    ['create project "Art in schools" in Youth', { kind: "create_project", name: "Art in schools", space: "Youth" }],
    ['assign "Book the hall" to Ada', { kind: "assign_task", task: "Book the hall", person: "Ada" }],
    ["assign Book the hall to Ada Lovelace", { kind: "assign_task", task: "Book the hall", person: "Ada Lovelace" }],
    ['move "Book the hall" to in progress', { kind: "move_task", task: "Book the hall", status: "in_progress", reason: null }],
    ['move "Book the hall" to done', { kind: "move_task", task: "Book the hall", status: "completed", reason: null }],
    [
      'move "Book the hall" to blocked because waiting on the quote',
      { kind: "move_task", task: "Book the hall", status: "blocked", reason: "waiting on the quote" },
    ],
    ["show blocked tasks", { kind: "show_blocked" }],
    ["SHOW   BLOCKED", { kind: "show_blocked" }],
    ["open Fall Community Workshop Series", { kind: "open", target: "Fall Community Workshop Series" }],
    ["add Ada to Youth Programs", { kind: "add_to_space", person: "Ada", space: "Youth Programs" }],
  ])("%s", (input, command) => {
    expect(parseCommand(input)).toMatchObject({ ok: true, command, locale: "en" });
  });
});

describe("parseCommand: French", () => {
  it.each([
    ["créer un projet Gala du printemps", { kind: "create_project", name: "Gala du printemps", space: null }],
    ["Créer projet Gala dans Éducation", { kind: "create_project", name: "Gala", space: "Éducation" }],
    ["assigner « Réserver la salle » à Adèle", { kind: "assign_task", task: "Réserver la salle", person: "Adèle" }],
    ["attribuer “Réserver la salle” a Adèle", { kind: "assign_task", task: "Réserver la salle", person: "Adèle" }],
    ["déplacer « Réserver la salle » vers en cours", { kind: "move_task", task: "Réserver la salle", status: "in_progress", reason: null }],
    // "en" is a joiner and also starts "en cours": the split that gives a status wins.
    ["deplacer Réserver la salle en en cours", { kind: "move_task", task: "Réserver la salle", status: "in_progress", reason: null }],
    ["déplacer « Réserver la salle » à terminée", { kind: "move_task", task: "Réserver la salle", status: "completed", reason: null }],
    [
      "déplacer « Réserver la salle » vers bloquée parce que la soumission tarde",
      { kind: "move_task", task: "Réserver la salle", status: "blocked", reason: "la soumission tarde" },
    ],
    ["afficher les tâches bloquées", { kind: "show_blocked" }],
    ["ouvrir Gala", { kind: "open", target: "Gala" }],
    ["ajouter Adèle à Éducation", { kind: "add_to_space", person: "Adèle", space: "Éducation" }],
  ])("%s", (input, command) => {
    expect(parseCommand(input)).toMatchObject({ ok: true, command, locale: "fr-CA" });
  });
});

describe("parseCommand: incomplete and wrong input", () => {
  it("names the missing part", () => {
    expect(parseCommand("")).toEqual({ ok: false, reason: "empty" });
    expect(parseCommand("   ")).toEqual({ ok: false, reason: "empty" });
    expect(parseCommand("delete everything")).toMatchObject({ ok: false, reason: "unknown" });
    expect(parseCommand("show blocked tasks please")).toMatchObject({ ok: false, reason: "unknown" });
    expect(parseCommand("create project")).toMatchObject({ reason: "incomplete", slot: "name" });
    expect(parseCommand('assign "Book')).toMatchObject({ reason: "incomplete", slot: "task", partial: "Book" });
    expect(parseCommand("assign Book")).toMatchObject({ reason: "incomplete", slot: "task", partial: "Book" });
    expect(parseCommand('assign "Book the hall" to')).toMatchObject({
      reason: "incomplete",
      slot: "person",
      partial: "",
      filled: { task: "Book the hall" },
    });
    expect(parseCommand('move "Book the hall" to')).toMatchObject({ reason: "incomplete", slot: "status" });
    expect(parseCommand('move "Book the hall" to blocked')).toMatchObject({ reason: "incomplete", slot: "reason" });
    expect(parseCommand('move "Book the hall" to sideways')).toMatchObject({
      reason: "unknown_status",
      partial: "sideways",
    });
    expect(parseCommand("open")).toMatchObject({ reason: "incomplete", slot: "target" });
    expect(parseCommand("add Ada")).toMatchObject({ reason: "incomplete", slot: "person", partial: "Ada" });
  });

  it("is deterministic", () => {
    const input = 'déplacer « Réserver la salle » vers en cours';
    expect(parseCommand(input)).toEqual(parseCommand(input));
  });
});

describe("grammar", () => {
  it("has a status word and a label in both languages for every status", () => {
    const statuses = new Set(Object.values(STATUS_WORDS));
    for (const status of TASK_STATUSES) {
      expect(statuses.has(status), status).toBe(true);
      expect(STATUS_WORDS[fold(STATUS_LABELS[status].en)]).toBe(status);
      expect(STATUS_WORDS[fold(STATUS_LABELS[status]["fr-CA"])]).toBe(status);
    }
  });
});

describe("autocomplete", () => {
  it("ranks exact, then prefix, then word start, then anywhere", () => {
    expect(matchRank("Ada", "ada")).toBe(0);
    expect(matchRank("Ada Lovelace", "ada")).toBe(1);
    expect(matchRank("Countess Ada", "ada")).toBe(2);
    expect(matchRank("Canada", "ada")).toBe(3);
    expect(matchRank("Grace", "ada")).toBeNull();
    expect(rankNames(["Canada", "Countess Ada", "Ada Lovelace"], (n) => n, "ada")).toEqual([
      "Ada Lovelace",
      "Countess Ada",
      "Canada",
    ]);
  });

  it("offers commands in the viewer's language first", () => {
    expect(suggest("", catalog, "en")[0]).toMatchObject({ kind: "command", value: "create project " });
    expect(suggest("", catalog, "fr-CA")[0]).toMatchObject({ kind: "command", value: "créer un projet " });
    expect(suggest("as", catalog, "en").map((s) => s.value)).toEqual(['assign "']);
    expect(suggest("aj", catalog, "en").map((s) => s.value)).toEqual(["ajouter "]);
  });

  it("offers tasks, then people, while an assignment is typed", () => {
    expect(suggest('assign "book', catalog, "en").map((s) => s.value)).toEqual([
      'assign "Book the caterer" to ',
      'assign "Book the hall" to ',
    ]);
    expect(suggest('assign "Book the hall" to ', catalog, "en").map((s) => s.label)).toEqual([
      "Ada Lovelace",
      "Adèle Tremblay",
      "Grace Hopper",
    ]);
    expect(suggest('assign "Book the hall" to ade', catalog, "en")).toEqual([
      { label: "Adèle Tremblay", value: 'assign "Book the hall" to Adèle Tremblay', kind: "person" },
    ]);
  });

  it("uses French quotes and words for a French command", () => {
    expect(suggest("assigner rés", catalog, "fr-CA")[0].value).toBe("assigner « Réserver la salle » à ");
    expect(suggest("déplacer « Réserver la salle » vers en c", catalog, "fr-CA").map((s) => s.label)).toEqual([
      "en cours",
    ]);
    expect(suggest("déplacer « Réserver la salle » vers bl", catalog, "fr-CA")[0].value).toBe(
      "déplacer « Réserver la salle » vers bloquée parce que ",
    );
  });

  it("offers spaces and records", () => {
    expect(suggest("add Ada Lovelace to ed", catalog, "en").map((s) => s.label)).toEqual(["Éducation"]);
    expect(suggest("open fall", catalog, "en").map((s) => s.value)).toEqual(["open Fall Community Workshop Series"]);
  });
});

describe("resolve", () => {
  it("takes an exact name, or a single partial match, and never guesses", () => {
    const people = catalog.people;
    expect(resolveName(people, "ada lovelace")).toEqual({ ok: true, id: "p1" });
    expect(resolveName(people, "grace")).toEqual({ ok: true, id: "p3" });
    expect(resolveName(people, "ad")).toEqual({
      ok: false,
      reason: "ambiguous",
      candidates: ["Ada Lovelace", "Adèle Tremblay"],
    });
    expect(resolveName(people, "Zora")).toEqual({ ok: false, reason: "not_found", candidates: [] });
  });

  it("turns a command into a plan with ids", () => {
    const plan = (input: string) => {
      const parsed = parseCommand(input);
      if (!parsed.ok) throw new Error(input);
      return resolveCommand(parsed.command, catalog);
    };
    expect(plan('assign "Book the hall" to Grace')).toEqual({
      ok: true,
      plan: { kind: "assign_task", taskId: "t1", personId: "p3" },
    });
    expect(plan('move "hall" to waiting')).toEqual({
      ok: true,
      plan: { kind: "move_task", taskId: "t1", status: "waiting", reason: null },
    });
    expect(plan("show blocked tasks")).toEqual({ ok: true, plan: { kind: "navigate", href: "/my-work?status=blocked" } });
    expect(plan("open Fall Community Workshop Series")).toEqual({
      ok: true,
      plan: { kind: "navigate", href: "/projects/o1" },
    });
    expect(plan("create project Gala in education")).toEqual({
      ok: true,
      plan: { kind: "create_project", name: "Gala", spaceId: "s2" },
    });
    expect(plan("add Grace to Youth")).toEqual({
      ok: true,
      plan: { kind: "add_to_space", personId: "p3", spaceId: "s1" },
    });
    expect(plan('assign "Book" to Grace')).toMatchObject({ ok: false, reason: "ambiguous", slot: "task" });
    expect(plan('assign "Plant trees" to Grace')).toMatchObject({ ok: false, reason: "not_found", slot: "task" });
  });
});

describe("commands catalogue", () => {
  it("has every English key in French", () => {
    expect(catalogKeys(commandsCatalogs["fr-CA"])).toEqual(catalogKeys(commandsCatalogs.en));
  });
});
