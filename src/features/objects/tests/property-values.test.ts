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

  it("uses the same task system property keys as the query stand-in", () => {
    // The SQL seed (20261101010400) and objects-properties.sql assert the same list.
    expect(Object.keys(taskSystemProperties).sort()).toEqual([
      "assignee", "completed_time", "created_by", "created_time", "due", "edited_time",
      "estimate", "priority", "program", "project", "requester", "reviewer", "start",
      "status", "title",
    ]);
  });
});
