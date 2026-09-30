import { describe, expect, it } from "vitest";
import {
  createRollupProperty,
  createTwoWayRelation,
  parseRelationOptions,
  parseRollupOptions,
} from "@/features/objects/services/rollups";

describe("relation and rollup options", () => {
  it("reads relation options and refuses incomplete ones", () => {
    expect(parseRelationOptions({ relationTypeKey: "grant_app_tasks", direction: "outgoing", targetTypeKey: "task", pairedKey: "grant" }))
      .toEqual({ relationTypeKey: "grant_app_tasks", direction: "outgoing", targetTypeKey: "task", pairedKey: "grant" });
    expect(parseRelationOptions({ relationTypeKey: "x", direction: "sideways", targetTypeKey: "task" })).toBeNull();
    expect(parseRelationOptions({ direction: "outgoing", targetTypeKey: "task" })).toBeNull();
  });

  it("reads rollup options: count needs no target, the others do", () => {
    expect(parseRollupOptions({ relationProperty: "tasks", targetProperty: null, function: "count" })).toEqual({
      relationProperty: "tasks",
      targetProperty: null,
      function: "count",
    });
    expect(parseRollupOptions({ relationProperty: "tasks", function: "sum" })).toBeNull();
    expect(parseRollupOptions({ relationProperty: "tasks", targetProperty: "estimate", function: "median" })).toBeNull();
  });
});

describe("creating relations and rollups", () => {
  const client = (result: { data: unknown; error: { message: string } | null }) => {
    const calls: { name: string; args: unknown }[] = [];
    return {
      calls,
      rpc: async (name: string, args: unknown) => {
        calls.push({ name, args });
        return result;
      },
    };
  };

  it("sends the two-way relation to the database and returns its id", async () => {
    const fake = client({ data: "rel-1", error: null });
    const result = await createTwoWayRelation(fake as never, {
      fromTypeId: "a",
      toTypeId: "b",
      key: "tasks",
      name: { en: "Tasks", fr: "Tâches" },
      reverseKey: "grant",
      reverseName: { en: "Grant", fr: "Subvention" },
      cardinality: "one_to_many",
    });
    expect(result).toEqual({ ok: true, relationTypeId: "rel-1" });
    expect(fake.calls[0]).toMatchObject({ name: "create_two_way_relation", args: { p_cardinality: "one_to_many", p_reverse_name_fr: "Subvention" } });
  });

  it("refuses bad keys before calling the database, and reports refusals", async () => {
    const fake = client({ data: null, error: { message: "Only owners and admins can add rollups." } });
    expect(
      await createRollupProperty(fake as never, {
        typeId: "t", key: "Bad Key", name: { en: "X", fr: "X" }, relationProperty: "tasks", targetProperty: null, function: "count",
      }),
    ).toEqual({ ok: false, message: "invalid_rollup" });
    expect(fake.calls).toHaveLength(0);
    expect(
      await createRollupProperty(fake as never, {
        typeId: "t", key: "total", name: { en: "X", fr: "X" }, relationProperty: "tasks", targetProperty: "estimate", function: "sum",
      }),
    ).toEqual({ ok: false, message: "Only owners and admins can add rollups." });
  });
});
