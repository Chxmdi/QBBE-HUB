import { describe, expect, it } from "vitest";
import {
  toObjectRecord,
  toObjectType,
  type ObjectRow,
} from "@/features/objects/services/registry.mappers";

const row: ObjectRow = {
  id: "11111111-1111-1111-1111-111111111111",
  organization_id: "22222222-2222-2222-2222-222222222222",
  space_id: null,
  parent_object_id: "33333333-3333-3333-3333-333333333333",
  title: "Book the hall",
  icon: null,
  cover: null,
  owner_id: null,
  created_by: null,
  created_at: "2026-09-30T12:00:00Z",
  updated_by: null,
  updated_at: "2026-09-30T12:00:00Z",
  archived_at: null,
  deleted_at: null,
  object_type: { key: "task" },
};

describe("object registry mappers", () => {
  it("maps a type row to the contract with both languages", () => {
    expect(
      toObjectType({
        id: "t",
        key: "task",
        name_en: "Task",
        name_fr: "Tâche",
        icon: "check-square",
        kind: "native",
        native_table: "task",
        default_lens: "table",
        default_template_id: null,
      }),
    ).toEqual({
      id: "t",
      key: "task",
      name: { en: "Task", fr: "Tâche" },
      icon: "check-square",
      kind: "native",
      nativeTable: "task",
      defaultLens: "table",
      defaultTemplateId: null,
    });
  });

  it("maps an object row and takes the type key from the join", () => {
    const record = toObjectRecord(row);
    expect(record?.type).toBe("task");
    expect(record?.parentObjectId).toBe(row.parent_object_id);
    expect(record?.organizationId).toBe(row.organization_id);
  });

  it("accepts the join as an array, as PostgREST sometimes returns it", () => {
    expect(toObjectRecord({ ...row, object_type: [{ key: "project" }] })?.type).toBe("project");
  });

  it("refuses a row without a type", () => {
    expect(toObjectRecord({ ...row, object_type: null })).toBeNull();
    expect(toObjectRecord({ ...row, object_type: [] })).toBeNull();
  });
});

describe("object select", () => {
  it("embeds the type through the composite foreign key by name", async () => {
    // `object_type:type_id(key)` fails in PostgREST (PGRST200) because the
    // foreign key is (type_id, organization_id); the constraint name works.
    const { OBJECT_COLUMNS } = await import("@/features/objects/services/registry.mappers");
    expect(OBJECT_COLUMNS).toContain("object_type!object_type_id_organization_id_fkey(key)");
  });
});
