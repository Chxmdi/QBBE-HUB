import { describe, expect, it } from "vitest";
import type { CatalogType } from "@/lib/query/catalog";
import { lensSpecSchema, measure, type LensGroup } from "@/lib/query/spec";
import {
  appendTo,
  canAddCondition,
  canAddGroup,
  countConditions,
  defaultCondition,
  depthOfGroup,
  describeNode,
  emptyGroup,
  fromWhere,
  issueOf,
  maxDepthFor,
  operatorsFor,
  propertyOf,
  removeNode,
  setJoin,
  summarise,
  toWhere,
  updateNode,
  valueShape,
  withOperator,
  withProperty,
  type FilterCondition,
  type FilterGroup,
  type SummaryLabels,
} from "./filter-model";

const type: CatalogType = {
  key: "task",
  name: { en: "Task", fr: "Tâche" },
  properties: [
    { key: "title", kind: "text", propertyKind: "text", name: { en: "Title", fr: "Titre" }, sortable: true, groupable: false },
    {
      key: "priority", kind: "select", propertyKind: "select", name: { en: "Priority", fr: "Priorité" }, sortable: true, groupable: true,
      choices: [
        { key: "low", label: { en: "Low", fr: "Basse" } },
        { key: "high", label: { en: "High", fr: "Haute" } },
      ],
    },
    { key: "program", kind: "select", propertyKind: "relation", name: { en: "Program", fr: "Programme" }, sortable: false, groupable: true },
    { key: "due", kind: "date", propertyKind: "date", name: { en: "Due", fr: "Échéance" }, sortable: true, groupable: false },
    { key: "estimate", kind: "number", propertyKind: "number", name: { en: "Estimate", fr: "Estimation" }, sortable: true, groupable: false },
    { key: "assignee", kind: "person", propertyKind: "person", name: { en: "Assignee", fr: "Responsable" }, sortable: false, groupable: true },
    { key: "done", kind: "checkbox", propertyKind: "checkbox", name: { en: "Done", fr: "Fait" }, sortable: false, groupable: false },
    { key: "project", kind: "relation", propertyKind: "relation", name: { en: "Project", fr: "Projet" }, sortable: false, groupable: true, target: "project" },
  ],
};

const p = (key: string) => propertyOf(type, key)!;
const condition = (property: string, operator: FilterCondition["operator"], value?: unknown): FilterCondition => ({
  id: `c-${property}-${operator}`, kind: "condition", property, operator, value,
});

const labels: SummaryLabels = {
  operator: (o) => o.replace(/_/g, " "),
  relative: (k) => `<${k}>`,
  me: "me",
  yes: "yes",
  no: "no",
  and: "and",
  or: "or",
  advanced: "advanced",
};

describe("to and from the engine", () => {
  it("round-trips a nested where clause through the editable tree", () => {
    const where: LensGroup = {
      and: [
        { property: "title", operator: "contains", value: "grant" },
        {
          or: [
            { property: "priority", operator: "is", value: "high" },
            { and: [{ property: "due", operator: "before", value: { relative: "today" } }, { property: "done", operator: "is", value: false }] },
          ],
        },
      ],
    };
    const tree = fromWhere(where);
    expect(tree.join).toBe("and");
    expect(tree.items).toHaveLength(2);
    expect(toWhere(tree, type)).toEqual(where);
  });

  it("serialises straight to lensSpecSchema.where, trimming text and dropping what is incomplete", () => {
    let root = emptyGroup("and");
    root = appendTo(root, root.id, condition("title", "contains", "  grant "));
    root = appendTo(root, root.id, condition("estimate", "gt")); // no value yet
    const inner = emptyGroup("or");
    root = appendTo(root, root.id, inner);
    root = appendTo(root, inner.id, condition("priority", "is_any_of", ["low", "high"]));
    root = appendTo(root, inner.id, condition("assignee", "contains", { relative: "me" }));
    root = appendTo(root, inner.id, emptyGroup("and")); // empty group is dropped
    root = appendTo(root, root.id, condition("due", "is_empty"));
    root = appendTo(root, root.id, condition("estimate", "between", { from: 1, to: 2 }));

    const where = toWhere(root, type);
    expect(where).toEqual({
      and: [
        { property: "title", operator: "contains", value: "grant" },
        { or: [{ property: "priority", operator: "is_any_of", value: ["low", "high"] }, { property: "assignee", operator: "contains", value: { relative: "me" } }] },
        { property: "due", operator: "is_empty" },
        { property: "estimate", operator: "between", value: { from: 1, to: 2 } },
      ],
    });
    expect(lensSpecSchema.safeParse({ version: 1, type: "task", where }).success).toBe(true);
  });

  it("is nothing when every condition is incomplete", () => {
    let root = emptyGroup("or");
    root = appendTo(root, root.id, condition("title", "contains", ""));
    expect(toWhere(root, type)).toBeUndefined();
    expect(toWhere(emptyGroup(), type)).toBeUndefined();
  });

  it("keeps a relation sub-query it cannot edit", () => {
    const where: LensGroup = { and: [{ property: "project", operator: "matches", value: { where: { and: [{ property: "title", operator: "contains", value: "x" }] } } }] };
    const tree = fromWhere(where);
    expect(issueOf(tree.items[0] as FilterCondition, type)).toBeNull();
    expect(toWhere(tree, type)).toEqual(where);
  });
});

describe("conditions", () => {
  it("offers the engine's operators for the kind, without the sub-query", () => {
    expect(operatorsFor(p("project"))).toEqual(["contains", "not_contains", "is_empty", "is_not_empty"]);
    expect(operatorsFor(p("title"))).toContain("starts_with");
  });

  it("knows what value each operator needs", () => {
    expect(valueShape(p("title"), "is_empty")).toBe("none");
    expect(valueShape(p("estimate"), "between")).toBe("number_range");
    expect(valueShape(p("due"), "between")).toBe("date_range");
    expect(valueShape(p("due"), "on_or_after")).toBe("date");
    expect(valueShape(p("priority"), "is")).toBe("choice");
    expect(valueShape(p("priority"), "is_none_of")).toBe("choices");
    expect(valueShape(p("program"), "is")).toBe("id");
    expect(valueShape(p("program"), "is_any_of")).toBe("ids");
    expect(valueShape(p("assignee"), "contains")).toBe("person");
    expect(valueShape(p("done"), "is")).toBe("boolean");
    expect(valueShape(p("project"), "contains")).toBe("id");
  });

  it("starts complete where a default is obvious, and says what is missing otherwise", () => {
    expect(issueOf(defaultCondition(p("priority")), type)).toBeNull();
    expect(issueOf(defaultCondition(p("due")), type)).toBeNull();
    expect(issueOf(defaultCondition(p("assignee")), type)).toBeNull();
    expect(issueOf(defaultCondition(p("done")), type)).toBeNull();
    expect(issueOf(defaultCondition(p("title")), type)).toBe("value");
    expect(issueOf(defaultCondition(p("estimate")), type)).toBe("value");
    expect(issueOf(condition("nope", "is", "x"), type)).toBe("property");
    expect(issueOf(condition("title", "gt", "x"), type)).toBe("operator");
    expect(issueOf(condition("priority", "is", "urgent"), type)).toBe("value");
    expect(issueOf(condition("due", "is", { date: "2026-02-30" }), type)).toBe("value");
    expect(issueOf(condition("due", "is", { date: "2026-02-28" }), type)).toBeNull();
    expect(issueOf(condition("title", "contains", "a\u0000b"), type)).toBe("value");
  });

  it("changing the property starts over; changing the operator keeps a value of the same shape", () => {
    const c = condition("priority", "is", "high");
    expect(withProperty(c, p("title"))).toMatchObject({ id: c.id, property: "title", operator: "equals" });
    expect(withOperator(c, p("priority"), "is_not")).toMatchObject({ operator: "is_not", value: "high" });
    expect(withOperator(c, p("priority"), "is_any_of").value).toBeUndefined();
    expect(withOperator(c, p("priority"), "is_empty").value).toBeUndefined();
  });
});

describe("tree edits and limits", () => {
  it("updates, removes and never drops the root", () => {
    let root = emptyGroup();
    const c = condition("title", "contains", "a");
    root = appendTo(root, root.id, c);
    root = updateNode(root, c.id, (n) => ({ ...(n as FilterCondition), value: "b" }));
    expect((root.items[0] as FilterCondition).value).toBe("b");
    root = setJoin(root, root.id, "or");
    expect(root.join).toBe("or");
    expect(removeNode(root, root.id)).toBe(root);
    root = removeNode(root, c.id);
    expect(root.items).toEqual([]);
  });

  it("counts conditions and depth the way the engine does", () => {
    let root = emptyGroup("and");
    const g2 = emptyGroup("or");
    const g3 = emptyGroup("and");
    root = appendTo(root, root.id, g2);
    root = appendTo(root, g2.id, g3);
    root = appendTo(root, g3.id, condition("title", "contains", "x"));
    expect(depthOfGroup(root, root.id)).toBe(1);
    expect(depthOfGroup(root, g3.id)).toBe(3);
    expect(depthOfGroup(root, "missing")).toBeNull();
    expect(countConditions(root)).toBe(1);
    expect(measure(toWhere(root, type)!).depth).toBe(3);
    expect(canAddGroup(root, g3.id)).toBe(true);
    const g4 = emptyGroup("or");
    root = appendTo(root, g3.id, g4);
    expect(canAddGroup(root, g4.id)).toBe(false);
  });

  it("leaves one level for the search when the root is OR", () => {
    expect(maxDepthFor(emptyGroup("and"))).toBe(4);
    expect(maxDepthFor(emptyGroup("or"))).toBe(3);
  });

  it("stops at fifty conditions", () => {
    let root = emptyGroup();
    for (let i = 0; i < 49; i += 1) root = appendTo(root, root.id, condition(`t${i}`, "contains", "x"));
    expect(canAddCondition(root)).toBe(true);
    root = appendTo(root, root.id, condition("t49", "contains", "x"));
    expect(canAddCondition(root)).toBe(false);
  });
});

describe("summaries", () => {
  it("reads a nested clause in words, with choices, dates and people named", () => {
    const where: LensGroup = {
      and: [
        { property: "title", operator: "contains", value: "grant" },
        { or: [{ property: "priority", operator: "is", value: "high" }, { property: "due", operator: "before", value: { relative: "this_week" } }] },
        { property: "assignee", operator: "contains", value: "u1" },
        { property: "done", operator: "is", value: false },
        { property: "due", operator: "is_empty" },
      ],
    };
    const lines = summarise(where, type, "en", labels, [{ id: "u1", label: "Ada" }]);
    expect(lines).toEqual([
      "Title contains “grant”",
      "(Priority is High or Due before <this_week>)",
      "Assignee contains Ada",
      "Done is no",
      "Due is empty",
    ]);
    expect(describeNode({ property: "priority", operator: "is", value: "high" }, type, "fr-CA", labels)).toBe("Priorité is Haute");
    expect(summarise(undefined, type, "en", labels)).toEqual([]);
  });

  it("names a sub-query and an unknown property without failing", () => {
    expect(describeNode({ property: "project", operator: "matches", value: { where: { and: [] } } }, type, "en", labels)).toBe("Project matches advanced");
    expect(describeNode({ property: "gone", operator: "is", value: "x" }, type, "en", labels)).toBe("gone is");
  });

  it("the root group with an OR join summarises its own items", () => {
    const where: LensGroup = { or: [{ property: "priority", operator: "is", value: "low" }, { property: "priority", operator: "is", value: "high" }] };
    expect(summarise(where, type, "en", labels)).toEqual(["Priority is Low", "Priority is High"]);
    const tree: FilterGroup = fromWhere(where);
    expect(tree.join).toBe("or");
  });
});
