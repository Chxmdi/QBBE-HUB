import type { TaskStatus } from "@/types/entities";
import {
  JOINERS,
  STATUS_WORDS,
  VERBS,
  fold,
  type CommandKind,
  type CommandLocale,
} from "./grammar";

export type ParsedCommand =
  | { kind: "create_project"; name: string; space: string | null }
  | { kind: "assign_task"; task: string; person: string }
  | { kind: "move_task"; task: string; status: TaskStatus; reason: string | null }
  | { kind: "show_blocked" }
  | { kind: "open"; target: string }
  | { kind: "add_to_space"; person: string; space: string };

/** The part of a command still to be typed, for autocomplete and messages. */
export type CommandSlot = "name" | "space" | "task" | "person" | "status" | "target" | "reason";

export type ParseResult =
  | { ok: true; command: ParsedCommand; locale: CommandLocale }
  | { ok: false; reason: "empty" }
  | { ok: false; reason: "unknown"; text: string }
  | {
      ok: false;
      reason: "incomplete" | "unknown_status";
      kind: CommandKind;
      locale: CommandLocale;
      /** The slot being typed and what has been typed into it so far. */
      slot: CommandSlot;
      partial: string;
      /** Slots already complete, e.g. the task in `assign "x" to …`. */
      filled: Partial<Record<CommandSlot, string>>;
    };

/** Opening quote to its closing quote. Single quotes are left out: French apostrophes. */
const QUOTES: Record<string, string> = { '"': '"', "“": "”", "«": "»", "”": "”" };

/**
 * Folds one character at a time so the folded string lines up with the
 * original index for index; the original keeps its capitals and accents.
 */
function alignedFold(text: string): string {
  let out = "";
  for (const char of text) {
    const folded = fold(char);
    out += folded.length === char.length ? folded : char.toLowerCase().slice(0, char.length).padEnd(char.length, " ");
  }
  return out;
}

interface Text {
  raw: string;
  folded: string;
}

function text(raw: string): Text {
  const clean = raw.normalize("NFC").replace(/\s+/g, " ").trim();
  return { raw: clean, folded: alignedFold(clean) };
}

function slice(value: Text, start: number, end?: number): Text {
  return text(value.raw.slice(start, end));
}

/** `"Book the hall" to Ada` gives { value: "Book the hall", rest: `to Ada`, closed: true }. */
function readQuoted(value: Text): { value: string; rest: Text; closed: boolean } | null {
  const open = value.raw[0];
  const close = open ? QUOTES[open] : undefined;
  if (!close) return null;
  const end = value.raw.indexOf(close, 1);
  if (end === -1) return { value: value.raw.slice(1).trim(), rest: text(""), closed: false };
  return { value: value.raw.slice(1, end).trim(), rest: slice(value, end + 1), closed: true };
}

function stripQuotes(raw: string): string {
  const open = raw[0];
  const close = open ? QUOTES[open] : undefined;
  if (close && raw.endsWith(close) && raw.length > 1) return raw.slice(1, -1).trim();
  return raw;
}

/** Every joiner word, both languages, longest first. */
function joinerWords(key: keyof typeof JOINERS): string[] {
  return [...JOINERS[key].en, ...JOINERS[key]["fr-CA"]].sort((a, b) => b.length - a.length);
}

/** Positions of ` joiner ` in the text, last first, with the joiner's length. */
function joinerSplits(value: Text, key: keyof typeof JOINERS): { at: number; length: number }[] {
  const splits: { at: number; length: number }[] = [];
  for (const word of joinerWords(key)) {
    const needle = ` ${word} `;
    let from = value.folded.length;
    for (;;) {
      const at = value.folded.lastIndexOf(needle, from);
      if (at === -1) break;
      splits.push({ at, length: needle.length });
      from = at - 1;
      if (from < 0) break;
    }
  }
  return splits.sort((a, b) => b.at - a.at);
}

/** `to Ada` (or `à Ada`) with the joiner at the start: gives `Ada`. */
function afterLeadingJoiner(value: Text, key: keyof typeof JOINERS): Text | null {
  for (const word of joinerWords(key)) {
    if (value.folded === word) return text("");
    if (value.folded.startsWith(`${word} `)) return slice(value, word.length + 1);
  }
  return null;
}

/** Splits `left joiner right` at the last joiner. */
function splitOnJoiner(
  value: Text,
  key: keyof typeof JOINERS,
): { left: string; right: Text } | null {
  const quoted = readQuoted(value);
  if (quoted?.closed) {
    const right = afterLeadingJoiner(quoted.rest, key);
    return right ? { left: quoted.value, right } : null;
  }
  const [split] = joinerSplits(value, key);
  if (!split) return null;
  return {
    left: stripQuotes(value.raw.slice(0, split.at).trim()),
    right: slice(value, split.at + split.length),
  };
}

function statusOf(value: Text): TaskStatus | null {
  return STATUS_WORDS[value.folded] ?? null;
}

function matchVerb(value: Text): { kind: CommandKind; locale: CommandLocale; length: number } | null {
  let best: { kind: CommandKind; locale: CommandLocale; length: number } | null = null;
  for (const kind of Object.keys(VERBS) as CommandKind[]) {
    for (const locale of ["en", "fr-CA"] as const) {
      for (const verb of VERBS[kind][locale]) {
        const hit = value.folded === verb || value.folded.startsWith(`${verb} `);
        if (hit && (!best || verb.length > best.length)) best = { kind, locale, length: verb.length };
      }
    }
  }
  return best;
}

export function parseCommand(input: string): ParseResult {
  const all = text(input);
  if (!all.raw) return { ok: false, reason: "empty" };
  const verb = matchVerb(all);
  if (!verb) return { ok: false, reason: "unknown", text: all.raw };
  const { kind, locale } = verb;
  const rest = slice(all, verb.length);
  const incomplete = (
    slot: CommandSlot,
    partial: string,
    filled: Partial<Record<CommandSlot, string>> = {},
  ): ParseResult => ({ ok: false, reason: "incomplete", kind, locale, slot, partial, filled });

  switch (kind) {
    case "show_blocked":
      return rest.raw ? { ok: false, reason: "unknown", text: all.raw } : { ok: true, locale, command: { kind } };

    case "open":
      if (!rest.raw) return incomplete("target", "");
      return { ok: true, locale, command: { kind, target: stripQuotes(rest.raw) } };

    case "create_project": {
      if (!rest.raw) return incomplete("name", "");
      const quoted = readQuoted(rest);
      if (quoted && !quoted.closed) return incomplete("name", quoted.value);
      const split = splitOnJoiner(rest, "in");
      if (split) {
        if (!split.left) return incomplete("name", "");
        if (!split.right.raw) return incomplete("space", "", { name: split.left });
        return { ok: true, locale, command: { kind, name: split.left, space: stripQuotes(split.right.raw) } };
      }
      return { ok: true, locale, command: { kind, name: quoted?.value ?? rest.raw, space: null } };
    }

    case "assign_task":
    case "add_to_space": {
      const [first, second]: [CommandSlot, CommandSlot] =
        kind === "assign_task" ? ["task", "person"] : ["person", "space"];
      if (!rest.raw) return incomplete(first, "");
      const quoted = readQuoted(rest);
      if (quoted && !quoted.closed) return incomplete(first, quoted.value);
      const split = splitOnJoiner(rest, "to");
      if (!split) return incomplete(first, quoted ? quoted.value : rest.raw);
      if (!split.left) return incomplete(first, "");
      if (!split.right.raw) return incomplete(second, "", { [first]: split.left });
      const right = stripQuotes(split.right.raw);
      return kind === "assign_task"
        ? { ok: true, locale, command: { kind, task: split.left, person: right } }
        : { ok: true, locale, command: { kind, person: split.left, space: right } };
    }

    case "move_task": {
      if (!rest.raw) return incomplete("task", "");
      const quoted = readQuoted(rest);
      if (quoted && !quoted.closed) return incomplete("task", quoted.value);

      // Candidates for `task joiner status [because reason]`, last joiner first.
      // A status can itself contain a joiner word ("en cours"), so every split
      // is tried and the first whose right side is a status wins.
      const candidates: { task: string; right: Text }[] = [];
      if (quoted?.closed) {
        const right = afterLeadingJoiner(quoted.rest, "to");
        if (right) candidates.push({ task: quoted.value, right });
        else return incomplete("task", quoted.value);
      } else {
        for (const split of joinerSplits(rest, "to")) {
          candidates.push({
            task: stripQuotes(rest.raw.slice(0, split.at).trim()),
            right: slice(rest, split.at + split.length),
          });
        }
        if (candidates.length === 0) return incomplete("task", rest.raw);
      }

      let fallback: { task: string; statusText: string } | null = null;
      for (const { task, right } of candidates) {
        if (!task) continue;
        let statusText = right;
        let reason: string | null = null;
        const [because] = joinerSplits(right, "because");
        if (because) {
          statusText = text(right.raw.slice(0, because.at));
          reason = right.raw.slice(because.at + because.length).trim() || null;
        }
        const status = statusOf(statusText);
        if (status) {
          if (status === "blocked" && !reason) {
            return { ok: false, reason: "incomplete", kind, locale, slot: "reason", partial: "", filled: { task, status } };
          }
          return {
            ok: true,
            locale,
            command: { kind, task, status, reason: status === "blocked" ? reason : null },
          };
        }
        fallback ??= { task, statusText: statusText.raw };
      }
      if (!fallback) return incomplete("task", "");
      if (!fallback.statusText) return incomplete("status", "", { task: fallback.task });
      return {
        ok: false,
        reason: "unknown_status",
        kind,
        locale,
        slot: "status",
        partial: fallback.statusText,
        filled: { task: fallback.task },
      };
    }
  }
}
