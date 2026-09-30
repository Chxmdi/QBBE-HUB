import type { TaskStatus } from "@/types/entities";
import { fold } from "./grammar";
import { rankNames, type CommandCatalog } from "./autocomplete";
import type { CommandSlot, ParsedCommand } from "./parse";

/** What a parsed command does, with every name turned into a record id. */
export type CommandPlan =
  | { kind: "create_project"; name: string; spaceId: string | null }
  | { kind: "assign_task"; taskId: string; personId: string }
  | { kind: "move_task"; taskId: string; status: TaskStatus; reason: string | null }
  | { kind: "navigate"; href: string }
  | { kind: "add_to_space"; personId: string; spaceId: string };

export type ResolveResult =
  | { ok: true; plan: CommandPlan }
  | {
      ok: false;
      reason: "not_found" | "ambiguous";
      slot: CommandSlot;
      name: string;
      /** For "ambiguous": the names it could be, best first. */
      candidates: string[];
    };

type Named = { id: string; name: string };

/**
 * One record for a typed name. An exact match (ignoring accents and capitals)
 * wins; otherwise a name that matches exactly one record by prefix or word;
 * otherwise it is ambiguous or not found. Never a guess between two records.
 */
export function resolveName(
  items: Named[],
  typed: string,
): { ok: true; id: string } | { ok: false; reason: "not_found" | "ambiguous"; candidates: string[] } {
  const exact = items.filter((item) => fold(item.name) === fold(typed.trim()));
  if (exact.length === 1) return { ok: true, id: exact[0].id };
  const pool = exact.length > 1 ? exact : rankNames(items, (item) => item.name, typed, 50);
  if (pool.length === 1) return { ok: true, id: pool[0].id };
  if (pool.length === 0) return { ok: false, reason: "not_found", candidates: [] };
  return { ok: false, reason: "ambiguous", candidates: pool.slice(0, 5).map((item) => item.name) };
}

export function resolveCommand(command: ParsedCommand, catalog: CommandCatalog): ResolveResult {
  const lookup = (slot: CommandSlot, items: Named[], typed: string) => {
    const found = resolveName(items, typed);
    return found.ok ? { ok: true as const, id: found.id } : { ...found, slot, name: typed };
  };
  const tasks = catalog.tasks.map((task) => ({ id: task.id, name: task.title }));
  const objects = catalog.objects.map((object) => ({ id: object.id, name: object.title }));

  switch (command.kind) {
    case "show_blocked":
      return { ok: true, plan: { kind: "navigate", href: "/my-work?status=blocked" } };
    case "open": {
      const object = lookup("target", objects, command.target);
      if (!object.ok) return object;
      const href = catalog.objects.find((candidate) => candidate.id === object.id)!.href;
      return { ok: true, plan: { kind: "navigate", href } };
    }
    case "create_project": {
      if (command.space === null) return { ok: true, plan: { kind: "create_project", name: command.name, spaceId: null } };
      const space = lookup("space", catalog.spaces, command.space);
      if (!space.ok) return space;
      return { ok: true, plan: { kind: "create_project", name: command.name, spaceId: space.id } };
    }
    case "assign_task": {
      const task = lookup("task", tasks, command.task);
      if (!task.ok) return task;
      const person = lookup("person", catalog.people, command.person);
      if (!person.ok) return person;
      return { ok: true, plan: { kind: "assign_task", taskId: task.id, personId: person.id } };
    }
    case "move_task": {
      const task = lookup("task", tasks, command.task);
      if (!task.ok) return task;
      return { ok: true, plan: { kind: "move_task", taskId: task.id, status: command.status, reason: command.reason } };
    }
    case "add_to_space": {
      const person = lookup("person", catalog.people, command.person);
      if (!person.ok) return person;
      const space = lookup("space", catalog.spaces, command.space);
      if (!space.ok) return space;
      return { ok: true, plan: { kind: "add_to_space", personId: person.id, spaceId: space.id } };
    }
  }
}
