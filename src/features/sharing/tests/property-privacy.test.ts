import { describe, expect, it, vi } from "vitest";
import type { QueryResult, QuerySpec } from "@/lib/objects/contracts";
import {
  applyPrivacyToSpec,
  dropHiddenValues,
  hiddenKeysFromDatabase,
  HiddenPropertyError,
  keysUsedToSelect,
  PropertyPrivacyUnavailableError,
  withPropertyPrivacy,
} from "../services/property-privacy";

const hidden = new Set(["gift_amount", "health_notes"]);

const base: QuerySpec = { version: 1, types: ["donor"], properties: ["name", "gift_amount", "city"] };

const result: QueryResult = {
  rows: [
    {
      ref: { id: "1", type: "donor" },
      title: "A",
      values: { name: { kind: "text", value: "A" }, gift_amount: { kind: "currency", value: 500 }, city: null },
    },
  ],
  nextCursor: null,
};

describe("keysUsedToSelect", () => {
  it("collects keys from nested filters, sorts, and the grouping, through relations", () => {
    const keys = keysUsedToSelect({
      ...base,
      filter: { and: [{ property: "city", op: "eq", value: "Montréal" }, { or: [{ property: { via: ["gift"], property: "gift_amount" }, op: "gt", value: 1 }] }] },
      sorts: [{ property: "name", direction: "asc" }],
      groupBy: "status",
    });
    expect([...keys].sort()).toEqual(["city", "gift_amount", "name", "status"]);
  });
});

describe("applyPrivacyToSpec", () => {
  it("drops hidden keys from what is asked for", () => {
    expect(applyPrivacyToSpec(base, hidden).properties).toEqual(["name", "city"]);
  });

  it.each([
    ["filter", { filter: { property: "gift_amount", op: "gt", value: 100 } }],
    ["filter through a relation", { filter: { and: [{ property: { via: ["x"], property: "health_notes" }, op: "is_not_empty" }] } }],
    ["sort", { sorts: [{ property: "gift_amount", direction: "desc" }] }],
    ["group", { groupBy: "health_notes" }],
  ] as const)("refuses to %s by a hidden property", (_label, extra) => {
    expect(() => applyPrivacyToSpec({ ...base, ...(extra as Partial<QuerySpec>) }, hidden)).toThrow(HiddenPropertyError);
  });

  it("leaves a spec with nothing hidden as it is", () => {
    expect(applyPrivacyToSpec(base, new Set())).toBe(base);
  });
});

describe("dropHiddenValues", () => {
  it("removes hidden values from every row and keeps the rest", () => {
    expect(Object.keys(dropHiddenValues(result, hidden).rows[0].values)).toEqual(["name", "city"]);
  });
});

describe("withPropertyPrivacy", () => {
  it("asks the runner only for visible keys and strips anything it returns anyway", async () => {
    const run = vi.fn(async () => result);
    const safe = withPropertyPrivacy(run, async () => hidden);
    const out = await safe(base);
    expect(run).toHaveBeenCalledWith({ ...base, properties: ["name", "city"] });
    expect(out.rows[0].values).not.toHaveProperty("gift_amount");
  });

  it("does not run a query that selects by a hidden property", async () => {
    const run = vi.fn(async () => result);
    const safe = withPropertyPrivacy(run, async () => hidden);
    await expect(safe({ ...base, sorts: [{ property: "gift_amount", direction: "asc" }] })).rejects.toThrow(HiddenPropertyError);
    expect(run).not.toHaveBeenCalled();
  });
});

describe("hiddenKeysFromDatabase", () => {
  it("unions the keys of every type, asking once per type", async () => {
    const rpc = vi.fn(async (_fn: "hidden_property_keys", args: { type_key: string }) => ({
      data: args.type_key === "donor" ? ["gift_amount"] : ["salary"],
      error: null,
    }));
    const keys = await hiddenKeysFromDatabase({ rpc })(["donor", "person", "donor"]);
    expect([...keys].sort()).toEqual(["gift_amount", "salary"]);
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("fails closed when the database cannot answer", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { message: "boom" } }));
    await expect(hiddenKeysFromDatabase({ rpc })(["donor"])).rejects.toThrow(PropertyPrivacyUnavailableError);
  });
});
