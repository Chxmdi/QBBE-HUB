import { describe, expect, it } from "vitest";
import { appsEn } from "../i18n/en";
import { appsFrCA } from "../i18n/fr-CA";
import {
  actionsFor,
  appCapabilityFor,
  navigation,
  starterAppDefinition,
  validateAppDefinition,
  type AppDefinition,
} from "../schema";

function codes(input: unknown): string[] {
  const result = validateAppDefinition(input);
  return result.ok ? [] : result.issues.map((i) => i.code);
}

function sample(): AppDefinition {
  const app = starterAppDefinition();
  app.screens.push({ key: "handbook", title: { en: "Handbook", fr: "Guide" }, kind: "page", pageId: "7b2f7c1e-3f4a-4d59-9a6e-1f0b2c3d4e5f", inNavigation: false });
  app.actions.push({ key: "assign", label: { en: "Assign", fr: "Assigner" }, actionKey: "task.assign", capability: "run_workflow", screens: ["tasks"] });
  app.actions.push({ key: "archive", label: { en: "Archive", fr: "Archiver" }, actionKey: "object.archive", capability: "manage", screens: [] });
  return app;
}

describe("app definitions", () => {
  it("accept the starter and a fuller app", () => {
    expect(validateAppDefinition(starterAppDefinition()).ok).toBe(true);
    expect(validateAppDefinition(sample()).ok).toBe(true);
  });

  it("need a screen in the menu", () => {
    const app = sample();
    app.screens.forEach((s) => (s.inNavigation = false));
    expect(codes(app)).toContain("needsNavigation");
    expect(codes({ version: 1, screens: [] })).toContain("needsAScreen");
  });

  it("refuse duplicate keys and actions on missing screens", () => {
    const app = sample();
    app.screens[1].key = "tasks";
    app.actions[0].screens = ["nowhere"];
    expect(codes(app)).toEqual(expect.arrayContaining(["duplicateKey", "unknownScreen"]));
  });

  it("check each kind of screen", () => {
    const app = sample();
    app.screens[2] = { ...app.screens[2], kind: "page", pageId: "not-a-uuid" } as AppDefinition["screens"][number];
    const dashboard = app.screens[1];
    if (dashboard.kind === "dashboard") dashboard.widgets = [];
    expect(codes(app)).toEqual(expect.arrayContaining(["invalidPage", "dashboardNeedsWidgets"]));
  });

  it("need both languages and a real action key", () => {
    const app = sample();
    app.screens[0].title.fr = "";
    app.actions[0].actionKey = "assign";
    expect(codes(app)).toEqual(expect.arrayContaining(["missingFrench", "invalidActionKey"]));
  });

  it("order the menu and pick each screen's actions", () => {
    const app = sample();
    expect(navigation(app).map((s) => s.key)).toEqual(["tasks", "overview"]);
    expect(actionsFor(app, "tasks").map((a) => a.key)).toEqual(["assign", "archive"]);
    expect(actionsFor(app, "overview").map((a) => a.key)).toEqual(["archive"]);
  });

  it("map workspace capabilities onto app grants, never more open", () => {
    expect(appCapabilityFor("view")).toBe("view");
    expect(appCapabilityFor("run_workflow")).toBe("run_workflow");
    expect(appCapabilityFor("share")).toBe("manage");
    expect(appCapabilityFor("edit_structure")).toBe("manage");
    expect(appCapabilityFor("comment")).toBe("manage");
  });

  it("have a message in both languages for every validation code", () => {
    for (const code of ["invalid", "invalidKey", "needsNavigation", "needsAScreen", "duplicateKey", "unknownScreen", "invalidPage", "dashboardNeedsWidgets", "invalidActionKey", "missingFrench"]) {
      expect(appsEn.errors).toHaveProperty(code);
      expect(appsFrCA.errors).toHaveProperty(code);
    }
  });
});
