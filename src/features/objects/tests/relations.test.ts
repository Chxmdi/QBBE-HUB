import { describe, expect, it } from "vitest";
import { orientRelations, toObjectRelation } from "@/features/objects/services/relations";

const project = "11111111-1111-1111-1111-111111111111";
const task = "22222222-2222-2222-2222-222222222222";
const other = "33333333-3333-3333-3333-333333333333";

describe("relations", () => {
  const contains = toObjectRelation({
    id: null,
    relation_type_key: "contains",
    from_id: project,
    from_type: "project",
    to_id: task,
    to_type: "task",
    source: "task_project",
  });

  it("maps a view row to the contract's shape", () => {
    expect(contains).toEqual({
      id: null,
      relationTypeKey: "contains",
      from: { id: project, type: "project" },
      to: { id: task, type: "task" },
      source: "task_project",
    });
  });

  it("orients each link from the object being looked at", () => {
    expect(orientRelations(task, [contains])).toEqual([
      { relation: contains, direction: "incoming", other: { id: project, type: "project" } },
    ]);
    expect(orientRelations(project, [contains])[0].direction).toBe("outgoing");
  });

  it("drops links that do not touch the object, and duplicates", () => {
    const blocks = toObjectRelation({
      id: null,
      relation_type_key: "blocks",
      from_id: other,
      from_type: "task",
      to_id: task,
      to_type: "task",
      source: "task_dependency",
    });
    const unrelated = { ...blocks, from: { id: other, type: "task" }, to: { id: project, type: "project" } };
    expect(orientRelations(task, [blocks, { ...blocks }, unrelated])).toHaveLength(1);
  });
});

describe("listRelations", () => {
  it("refuses anything but a uuid before building the filter", async () => {
    const { listRelations } = await import("@/features/objects/services/relations");
    const client = { from: () => { throw new Error("must not query"); } };
    await expect(listRelations("x),to_id.neq.(y", client as never)).resolves.toEqual([]);
  });
});
