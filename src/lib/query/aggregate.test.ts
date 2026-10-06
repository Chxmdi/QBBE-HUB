import { describe, expect, it, vi } from "vitest";
import { AGGREGATE_LIMITS, measureId, parseMeasures, runLensAggregate } from "./aggregate";
import { QueryError } from "./errors";

const spec = { version: 1, type: "task" } as const;

function clientReturning(data: unknown, error: { message?: string } | null = null) {
  const rpc = vi.fn(async () => ({ data, error }));
  return { client: { rpc }, rpc };
}

describe("parseMeasures", () => {
  it("accepts a row count and property totals", () => {
    expect(
      parseMeasures([{ fn: "count" }, { fn: "sum", property: "estimate" }, { fn: "count_empty", property: "project" }]),
    ).toHaveLength(3);
  });

  it.each([
    ["no totals", []],
    ["not an array", { fn: "count" }],
    ["an unknown total", [{ fn: "median", property: "estimate" }]],
    ["a row count with a property", [{ fn: "count", property: "estimate" }]],
    ["a sum without a property", [{ fn: "sum" }]],
    ["an empty property", [{ fn: "sum", property: "" }]],
    ["an extra key", [{ fn: "count", extra: 1 }]],
    ["too many totals", Array.from({ length: AGGREGATE_LIMITS.maxMeasures + 1 }, () => ({ fn: "count" }))],
  ])("refuses %s", (_label, input) => {
    expect(() => parseMeasures(input)).toThrow(QueryError);
  });

  it("accepts exactly the maximum", () => {
    expect(parseMeasures(Array.from({ length: AGGREGATE_LIMITS.maxMeasures }, () => ({ fn: "count" })))).toHaveLength(20);
  });
});

describe("runLensAggregate", () => {
  it("calls lens_aggregate with the parsed spec, measures and the viewer's time zone", async () => {
    const { client, rpc } = clientReturning({
      type: "task",
      measures: [{ id: "m0", fn: "count", property: null }],
      totals: { m0: 4 },
      groupBy: null,
      groups: null,
    });
    const result = await runLensAggregate(client, spec, [{ fn: "count" }], { timeZone: "America/Vancouver" });
    expect(rpc).toHaveBeenCalledWith("lens_aggregate", {
      spec,
      measures: [{ fn: "count" }],
      time_zone: "America/Vancouver",
    });
    expect(result.totals[measureId(0)]).toBe(4);
    expect(result.groups).toBeNull();
  });

  it("defaults missing totals and groups", async () => {
    const { client } = clientReturning({ type: "task", measures: [], groupBy: null });
    const result = await runLensAggregate(client, spec, [{ fn: "count" }]);
    expect(result.totals).toEqual({});
    expect(result.groups).toBeNull();
  });

  it("maps an engine refusal to its code", async () => {
    const { client } = clientReturning(null, { message: 'lens:invalid_spec: "title" is not a number.' });
    await expect(runLensAggregate(client, spec, [{ fn: "sum", property: "title" }])).rejects.toMatchObject({
      code: "invalid_spec",
    });
  });

  it("maps an unknown failure to failed", async () => {
    const { client } = clientReturning(null, { message: "connection reset" });
    await expect(runLensAggregate(client, spec, [{ fn: "count" }])).rejects.toMatchObject({ code: "failed" });
  });

  it("refuses a bad spec before calling the database", async () => {
    const { client, rpc } = clientReturning({});
    await expect(runLensAggregate(client, { version: 9 }, [{ fn: "count" }])).rejects.toBeInstanceOf(QueryError);
    await expect(runLensAggregate(client, spec, [])).rejects.toBeInstanceOf(QueryError);
    expect(rpc).not.toHaveBeenCalled();
  });
});
