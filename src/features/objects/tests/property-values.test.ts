import { describe, expect, it } from "vitest";
import type { PropertyValue } from "@/lib/objects/contracts";
import { taskSystemProperties } from "@/lib/objects/stubs";
import {
  decodePropertyValue,
  encodePropertyValue,
  isWritableKind,
  toPropertyDefinition,
} from "@/features/objects/services/property-values";

const roundTrips: PropertyValue[] = [
  { kind: "text", value: "B-12" },
  { kind: "url", value: "https://qbbe.ca" },
  { kind: "select", value: "high" },
  { kind: "number", value: 4.5 },
  { kind: "currency", value: 4200 },
  { kind: "checkbox", value: false },
  { kind: "date", value: "2026-10-01" },
  { kind: "date_range", value: { start: "2026-10-01", end: "2026-10-05" } },
  { kind: "date_range", value: { start: "2026-10-01", end: null } },
  { kind: "multi_select", value: ["food", "youth"] },
  { kind: "person", value: ["11111111-1111-1111-1111-111111111111"] },
  { kind: "location", value: { lat: 45.5, lng: -73.6, label: "Montréal" } },
];

describe("property values", () => {
  it.each(roundTrips)("round-trips $kind through the typed columns", (value) => {
    expect(decodePropertyValue(value.kind, encodePropertyValue(value))).toEqual(value);
  });

  it("fills exactly one column family per kind", () => {
    const columns = encodePropertyValue({ kind: "number", value: 3 });
    expect(columns).toMatchObject({ value_number: 3, value_text: null, value_json: null });
  });

  it("refuses kinds that are not stored in property_value", () => {
    expect(() => encodePropertyValue({ kind: "relation", value: [] })).toThrow();
    expect(() => encodePropertyValue({ kind: "rollup", value: 1 })).toThrow();
    expect(() => encodePropertyValue({ kind: "number", value: Number.NaN })).toThrow();
  });

  it("reads an empty row as no value, and PostgREST numeric strings as numbers", () => {
    expect(decodePropertyValue("text", {})).toBeNull();
    expect(decodePropertyValue("number", { value_number: "12.50" as unknown as number })).toEqual({
      kind: "number",
      value: 12.5,
    });
    expect(decodePropertyValue("multi_select", { value_json: "not a list" })).toBeNull();
  });

  it("marks computed kinds as not writable", () => {
    expect(isWritableKind("rollup")).toBe(false);
    expect(isWritableKind("created_time")).toBe(false);
    expect(isWritableKind("text")).toBe(true);
  });

  it("maps a definition row, keeping both languages and privacy", () => {
    expect(
      toPropertyDefinition({
        id: "p",
        type_id: "t",
        key: "cost",
        name_en: "Cost",
        name_fr: "Coût",
        kind: "currency",
        options: null,
        system_column: null,
        visible_to_roles: ["owner", "admin"],
        position: 3,
      }),
    ).toMatchObject({ name: { en: "Cost", fr: "Coût" }, options: {}, visibleToRoles: ["owner", "admin"] });
  });

  it("covers every task property the query stand-in knows", () => {
    // The SQL seed (20261101010400, 20261101010700) and objects-properties.sql
    // hold the full list; the stand-in's keys must all be in it.
    const seeded = [
      "approver", "assignee", "blocked_reason", "completed_time", "completion_criteria",
      "created_by", "created_time", "due", "edited_time", "estimate", "milestone", "priority",
      "program", "project", "requester", "reviewer", "start", "status", "title",
    ];
    expect(Object.keys(taskSystemProperties).filter((key) => !seeded.includes(key))).toEqual([]);
  });
});

describe("values that do not fit their kind are refused before they are stored", () => {
  it("refuses a date that is not a day, with a sentence rather than Postgres's wording", () => {
    for (const value of ["2026-02-31", "2026-13-01", "tomorrow", 20261003]) {
      expect(() => encodePropertyValue({ kind: "date", value } as never), String(value)).toThrow("Enter the date as YYYY-MM-DD.");
    }
    expect(encodePropertyValue({ kind: "date", value: "2028-02-29" }).value_date).toBe("2028-02-29");
  });

  it("checks both ends of a date range and their order", () => {
    expect(() => encodePropertyValue({ kind: "date_range", value: { start: "2026-02-30", end: null } })).toThrow("YYYY-MM-DD");
    expect(() => encodePropertyValue({ kind: "date_range", value: { start: "2026-03-01", end: "2026-04-31" } })).toThrow("YYYY-MM-DD");
    expect(() => encodePropertyValue({ kind: "date_range", value: { start: "2026-03-05", end: "2026-03-01" } })).toThrow("on or after");
    expect(encodePropertyValue({ kind: "date_range", value: { start: "2026-03-01", end: "2026-03-05" } })).toMatchObject({
      value_date: "2026-03-01",
      value_date_end: "2026-03-05",
    });
  });

  it("refuses text and checkbox values of the wrong type", () => {
    expect(() => encodePropertyValue({ kind: "text", value: 42 } as never)).toThrow("text");
    expect(() => encodePropertyValue({ kind: "checkbox", value: "yes" } as never)).toThrow("true or false");
  });
});
