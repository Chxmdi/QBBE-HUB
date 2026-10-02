import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createEditorT, editorEn, editorFrCA } from "@/features/editor/i18n";
import { SHORTCUTS, SHORTCUT_GROUPS, bindingKeys, isMacPlatform, type KeyNames } from "./shortcuts";

const names: KeyNames = { shift: "Shift", escape: "Esc", enter: "Enter", up: "Up", down: "Down", then: "then" };

/**
 * The editor library's own key bindings, read from its source: the general
 * keyboard extension, each block's shortcuts, and the text marks.
 */
function libraryBindings(): Set<string> {
  const root = path.resolve(__dirname, "../../../../../node_modules");
  const files = [
    "@blocknote/core/src/extensions/tiptap-extensions/KeyboardShortcuts/KeyboardShortcutsExtension.ts",
    "@tiptap/extension-bold/src/bold.tsx",
    "@tiptap/extension-italic/src/italic.ts",
    "@tiptap/extension-underline/src/underline.ts",
    "@tiptap/extension-strike/src/strike.ts",
    "@tiptap/extension-code/src/code.ts",
  ].map((file) => path.join(root, file));
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((entry) => {
      const full = path.join(dir, entry);
      return statSync(full).isDirectory() ? walk(full) : full.endsWith("block.ts") ? [full] : [];
    });
  files.push(...walk(path.join(root, "@blocknote/core/src/blocks")));
  const found = new Set<string>();
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/["'`]((?:Mod|Shift|Ctrl|Alt)-[^"'`]+)["'`]\s*:/g)) found.add(match[1]);
    // Headings: `Mod-Alt-${level}` for each level.
    if (source.includes("`Mod-Alt-${level}`")) found.add("Mod-Alt-1…6");
  }
  return found;
}

/** The same shortcut written another way ("Mod-B" and "Mod-b"; "Mod-y" is our "Ctrl-y"). */
function normalize(binding: string): string {
  const parts = binding.split("-");
  const key = parts.pop()!;
  const mods = parts.map((part) => (part === "Ctrl" ? "Mod" : part)).sort();
  return [...mods, key.length === 1 ? key.toLowerCase() : key].join("-");
}

/**
 * Bindings every text box has and that the dialog leaves out: Enter, the
 * deletion keys, and the Mac text-navigation keys.
 */
const PLAIN_EDITING = new Set(["Mod-Enter", "Mod-Backspace", "Shift-Backspace", "Mod-Delete", "Alt-Backspace", "Alt-Delete", "Ctrl-Alt-Backspace", "Ctrl-h", "Ctrl-d", "Alt-d", "Ctrl-a", "Ctrl-e"].map(normalize));

describe("the keyboard shortcuts list (E2-4)", () => {
  it("lists every shortcut the editor library binds", () => {
    const listed = new Set(SHORTCUTS.flatMap((shortcut) => shortcut.bindings.map(normalize)));
    const library = [...libraryBindings()];
    // The reading found the bindings it should.
    expect(library).toEqual(expect.arrayContaining(["Mod-z", "Shift-Mod-z", "Mod-b", "Mod-Shift-8", "Mod-Alt-q", "Mod-Alt-1…6"]));
    const missing = library.map(normalize).filter((binding) => !listed.has(binding) && !PLAIN_EDITING.has(binding));
    expect(missing).toEqual([]);
  });

  it("lists the editor's own keys: undo, redo, the block menu, moves, the toolbar, leaving and this list", () => {
    const bindings = SHORTCUTS.flatMap((shortcut) => shortcut.bindings);
    for (const binding of ["Mod-z", "Shift-Mod-z", "Ctrl-y", "Mod-/", "Alt-ArrowUp", "Shift-ArrowDown", "Alt-F10", "Escape Tab", "?", "/"]) {
      expect(bindings).toContain(binding);
    }
    expect(new Set(SHORTCUTS.map((shortcut) => shortcut.id)).size).toBe(SHORTCUTS.length);
  });

  it("names every shortcut and group in English and in Québec French", () => {
    const en = createEditorT("en");
    const fr = createEditorT("fr-CA");
    for (const shortcut of SHORTCUTS) {
      const key = `units.e2.shortcuts.items.${shortcut.id}` as const;
      expect(en(key)).not.toBe(key);
      expect(fr(key)).not.toBe(key);
      expect(SHORTCUT_GROUPS).toContain(shortcut.group);
    }
    for (const group of SHORTCUT_GROUPS) {
      expect(en(`units.e2.shortcuts.groups.${group}`)).not.toContain("units.");
      expect(fr(`units.e2.shortcuts.groups.${group}`)).not.toContain("units.");
    }
    expect(Object.keys(editorFrCA.units.e2.shortcuts.items).sort()).toEqual(Object.keys(editorEn.units.e2.shortcuts.items).sort());
    expect(Object.keys(editorEn.units.e2.shortcuts.items).sort()).toEqual(SHORTCUTS.map((shortcut) => shortcut.id).sort());
    expect(fr("units.e2.toolbar.undo")).toBe("Annuler");
    // Its spoken name starts with the visible word but is not the « Annuler » of a cancel button.
    expect(fr("units.e2.toolbar.undoName")).toBe("Annuler la dernière modification");
    expect(en("units.e2.toolbar.undoName")).toBe("Undo");
    expect(fr("units.e2.toolbar.redo")).toBe("Rétablir");
    expect(fr("units.e2.announce.nothingToUndo")).toBe("Rien d’autre à annuler");
    expect(en("units.e2.announce.nothingToUndo")).toBe("Nothing more to undo");
  });

  it("shows the keys for the platform", () => {
    expect(bindingKeys("Mod-z", false, names)).toEqual(["Ctrl", "Z"]);
    expect(bindingKeys("Shift-Mod-z", false, names)).toEqual(["Shift", "Ctrl", "Z"]);
    expect(bindingKeys("Shift-Mod-z", true, names)).toEqual(["⇧", "⌘", "Z"]);
    expect(bindingKeys("Ctrl-y", true, names)).toEqual(["⌃", "Y"]);
    expect(bindingKeys("Alt-ArrowUp", false, names)).toEqual(["Alt", "Up"]);
    expect(bindingKeys("Mod-/", false, names)).toEqual(["Ctrl", "/"]);
    expect(bindingKeys("?", false, names)).toEqual(["?"]);
    expect(bindingKeys("Escape Tab", false, names)).toEqual(["Esc", "then", "Tab"]);
    expect(bindingKeys("Mod-Alt-1…6", false, names)).toEqual(["Ctrl", "Alt", "1…6"]);
    expect(isMacPlatform("MacIntel")).toBe(true);
    expect(isMacPlatform("Win32")).toBe(false);
    expect(isMacPlatform(undefined)).toBe(false);
  });
});
