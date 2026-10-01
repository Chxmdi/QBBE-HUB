import { describe, expect, it } from "vitest";
import { invertChanges } from "./changes";

const ref = { id: "22222222-2222-2222-2222-222222222222", type: "task" };
const project = { id: "33333333-3333-3333-3333-333333333333", type: "project" };

describe("invertChanges", () => {
  it("inverts every kind of change, last change first", () => {
    const relation = { relationTypeKey: "blocks", from: ref, to: project };
    expect(
      invertChanges([
        { kind: "create", object: ref, values: { title: "x" } },
        { kind: "link", relation },
        { kind: "unlink", relation },
        { kind: "delete", object: ref, values: { title: "x" } },
      ]),
    ).toEqual([
      { kind: "create", object: ref, values: { title: "x" } },
      { kind: "link", relation },
      { kind: "unlink", relation },
      { kind: "delete", object: ref, values: { title: "x" } },
    ]);
  });

  it("swaps before and after on an update", () => {
    expect(invertChanges([{ kind: "update", object: ref, property: "status", before: "a", after: "b" }])).toEqual([
      { kind: "update", object: ref, property: "status", before: "b", after: "a" },
    ]);
  });
});
