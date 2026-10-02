/**
 * Every keyboard shortcut the block editor supports, for the shortcuts dialog
 * (wave 2, E2). `bindings` are in the editor library's notation ("Mod" is
 * Ctrl, or Cmd on a Mac); the shortcuts test checks this list against the
 * library's own key bindings, so a shortcut it gains or loses shows up here.
 * Each entry's label is read as t("units.e2.shortcuts.items.<id>").
 */

export type ShortcutGroup = "history" | "format" | "blocks" | "move" | "help";

export interface Shortcut {
  id: string;
  group: ShortcutGroup;
  /** Each way to press it; shown joined by "or". */
  bindings: readonly string[];
}

export const SHORTCUT_GROUPS: readonly ShortcutGroup[] = ["history", "format", "blocks", "move", "help"];

export const SHORTCUTS = [
  { id: "undo", group: "history", bindings: ["Mod-z"] },
  { id: "redo", group: "history", bindings: ["Shift-Mod-z", "Ctrl-y"] },

  { id: "bold", group: "format", bindings: ["Mod-b"] },
  { id: "italic", group: "format", bindings: ["Mod-i"] },
  { id: "underline", group: "format", bindings: ["Mod-u"] },
  { id: "strike", group: "format", bindings: ["Mod-Shift-s"] },
  { id: "code", group: "format", bindings: ["Mod-e"] },
  { id: "lineBreak", group: "format", bindings: ["Shift-Enter"] },
  { id: "selectAll", group: "format", bindings: ["Mod-a"] },

  { id: "slash", group: "blocks", bindings: ["/"] },
  { id: "blockMenu", group: "blocks", bindings: ["Mod-/"] },
  { id: "paragraph", group: "blocks", bindings: ["Mod-Alt-0"] },
  { id: "heading", group: "blocks", bindings: ["Mod-Alt-1…6"] },
  { id: "numbered", group: "blocks", bindings: ["Mod-Shift-7"] },
  { id: "bullet", group: "blocks", bindings: ["Mod-Shift-8"] },
  { id: "checklist", group: "blocks", bindings: ["Mod-Shift-9"] },
  { id: "toggle", group: "blocks", bindings: ["Mod-Shift-6"] },
  { id: "quote", group: "blocks", bindings: ["Mod-Alt-q"] },
  { id: "nest", group: "blocks", bindings: ["Tab"] },
  { id: "unnest", group: "blocks", bindings: ["Shift-Tab"] },

  { id: "moveBlock", group: "move", bindings: ["Shift-Mod-ArrowUp", "Shift-Mod-ArrowDown"] },
  { id: "moveSelection", group: "move", bindings: ["Alt-ArrowUp", "Alt-ArrowDown"] },
  { id: "selectBlocks", group: "move", bindings: ["Shift-ArrowUp", "Shift-ArrowDown"] },
  { id: "toolbar", group: "move", bindings: ["Alt-F10"] },
  { id: "leave", group: "move", bindings: ["Escape Tab"] },

  { id: "shortcuts", group: "help", bindings: ["?"] },
] as const satisfies readonly Shortcut[];

export type ShortcutId = (typeof SHORTCUTS)[number]["id"];

/** Whether this browser runs on a Mac (Cmd instead of Ctrl, ⌥ for Alt). */
export function isMacPlatform(platform: string | undefined): boolean {
  return /Mac|iPhone|iPad|iPod/i.test(platform ?? "");
}

/** The key names that change with the language (Ctrl and Alt read the same in both). */
export interface KeyNames {
  shift: string;
  escape: string;
  enter: string;
  up: string;
  down: string;
  then: string;
}

/**
 * The keys of one binding, as they are shown: ["Ctrl", "Shift", "Z"] on
 * Windows, ["⌘", "⇧", "Z"] on a Mac. "Escape Tab" (a sequence) becomes
 * ["Esc", "then", "Tab"].
 */
export function bindingKeys(binding: string, mac: boolean, names: KeyNames): string[] {
  if (binding.includes(" ")) {
    return binding
      .split(" ")
      .flatMap((part, index) => (index === 0 ? bindingKeys(part, mac, names) : [names.then, ...bindingKeys(part, mac, names)]));
  }
  if (binding.length === 1 || binding === "-") return [binding];
  return binding.split("-").map((part) => {
    switch (part) {
      case "Mod":
        return mac ? "⌘" : "Ctrl";
      case "Ctrl":
        return mac ? "⌃" : "Ctrl";
      case "Shift":
        return mac ? "⇧" : names.shift;
      case "Alt":
        return mac ? "⌥" : "Alt";
      case "Escape":
        return names.escape;
      case "Enter":
        return names.enter;
      case "ArrowUp":
        return names.up;
      case "ArrowDown":
        return names.down;
      default:
        return part.length === 1 ? part.toUpperCase() : part;
    }
  });
}
