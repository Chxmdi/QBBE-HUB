import { describe, expect, it } from "vitest";
import { groupRelated, type RelationTypeNames } from "@/features/objects/services/related";
import { orientRelations, toObjectRelation } from "@/features/objects/services/relations";

const PROJECT = "11111111-1111-1111-1111-111111111111";
const TASK_A = "22222222-2222-2222-2222-222222222222";
const TASK_B = "33333333-3333-3333-3333-333333333333";
const SECRET = "44444444-4444-4444-4444-444444444444";

const names = new Map<string, RelationTypeNames>([
  ["contains", { name: { en: "Contains", fr: "Contient" }, reverseName: { en: "Is in", fr: "Fait partie de" } }],
  ["blocks", { name: { en: "Blocks", fr: "Bloque" }, reverseName: { en: "Is blocked by", fr: "Est bloqué par" } }],
]);

const row = (key: string, from: string, fromType: string, to: string, toType: string, source = "task_project") =>
  toObjectRelation({ id: null, relation_type_key: key, from_id: from, from_type: fromType, to_id: to, to_type: toType, source: source as never });

describe("Related panel grouping", () => {
  const relations = orientRelations(TASK_A, [
    row("contains", PROJECT, "project", TASK_A, "task"),
    row("blocks", TASK_A, "task", TASK_B, "task", "task_dependency"),
    row("blocks", SECRET, "task", TASK_A, "task", "task_dependency"),
  ]);
  const others = new Map([
    [PROJECT, { title: "Harvest dinner", archived: false }],
    [TASK_B, { title: "  ", archived: true }],
  ]);

  it("groups by relation and direction, named in the viewer's language", () => {
    const data = groupRelated(relations, others, names, "en", "Untitled");
    expect(data.groups.map((group) => [group.key, group.label])).toEqual([
      ["blocks:outgoing", "Blocks"],
      ["contains:incoming", "Is in"],
    ]);
    expect(groupRelated(relations, others, names, "fr-CA", "Sans titre").groups.map((g) => g.label)).toEqual([
      "Bloque",
      "Fait partie de",
    ]);
  });

  it("counts links to items the viewer cannot see as hidden, never shows them", () => {
    const data = groupRelated(relations, others, names, "en", "Untitled");
    expect(data.total).toBe(2);
    expect(data.hidden).toBe(1);
    expect(JSON.stringify(data)).not.toContain(SECRET);
  });

  it("names untitled items and marks archived ones and native links", () => {
    const data = groupRelated(relations, others, names, "en", "Untitled");
    expect(data.groups[0].items[0]).toEqual({ id: TASK_B, type: "task", title: "Untitled", archived: true, stored: false });
  });

  it("falls back to the key for an unknown relation type, and is empty with no links", () => {
    const custom = orientRelations(TASK_A, [row("funds", TASK_A, "task", PROJECT, "project", "object_relation")]);
    const data = groupRelated(custom, others, new Map(), "en", "Untitled");
    expect(data.groups[0]).toMatchObject({ label: "funds", items: [{ stored: true }] });
    expect(groupRelated([], others, names, "en", "Untitled")).toEqual({ groups: [], total: 0, hidden: 0 });
  });
});
