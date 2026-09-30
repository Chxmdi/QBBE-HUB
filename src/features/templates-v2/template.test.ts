import { describe, expect, it } from "vitest";
import { templatesV2Text } from "./messages";
import { addDays, buildBody, destinationFor, isCalendarDate, planTemplate, type TemplateRecord } from "./template";

const space: TemplateRecord = {
  id: "s",
  scope: "space",
  typeKey: null,
  body: {
    title: { en: "Community event", fr: "Événement communautaire" },
    projects: [
      {
        title: { en: "Logistics", fr: "Logistique" },
        offsets: { start: 0, due: 42 },
        tasks: [{ title: { en: "Book the venue", fr: "Réserver la salle" }, offsets: { due: 7 } }],
      },
    ],
  },
};

describe("dates relative to a start date", () => {
  it("adds calendar days across months and leap days", () => {
    expect(addDays("2027-01-31", 1)).toBe("2027-02-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2027-03-01", 42)).toBe("2027-04-12");
  });

  it("only accepts real calendar dates", () => {
    expect(isCalendarDate("2027-02-29")).toBe(false);
    expect(isCalendarDate("2028-02-29")).toBe(true);
    expect(isCalendarDate("03/01/2027")).toBe(false);
  });
});

describe("planTemplate", () => {
  it("previews a space in the chosen language with real dates, as the database creates it", () => {
    expect(planTemplate(space, "2027-03-01", "fr-CA")).toEqual([
      { kind: "project", title: "Logistique", depth: 0, start: "2027-03-01", due: "2027-04-12" },
      { kind: "task", title: "Réserver la salle", depth: 1, start: null, due: "2027-03-08" },
    ]);
  });

  it("previews a page's blocks and nothing for an invalid start", () => {
    const page: TemplateRecord = {
      id: "p",
      scope: "page",
      typeKey: null,
      body: { title: { en: "Notes", fr: "Notes" }, blocks: [{ kind: "todo", text: { en: "Share", fr: "Diffuser" }, offsets: { due: 1 } }] },
    };
    expect(planTemplate(page, "2027-03-01", "en")[1]).toEqual({ kind: "todo", title: "Share", depth: 1, start: null, due: "2027-03-02" });
    expect(planTemplate(page, "not a date", "en")).toEqual([]);
  });

  it("knows where each scope goes", () => {
    expect(destinationFor(space)).toBe("program");
    expect(destinationFor({ scope: "object", typeKey: "task" })).toBe("project");
    expect(destinationFor({ scope: "page", typeKey: null })).toBe("none");
  });
});

describe("buildBody", () => {
  it("builds a project with its tasks and skips blank rows", () => {
    const built = buildBody("project", { en: "Onboarding", fr: "Accueil" }, "28", [
      { en: "Welcome", fr: "Bienvenue", due: "1" },
      { en: "", fr: "", due: "" },
    ]);
    expect(built).toEqual({
      ok: true,
      body: {
        title: { en: "Onboarding", fr: "Accueil" },
        offsets: { start: 0, due: 28 },
        tasks: [{ title: { en: "Welcome", fr: "Bienvenue" }, offsets: { due: 1 } }],
      },
    });
  });

  it("names what is missing", () => {
    expect(buildBody("project", { en: "A", fr: "" }, "", [])).toEqual({ ok: false, problem: "name" });
    expect(buildBody("project", { en: "A", fr: "B" }, "", [])).toEqual({ ok: false, problem: "tasks" });
    expect(buildBody("project", { en: "A", fr: "B" }, "", [{ en: "x", fr: "", due: "" }])).toEqual({ ok: false, problem: "taskText" });
    expect(buildBody("task", { en: "A", fr: "B" }, "-3", [])).toEqual({ ok: false, problem: "offset" });
    expect(buildBody("task", { en: "A", fr: "B" }, "", [])).toEqual({ ok: true, body: { title: { en: "A", fr: "B" } } });
  });
});

it("has French for every English string", () => {
  const keys = (o: object, prefix = ""): string[] =>
    Object.entries(o).flatMap(([k, v]) => (typeof v === "object" ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`]));
  expect(keys(templatesV2Text("fr-CA"))).toEqual(keys(templatesV2Text("en")));
});
