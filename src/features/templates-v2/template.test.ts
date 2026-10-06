import { describe, expect, it } from "vitest";
import { templatesV2Text } from "./messages";
import {
  addDays,
  buildBody,
  buildPageBody,
  destinationFor,
  findPageVariables,
  isCalendarDate,
  planTemplate,
  renderPageBody,
  renderPageText,
  type PageBody,
  type TemplateRecord,
} from "./template";

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

describe("page templates (U8)", () => {
  const meeting: PageBody = {
    title: { en: "Meeting notes", fr: "Notes de réunion" },
    variables: ["program", "owner", "period", "due"],
    blocks: [
      { kind: "paragraph", text: { en: "Program: {{program}} · Led by {{owner}} · Period: {{period}}", fr: "Programme : {{program}} · Animée par {{owner}} · Période : {{period}}" } },
      { kind: "heading", text: { en: "Agenda", fr: "Ordre du jour" } },
      { kind: "todo", text: { en: "Share the notes", fr: "Diffuser les notes" }, offsets: { due: 1 } },
      { kind: "todo", text: { en: "Follow up on the actions by {{due}}", fr: "Faire le suivi des actions d’ici le {{due}}" } },
    ],
  };
  const variables = { program: "Youth program", owner: "Jane Doe", period: "Fall 2027", due: "2027-03-15" };

  it("renders the page the database writes: variables filled, offsets dated, one line of text per block", () => {
    const page = renderPageBody(meeting, variables, "2027-03-01", "en");
    expect(page.title).toBe("Meeting notes");
    expect(page.blocks).toEqual([
      { type: "paragraph", props: {}, content: [{ type: "text", text: "Program: Youth program · Led by Jane Doe · Period: Fall 2027", styles: {} }], children: [] },
      { type: "heading", props: { level: 2 }, content: [{ type: "text", text: "Agenda", styles: {} }], children: [] },
      { type: "checkListItem", props: { checked: false }, content: [{ type: "text", text: "Share the notes · Due 2027-03-02", styles: {} }], children: [] },
      { type: "checkListItem", props: { checked: false }, content: [{ type: "text", text: "Follow up on the actions by 2027-03-15", styles: {} }], children: [] },
    ]);
    expect(page.text).toBe(
      "Program: Youth program · Led by Jane Doe · Period: Fall 2027\nAgenda\nShare the notes · Due 2027-03-02\nFollow up on the actions by 2027-03-15",
    );
  });

  it("writes French when asked, dates both offsets, and leaves a missing variable empty", () => {
    const body: PageBody = {
      title: { en: "Plan for {{program}}", fr: "Plan pour {{program}}" },
      blocks: [{ kind: "paragraph", text: { en: "Kick-off", fr: "Lancement" }, offsets: { start: 0, due: 7 } }],
    };
    const page = renderPageBody(body, {}, "2027-03-01", "fr-CA");
    expect(page.title).toBe("Plan pour ");
    expect(page.text).toBe("Lancement · Débute le 2027-03-01 · Échéance le 2027-03-08");
  });

  it("keeps a value on one line, never scans it twice, and leaves unknown placeholders alone", () => {
    expect(renderPageText("{{owner}} / {{ period }} / {{nope}}", { owner: "A\nB\u0007C", period: "{{owner}}" })).toBe(
      "A B C / {{owner}} / {{nope}}",
    );
    expect(findPageVariables("{{due}} {{program}} {{due}} {{other}}")).toEqual(["due", "program"]);
  });

  it("does not date offsets while the start date is invalid", () => {
    expect(renderPageBody(meeting, {}, "soon", "en").text.split("\n")[2]).toBe("Share the notes");
  });

  it("builds a page body from the builder's rows and lists the variables it uses", () => {
    const built = buildPageBody({ en: "Retro", fr: "Rétro" }, [
      { kind: "heading", en: "What went well for {{program}}", fr: "Ce qui a bien été pour {{program}}", due: "" },
      { kind: "todo", en: "Send to {{owner}}", fr: "Envoyer à {{owner}}", due: "3" },
      { kind: "paragraph", en: "", fr: "", due: "" },
    ]);
    expect(built).toEqual({
      ok: true,
      body: {
        title: { en: "Retro", fr: "Rétro" },
        blocks: [
          { kind: "heading", text: { en: "What went well for {{program}}", fr: "Ce qui a bien été pour {{program}}" } },
          { kind: "todo", text: { en: "Send to {{owner}}", fr: "Envoyer à {{owner}}" }, offsets: { due: 3 } },
        ],
        variables: ["program", "owner"],
      },
    });
    expect(buildPageBody({ en: "A", fr: "B" }, [])).toEqual({ ok: false, problem: "blocks" });
    expect(buildPageBody({ en: "A", fr: "B" }, [{ kind: "todo", en: "x", fr: "", due: "" }])).toEqual({ ok: false, problem: "blockText" });
    expect(buildPageBody({ en: "A", fr: "B" }, [{ kind: "todo", en: "x", fr: "y", due: "9999" }])).toEqual({ ok: false, problem: "offset" });
  });
});
