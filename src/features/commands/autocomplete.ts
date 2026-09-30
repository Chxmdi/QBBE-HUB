import { COMMAND_KINDS, STATUS_LABELS, TEMPLATES, VERBS, fold, type CommandKind, type CommandLocale } from "./grammar";
import { parseCommand, type CommandSlot } from "./parse";

/** Names autocomplete can offer, already limited to what the viewer can see. */
export interface CommandCatalog {
  tasks: { id: string; title: string }[];
  people: { id: string; name: string }[];
  spaces: { id: string; name: string }[];
  objects: { id: string; title: string; type: string; href: string }[];
}

export const emptyCatalog: CommandCatalog = { tasks: [], people: [], spaces: [], objects: [] };

export interface Suggestion {
  /** What the list shows. */
  label: string;
  /** The whole input after choosing it. */
  value: string;
  kind: "command" | CommandSlot;
}

const LIMIT = 8;

/**
 * How well `name` matches what was typed, lower is better; null for no match.
 * Exact, then prefix, then the start of a later word, then anywhere.
 */
export function matchRank(name: string, typed: string): number | null {
  const n = fold(name);
  const q = fold(typed).trim();
  if (!q) return 3;
  if (n === q) return 0;
  if (n.startsWith(q)) return 1;
  if (n.split(/[\s\-_/]+/).some((word) => word.startsWith(q))) return 2;
  if (n.includes(q)) return 3;
  return null;
}

/** Best matches first; ties in alphabetical order, so the list never shuffles. */
export function rankNames<T>(items: T[], name: (item: T) => string, typed: string, limit = LIMIT): T[] {
  return items
    .map((item) => ({ item, rank: matchRank(name(item), typed) }))
    .filter((entry): entry is { item: T; rank: number } => entry.rank !== null)
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        fold(name(a.item)).localeCompare(fold(name(b.item))) ||
        name(a.item).localeCompare(name(b.item)),
    )
    .slice(0, limit)
    .map((entry) => entry.item);
}

const OPEN_QUOTE: Record<CommandLocale, string> = { en: '"', "fr-CA": "« " };
const CLOSE_QUOTE: Record<CommandLocale, string> = { en: '"', "fr-CA": " »" };
const TO: Record<CommandLocale, string> = { en: "to", "fr-CA": "à" };
const BECAUSE: Record<CommandLocale, string> = { en: "because", "fr-CA": "parce que" };

function verbText(kind: CommandKind, locale: CommandLocale): string {
  return TEMPLATES[kind][locale];
}

/**
 * Suggestions for what is typed so far. Deterministic: the same text and
 * catalogue always give the same list in the same order.
 */
export function suggest(input: string, catalog: CommandCatalog, locale: CommandLocale): Suggestion[] {
  const typed = input.normalize("NFC").replace(/^\s+/, "");
  const parsed = parseCommand(typed);
  const other: CommandLocale = locale === "en" ? "fr-CA" : "en";

  // No command yet: offer the commands whose words start with what is typed,
  // in the viewer's language first.
  if (!parsed.ok && (parsed.reason === "empty" || parsed.reason === "unknown")) {
    const q = fold(typed);
    const seen = new Set<string>();
    const out: Suggestion[] = [];
    for (const lang of [locale, other]) {
      for (const kind of COMMAND_KINDS) {
        const hit = VERBS[kind][lang].some((verb) => verb.startsWith(q) || (q.length > 0 && q.startsWith(verb)));
        const template = verbText(kind, lang);
        if (hit && !seen.has(kind)) {
          seen.add(kind);
          out.push({ label: template.replace(/["«]\s*$/, "").trim(), value: template, kind: "command" });
        }
      }
    }
    return out.slice(0, LIMIT);
  }

  // Which slot is being typed. A command that already parses can still be
  // mid-name in its last slot ("assign "x" to Ad"), so that slot stays open.
  let state: { kind: CommandKind; locale: CommandLocale; slot: CommandSlot; partial: string } | null = null;
  if (parsed.ok) {
    const { command } = parsed;
    const at = (slot: CommandSlot, partial: string) => ({ kind: command.kind, locale: parsed.locale, slot, partial });
    if (command.kind === "assign_task") state = at("person", command.person);
    else if (command.kind === "add_to_space") state = at("space", command.space);
    else if (command.kind === "open") state = at("target", command.target);
    else if (command.kind === "create_project" && command.space !== null) state = at("space", command.space);
  } else if (parsed.reason === "incomplete" || parsed.reason === "unknown_status") {
    state = parsed;
  }
  if (!state) return [];

  const lang = state.locale;
  const partial = state.partial;
  // Where the slot's text starts in what was typed (the parser trims quotes
  // and spaces, so it is found rather than assumed to end the input).
  const at = partial ? fold(typed).lastIndexOf(fold(partial)) : -1;
  const before = at >= 0 ? typed.slice(0, at) : typed;
  const prefix = before.replace(/[«"“]\s*$/, "");
  const head = (value: string) => `${prefix}${prefix && !/\s$/.test(prefix) ? " " : ""}${value}`;

  switch (state.slot) {
    case "task": {
      const base = before.replace(/\s*[«"“]\s*$/, "").trimEnd();
      return rankNames(catalog.tasks, (task) => task.title, partial).map((task) => ({
        label: task.title,
        value: `${base} ${OPEN_QUOTE[lang]}${task.title}${CLOSE_QUOTE[lang]} ${TO[lang]} `,
        kind: "task",
      }));
    }
    case "person": {
      const joiner = state.kind === "add_to_space" ? ` ${TO[lang]} ` : "";
      return rankNames(catalog.people, (person) => person.name, partial).map((person) => ({
        label: person.name,
        value: head(`${person.name}${joiner}`),
        kind: "person",
      }));
    }
    case "space":
      return rankNames(catalog.spaces, (space) => space.name, partial).map((space) => ({
        label: space.name,
        value: head(space.name),
        kind: "space",
      }));
    case "status":
      return rankNames(
        Object.values(STATUS_LABELS).map((labels) => labels[lang]),
        (label) => label,
        partial,
      ).map((label) => ({
        label,
        value: head(label === STATUS_LABELS.blocked[lang] ? `${label} ${BECAUSE[lang]} ` : label),
        kind: "status",
      }));
    case "target":
      return rankNames(catalog.objects, (object) => object.title, partial).map((object) => ({
        label: object.title,
        value: head(object.title),
        kind: "target",
      }));
    case "name":
      // A new project's name is free text; offer the optional space once typed.
      return partial
        ? []
        : [];
    case "reason":
      return [];
  }
}
