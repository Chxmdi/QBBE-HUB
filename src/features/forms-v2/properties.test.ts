import { describe, expect, it } from "vitest";
import { fill, formsV2Text } from "./messages";
import {
  TASK_FORM_PROPERTIES,
  answerText,
  keyFromLabel,
  optionsFromLists,
  parseFormAnswers,
  propertiesProblem,
  visibleFields,
  type FormV2Property,
} from "./properties";

const title = TASK_FORM_PROPERTIES.find((p) => p.key === "title")!;
const priority = TASK_FORM_PROPERTIES.find((p) => p.key === "priority")!;

describe("propertiesProblem", () => {
  it("accepts a task form that asks for the title", () => {
    expect(propertiesProblem("task", [title, priority])).toBeNull();
  });

  it("refuses a task form without a required title", () => {
    expect(propertiesProblem("task", [priority])).toBe("taskNeedsTitle");
    expect(propertiesProblem("task", [{ ...title, required: false }])).toBe("taskNeedsTitle");
  });

  it("refuses a task property the form may not set", () => {
    const assignee: FormV2Property = { key: "assignee", kind: "text", required: false, label: { en: "Who", fr: "Qui" } };
    expect(propertiesProblem("task", [title, assignee])).toBe("notATaskProperty");
    expect(propertiesProblem("task", [title, { ...priority, kind: "text" }])).toBe("notATaskProperty");
  });

  it("needs both languages, unique keys and options for a choice", () => {
    const q: FormV2Property = { key: "name", kind: "text", required: true, label: { en: "Name", fr: "" } };
    expect(propertiesProblem("idea", [q])).toBe("missingLabel");
    const ok = { ...q, label: { en: "Name", fr: "Nom" } };
    expect(propertiesProblem("idea", [ok, ok])).toBe("duplicateKey");
    expect(propertiesProblem("idea", [{ ...ok, key: "Bad Key" }])).toBe("badKey");
    expect(propertiesProblem("idea", [{ ...ok, kind: "select", options: [] }])).toBe("needsOptions");
    expect(propertiesProblem("idea", [ok])).toBeNull();
  });
});

describe("keyFromLabel and optionsFromLists", () => {
  it("makes stable lower-case keys and avoids clashes", () => {
    expect(keyFromLabel("Needed by?")).toBe("needed_by");
    expect(keyFromLabel("Été 2027")).toBe("ete_2027");
    expect(keyFromLabel("2 people")).toBe("people");
    expect(keyFromLabel("Name", new Set(["name"]))).toBe("name_2");
  });

  it("pairs English and French choices by position", () => {
    expect(optionsFromLists("Small, Large", "Petit, Grand")).toEqual([
      { key: "small", label: { en: "Small", fr: "Petit" } },
      { key: "large", label: { en: "Large", fr: "Grand" } },
    ]);
    expect(optionsFromLists("Yes", "")[0].label.fr).toBe("Yes");
  });
});

describe("parseFormAnswers", () => {
  const props: FormV2Property[] = [
    { key: "name", kind: "text", required: true, label: { en: "Name", fr: "Nom" } },
    { key: "fee", kind: "currency", required: false, label: { en: "Fee", fr: "Frais" } },
    { key: "count", kind: "number", required: false, label: { en: "Count", fr: "Nombre" } },
    { key: "day", kind: "date", required: false, label: { en: "Day", fr: "Jour" } },
    { key: "agree", kind: "checkbox", required: false, label: { en: "Agree", fr: "Accord" } },
    priority,
  ];

  it("types every answer, money in whole cents", () => {
    const parsed = parseFormAnswers(props, {
      name: "  Sam ",
      fee: "12,5",
      count: "3.5",
      day: "2026-11-20",
      agree: "on",
      priority: "high",
    });
    expect(parsed).toEqual({
      ok: true,
      answers: { name: "Sam", fee: 1250, count: 3.5, day: "2026-11-20", agree: true, priority: "high" },
    });
  });

  it("leaves out empty optional answers and records unticked boxes as false", () => {
    expect(parseFormAnswers(props, { name: "Sam" })).toEqual({ ok: true, answers: { name: "Sam", agree: false } });
  });

  it("names the property that is wrong", () => {
    expect(parseFormAnswers(props, { name: "" })).toMatchObject({ ok: false, problem: "required", property: { key: "name" } });
    expect(parseFormAnswers(props, { name: "a", fee: "abc" })).toMatchObject({ ok: false, problem: "money" });
    expect(parseFormAnswers(props, { name: "a", day: "20/11/2026" })).toMatchObject({ ok: false, problem: "date" });
    expect(parseFormAnswers(props, { name: "a", priority: "urgent" })).toMatchObject({ ok: false, problem: "option" });
  });

  it("takes a file answer as the uploaded document's id", () => {
    const file: FormV2Property = { key: "photo", kind: "file", required: false, label: { en: "Photo", fr: "Photo" } };
    expect(parseFormAnswers([file], { photo: "x" })).toMatchObject({ ok: false, problem: "file" });
    expect(parseFormAnswers([file], { photo: "2B6C7D8E-1111-4222-8333-444455556666" })).toEqual({
      ok: true,
      answers: { photo: "2b6c7d8e-1111-4222-8333-444455556666" },
    });
  });

  it("leaves hidden questions out, even when an answer was sent for them", () => {
    const drive: FormV2Property = { key: "drive", kind: "checkbox", required: false, label: { en: "Drives", fr: "Conduit" } };
    const licence: FormV2Property = {
      key: "licence", kind: "text", required: true, label: { en: "Licence", fr: "Permis" },
      showIf: { key: "drive", op: "eq", value: true },
    };
    expect(parseFormAnswers([drive, licence], { drive: false, licence: "stale" })).toEqual({
      ok: true,
      answers: { drive: false },
    });
    expect(parseFormAnswers([drive, licence], { drive: true })).toMatchObject({ ok: false, problem: "required" });
  });
});

describe("visibleFields", () => {
  const drive: FormV2Property = { key: "drive", kind: "checkbox", required: false, label: { en: "Drives", fr: "Conduit" } };
  const size: FormV2Property = {
    key: "size", kind: "select", required: false, label: { en: "Size", fr: "Taille" },
    options: [{ key: "s", label: { en: "Small", fr: "Petit" } }, { key: "l", label: { en: "Large", fr: "Grand" } }],
  };
  const licence: FormV2Property = {
    key: "licence", kind: "text", required: true, label: { en: "Licence", fr: "Permis" },
    showIf: { key: "drive", op: "eq", value: true },
  };
  const plate: FormV2Property = {
    key: "plate", kind: "text", required: false, label: { en: "Plate", fr: "Plaque" },
    showIf: { key: "licence", op: "is_not_empty" },
  };
  const why: FormV2Property = {
    key: "why", kind: "text", required: false, label: { en: "Why large?", fr: "Pourquoi grand?" },
    showIf: { key: "size", op: "neq", value: "s" },
  };
  const note: FormV2Property = {
    key: "note", kind: "text", required: false, label: { en: "Note", fr: "Note" },
    showIf: { key: "plate", op: "contains", value: "qc" },
  };
  const all = [drive, size, licence, plate, why, note];
  const keys = (answers: Record<string, unknown>) => visibleFields(all, answers).map((p) => p.key);

  it("shows a question only while the one it depends on is shown and matches", () => {
    expect(keys({})).toEqual(["drive", "size", "why"]);
    expect(keys({ drive: true })).toEqual(["drive", "size", "licence", "why"]);
    expect(keys({ drive: true, licence: "A1" })).toEqual(["drive", "size", "licence", "plate", "why"]);
    expect(keys({ drive: true, licence: "A1", plate: "123 QC" })).toEqual(["drive", "size", "licence", "plate", "why", "note"]);
    // The chain breaks with its first link: a hidden licence hides the plate too.
    expect(keys({ drive: false, licence: "A1", plate: "123 QC" })).toEqual(["drive", "size", "why"]);
    expect(keys({ size: "s" })).toEqual(["drive", "size"]);
    expect(keys({ size: "l" })).toEqual(["drive", "size", "why"]);
  });

  it("treats blank text and an unticked box as empty", () => {
    expect(keys({ drive: true, licence: "   " })).toEqual(["drive", "size", "licence", "why"]);
  });
});

describe("propertiesProblem with conditions", () => {
  const drive: FormV2Property = { key: "drive", kind: "checkbox", required: false, label: { en: "Drives", fr: "Conduit" } };
  const licence: FormV2Property = { key: "licence", kind: "text", required: false, label: { en: "Licence", fr: "Permis" } };

  it("accepts a condition on an earlier question and refuses the rest", () => {
    expect(propertiesProblem("offer", [drive, { ...licence, showIf: { key: "drive", op: "eq", value: true } }])).toBeNull();
    expect(propertiesProblem("offer", [{ ...licence, showIf: { key: "drive", op: "eq", value: true } }, drive])).toBe("badCondition");
    expect(propertiesProblem("offer", [drive, { ...licence, showIf: { key: "drive", op: "eq", value: "yes" } }])).toBe("badCondition");
    expect(propertiesProblem("offer", [drive, { ...licence, showIf: { key: "drive", op: "is_empty", value: true } }])).toBe("badCondition");
    expect(propertiesProblem("offer", [licence, { ...drive, showIf: { key: "licence", op: "contains", value: "" } }])).toBe("badCondition");
    expect(propertiesProblem("offer", [licence, { ...drive, showIf: { key: "licence", op: "is_not_empty" } }])).toBeNull();
  });

  it("never hides the task title", () => {
    expect(propertiesProblem("task", [priority, { ...title, showIf: { key: "priority", op: "eq", value: "high" } }])).toBe("badCondition");
  });
});

describe("answerText", () => {
  it("shows choices in the reader's language and amounts as money", () => {
    expect(answerText(priority, "high", "fr-CA")).toBe("Haute");
    expect(answerText({ ...title, kind: "currency" }, 1250, "en")).toBe("$12.50");
  });
});

describe("messages", () => {
  it("has French for every English string", () => {
    const en = formsV2Text("en");
    const fr = formsV2Text("fr-CA");
    const keys = (o: object, prefix = ""): string[] =>
      Object.entries(o).flatMap(([k, v]) => (typeof v === "object" ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`]));
    expect(keys(fr)).toEqual(keys(en));
    expect(fill(fr.errors.required, { label: "Nom" })).toBe("Réponse obligatoire : Nom");
  });
});
