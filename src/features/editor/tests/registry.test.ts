import { describe, expect, it } from "vitest";
import { createEditorT, editorEn, editorFrCA, type EditorT } from "@/features/editor/i18n";
import {
  BLOCK_CATEGORIES,
  BLOCK_PERMISSIONS,
  BLOCK_REGISTRY,
  BLOCK_SCHEMA_SOURCES,
  blockDefinition,
  rankSlashItems,
  slashItems,
  textTypes,
  turnIntoTargets,
} from "@/features/editor/registry";
import { buildSchema } from "@/features/editor/adapter/blocknote/editor";
import { HandlersBox } from "@/features/editor/adapter/blocknote/semantic-blocks";

/** A translator that returns the key: the schema only needs strings, not words. */
const stubT: EditorT = (key) => key;

// Words spelled the same in both languages.
const SAME = new Set(["image", "audio"]);

const types = BLOCK_REGISTRY.map((entry) => entry.type);

describe("block registry", () => {
  it("names every block in the built schema, and nothing else", () => {
    const schema = buildSchema(stubT, "en", new HandlersBox(null));
    const schemaTypes = Object.keys(schema.blockSchema).sort();
    expect([...types].sort()).toEqual(schemaTypes);
    expect(new Set(types).size).toBe(types.length);
  });

  it("is frozen", () => {
    expect(Object.isFrozen(BLOCK_REGISTRY)).toBe(true);
    for (const entry of BLOCK_REGISTRY) {
      expect(Object.isFrozen(entry), entry.type).toBe(true);
      expect(Object.isFrozen(entry.label), entry.type).toBe(true);
      expect(Object.isFrozen(entry.turnInto), entry.type).toBe(true);
      expect(Object.isFrozen(entry.shortcuts), entry.type).toBe(true);
    }
  });

  it("names each block after its own dictionary entry", () => {
    for (const { type, label, schemaSource } of BLOCK_REGISTRY) {
      const expected =
        schemaSource === "default"
          ? { en: editorEn.types[type as keyof typeof editorEn.types], fr: editorFrCA.types[type as keyof typeof editorFrCA.types] }
          : schemaSource === "workspace"
            ? {
                en: editorEn.slash[type as "callout" | "bookmark" | "embed"].title,
                fr: editorFrCA.slash[type as "callout" | "bookmark" | "embed"].title,
              }
            : {
                en: editorEn.semantic.items[type as keyof typeof editorEn.semantic.items].title,
                fr: editorFrCA.semantic.items[type as keyof typeof editorFrCA.semantic.items].title,
              };
      expect(label, type).toEqual(expected);
    }
  });

  it("looks a block up by type", () => {
    expect(blockDefinition("callout")?.schemaSource).toBe("workspace");
    expect(blockDefinition("task")?.category).toBe("semantic");
    expect(blockDefinition("sticker")).toBeUndefined();
  });

  it("labels every block in both languages", () => {
    for (const { type, label } of BLOCK_REGISTRY) {
      expect(label.en.trim(), `${type} en`).not.toBe("");
      expect(label.fr.trim(), `${type} fr`).not.toBe("");
      if (!SAME.has(type)) expect(label.fr, `${type} fr differs from en`).not.toBe(label.en);
    }
    // The labels are the dictionaries' own, so the menus and the registry agree.
    expect(blockDefinition("paragraph")?.label).toEqual({ en: editorEn.types.paragraph, fr: editorFrCA.types.paragraph });
    expect(blockDefinition("embed")?.label).toEqual({ en: editorEn.slash.embed.title, fr: editorFrCA.slash.embed.title });
    expect(blockDefinition("query")?.label).toEqual({ en: editorEn.semantic.items.query.title, fr: editorFrCA.semantic.items.query.title });
  });

  it("only points turn-into at registered blocks", () => {
    for (const { type, turnInto } of BLOCK_REGISTRY) {
      for (const target of turnInto) expect(types, `${type} -> ${target}`).toContain(target);
      expect(new Set(turnInto).size, `${type} lists each target once`).toBe(turnInto.length);
    }
  });

  it("uses valid categories, sources and permissions", () => {
    for (const { type, category, schemaSource, permission, icon } of BLOCK_REGISTRY) {
      expect(BLOCK_CATEGORIES, `${type} category`).toContain(category);
      expect(BLOCK_SCHEMA_SOURCES, `${type} source`).toContain(schemaSource);
      expect(BLOCK_PERMISSIONS, `${type} permission`).toContain(permission);
      expect(icon, `${type} icon`).toBeTruthy();
    }
  });
});

describe("derived menus", () => {
  it("keeps the block menu's turn-into list and order", () => {
    const keys = [
      "paragraph",
      "heading1",
      "heading2",
      "heading3",
      "bulletListItem",
      "numberedListItem",
      "checkListItem",
      "toggleListItem",
      "quote",
      "callout",
      "codeBlock",
    ];
    expect(turnIntoTargets().map((target) => target.key)).toEqual(keys);
    // Every text block offers the whole list today; a block with no targets offers none.
    for (const type of textTypes()) expect(turnIntoTargets(type).map((target) => target.key), type).toEqual(keys);
    expect(turnIntoTargets("table")).toEqual([]);
    expect(turnIntoTargets("sticker")).toEqual([]);
    expect(turnIntoTargets().find((target) => target.key === "heading2")?.block).toEqual({ type: "heading", props: { level: 2 } });
    expect(turnIntoTargets().find((target) => target.key === "callout")?.block).toEqual({ type: "callout" });
  });

  it("turns blocks into types and props the schema accepts", () => {
    const schema = buildSchema(stubT, "en", new HandlersBox(null));
    for (const { key, block } of turnIntoTargets()) {
      const spec = schema.blockSchema[block.type as keyof typeof schema.blockSchema] as
        | { propSchema: Record<string, { default: unknown; values?: readonly unknown[] }> }
        | undefined;
      expect(spec, `${key} -> ${block.type}`).toBeDefined();
      for (const [prop, value] of Object.entries(block.props ?? {})) {
        const propSpec = spec!.propSchema[prop];
        expect(propSpec, `${key} prop ${prop}`).toBeDefined();
        if (propSpec.values) expect(propSpec.values, `${key} ${prop}=${value}`).toContain(value);
        else expect(typeof value, `${key} ${prop} type`).toBe(typeof propSpec.default);
      }
    }
  });

  it("translates every turn-into label", () => {
    const fr = createEditorT("fr-CA");
    for (const { labelKey } of turnIntoTargets()) {
      expect(fr(labelKey), labelKey).not.toBe(labelKey);
      expect(editorEn.types).toHaveProperty(labelKey.replace("types.", ""));
    }
  });

  it("offers turn-into on the text blocks only", () => {
    expect([...textTypes()].sort()).toEqual(
      ["paragraph", "heading", "bulletListItem", "numberedListItem", "checkListItem", "toggleListItem", "quote", "callout", "codeBlock"].sort(),
    );
    for (const key of ["table", "image", "task", "query", "divider"]) expect(textTypes().has(key), key).toBe(false);
  });

  it("builds slash items without duplicates, with semantic blocks only when the page has handlers", () => {
    const t = createEditorT("en");
    const editor = {} as never;
    const defaults = [{ title: "Table", key: "table", onItemClick: () => {} }, { title: "Image", key: "image", onItemClick: () => {} }];
    const withSemantic = slashItems(t, editor, { defaults, semantic: true });
    const titles = withSemantic.map((item) => item.title);
    expect(new Set(titles).size).toBe(titles.length);
    expect(titles).toEqual([
      "Table",
      "Image",
      "Callout",
      "Bookmark",
      "Embed",
      "Task",
      "Decision",
      "Person",
      "Status",
      "Task list",
      "Library file",
      "Link to page",
    ]);
    expect(withSemantic.slice(2).every((item) => item.group === "Workspace" && item.icon && item.aliases?.length)).toBe(true);
    // Each string resolved in the dictionary rather than falling back to its key.
    for (const item of withSemantic.slice(2)) {
      expect(item.title, "title").not.toMatch(/^(slash|semantic)\./);
      expect(item.subtext, item.title).not.toMatch(/^(slash|semantic)\./);
      expect(item.aliases?.join(), item.title).not.toMatch(/^(slash|semantic)\./);
    }

    const withoutSemantic = slashItems(t, editor, { semantic: false });
    expect(withoutSemantic.map((item) => item.title)).toEqual(["Callout", "Bookmark", "Embed"]);
  });

  it("speaks Quebec French in the slash menu", () => {
    const titles = slashItems(createEditorT("fr-CA"), {} as never, { semantic: true }).map((item) => item.title);
    expect(titles).toContain("Encadré");
    expect(titles).toContain("Fichier de la bibliothèque");
    expect(new Set(titles).size).toBe(titles.length);
  });

  it("ranks a title match ahead of an alias match", () => {
    const t = createEditorT("en");
    const defaults = [{ title: "File", key: "file", aliases: ["file", "embed"], onItemClick: () => {} }];
    const ranked = rankSlashItems(slashItems(t, {} as never, { defaults, semantic: true }), "embed");
    expect(ranked.map((item) => item.title)).toEqual(["Embed", "File"]);
    expect(rankSlashItems(slashItems(t, {} as never, { defaults, semantic: true }), "zzz")).toEqual([]);
  });
});
