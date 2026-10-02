import { describe, expect, it } from "vitest";
import { localFiltersKey, mergeLocalFilters, readLocalFilters, setLocalFilter, writeLocalFilters, type LocalFilter } from "./local-filters";

function fakeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

const me: LocalFilter = { path: "assignee", op: "contains", value: { relative: "me" } };
const ready: LocalFilter = { path: "status", op: "is", value: "ready" };

describe("page-local filters", () => {
  it("merge after the block's conditions, only on allowed properties, one per property", () => {
    const where = [{ path: "title", op: "starts_with" as const, value: "Run" }];
    const merged = mergeLocalFilters(where, [ready, me, { path: "status", op: "is", value: "blocked" }], ["status"]);
    expect(merged).toEqual([
      { path: "title", op: "starts_with", value: "Run" },
      { path: "status", op: "is", value: "blocked" },
    ]);
    expect(mergeLocalFilters(where, [me], [])).toEqual(where);
  });

  it("never change their inputs", () => {
    const where = [{ path: "title", op: "starts_with" as const, value: "Run" }];
    const local = [{ ...me, value: { relative: "me" } }];
    const merged = mergeLocalFilters(where, local, ["assignee"]);
    merged[0].value = "changed";
    merged[1].value = "changed";
    expect(where[0].value).toBe("Run");
    expect(local[0].value).toEqual({ relative: "me" });
  });

  it("round-trip through storage under the block id and tolerate bad data", () => {
    const storage = fakeStorage();
    writeLocalFilters(storage, "block-1", [me, ready]);
    expect(storage.map.has(localFiltersKey("block-1"))).toBe(true);
    expect(readLocalFilters(storage, "block-1")).toEqual([me, ready]);
    expect(readLocalFilters(storage, "block-2")).toEqual([]);
    writeLocalFilters(storage, "block-1", []);
    expect(storage.map.has(localFiltersKey("block-1"))).toBe(false);

    expect(readLocalFilters(fakeStorage({ [localFiltersKey("b")]: "{nope" }), "b")).toEqual([]);
    expect(readLocalFilters(fakeStorage({ [localFiltersKey("b")]: '{"path":"x"}' }), "b")).toEqual([]);
    expect(readLocalFilters(fakeStorage({ [localFiltersKey("b")]: '[{"path":"status","op":"matches"}]' }), "b")).toEqual([]);
    expect(readLocalFilters(null, "b")).toEqual([]);
    expect(readLocalFilters(storage, "")).toEqual([]);
    const refusing = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => {} };
    expect(readLocalFilters(refusing, "b")).toEqual([]);
    expect(() => writeLocalFilters(refusing, "b", [me])).not.toThrow();
  });

  it("replace or clear one property's filter", () => {
    expect(setLocalFilter([me, ready], "status", { path: "status", op: "is", value: "blocked" })).toEqual([me, { path: "status", op: "is", value: "blocked" }]);
    expect(setLocalFilter([me, ready], "status", null)).toEqual([me]);
    expect(setLocalFilter([], "status", ready)).toEqual([ready]);
  });
});
