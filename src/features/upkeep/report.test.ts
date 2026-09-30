import { describe, expect, it } from "vitest";
import { upkeepText } from "./messages";
import { hrefFor, kindOf, staleThreshold, total } from "./report";

describe("upkeep report helpers", () => {
  it("accepts only the offered thresholds, defaulting to 180 days", () => {
    expect(staleThreshold("90")).toBe(90);
    expect(staleThreshold("365")).toBe(365);
    expect(staleThreshold("7")).toBe(180);
    expect(staleThreshold(undefined)).toBe(180);
  });

  it("links each kind of record to where it opens", () => {
    expect(hrefFor("task", "t1")).toBe("/my-work?task=t1");
    expect(hrefFor("project", "p1")).toBe("/projects/p1");
    expect(hrefFor("document", "d1")).toBe("/documents/d1");
    expect(hrefFor("page", "x")).toBeNull();
  });

  it("labels types and saved views by what they are", () => {
    expect(kindOf({ issue: "type_without_objects", object_id: "1", title: "t", detail: null })).toBe("type");
    expect(kindOf({ issue: "view_for_missing_project", object_id: "1", title: "t", detail: null })).toBe("view");
    expect(kindOf({ issue: "archived_project", object_type: "task", object_id: "1", title: "t", detail: null })).toBe("task");
    expect(total([[1, 2], [], [3]])).toBe(3);
  });

  it("has wording for every issue the reports return, in both languages", () => {
    const issues = ["unapproved_host", "archived_project", "no_home_no_assignee", "filed_nowhere", "type_without_objects", "view_for_missing_project"];
    for (const locale of ["en", "fr-CA"] as const) {
      expect(Object.keys(upkeepText(locale).issues).sort()).toEqual([...issues].sort());
    }
  });
});

it("has French for every English string", () => {
  const keys = (o: object, prefix = ""): string[] =>
    Object.entries(o).flatMap(([k, v]) => (typeof v === "object" ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`]));
  expect(keys(upkeepText("fr-CA"))).toEqual(keys(upkeepText("en")));
});
