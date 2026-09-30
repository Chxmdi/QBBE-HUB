import type { TaskStatus } from "@/types/entities";

/**
 * The command language (M15, epic #199): a small, fixed grammar in English
 * and Quebec French. Parsing is deterministic: the same text always gives the
 * same command, and nothing is guessed by a model.
 *
 *   create project <name> [in <space>]      créer (un) projet <nom> [dans <espace>]
 *   assign "<task>" to <person>             assigner "<tâche>" à <personne>
 *   move "<task>" to <status> [because <r>] déplacer "<tâche>" vers <statut> [parce que <r>]
 *   show blocked tasks                      afficher les tâches bloquées
 *   open <object>                           ouvrir <objet>
 *   add <person> to <space>                 ajouter <personne> à <espace>
 *
 * Both languages are always understood; the viewer's language only decides
 * which one autocomplete offers first. Accents and capitals never matter.
 */

export const COMMAND_KINDS = [
  "create_project",
  "assign_task",
  "move_task",
  "show_blocked",
  "open",
  "add_to_space",
] as const;
export type CommandKind = (typeof COMMAND_KINDS)[number];

export type CommandLocale = "en" | "fr-CA";

/** How each command starts, per language. Longer forms first. */
export const VERBS: Record<CommandKind, Record<CommandLocale, string[]>> = {
  create_project: {
    en: ["create project", "new project"],
    "fr-CA": ["creer un projet", "creer projet", "nouveau projet"],
  },
  assign_task: { en: ["assign"], "fr-CA": ["assigner", "attribuer"] },
  move_task: { en: ["move"], "fr-CA": ["deplacer"] },
  show_blocked: {
    en: ["show blocked tasks", "show blocked"],
    "fr-CA": [
      "afficher les taches bloquees",
      "afficher taches bloquees",
      "montrer les taches bloquees",
      "afficher bloquees",
    ],
  },
  open: { en: ["open"], "fr-CA": ["ouvrir"] },
  add_to_space: { en: ["add"], "fr-CA": ["ajouter"] },
};

/** The template autocomplete shows for each command, per language. */
export const TEMPLATES: Record<CommandKind, Record<CommandLocale, string>> = {
  create_project: { en: "create project ", "fr-CA": "créer un projet " },
  assign_task: { en: 'assign "', "fr-CA": "assigner « " },
  move_task: { en: 'move "', "fr-CA": "déplacer « " },
  show_blocked: { en: "show blocked tasks", "fr-CA": "afficher les tâches bloquées" },
  open: { en: "open ", "fr-CA": "ouvrir " },
  add_to_space: { en: "add ", "fr-CA": "ajouter " },
};

/** Words that join the parts of a command. */
export const JOINERS = {
  to: { en: ["to"], "fr-CA": ["a", "vers", "en"] },
  in: { en: ["in"], "fr-CA": ["dans"] },
  because: { en: ["because"], "fr-CA": ["parce que", "car"] },
} as const;

/** Status words, folded (no accents, lower case), to the status they mean. */
export const STATUS_WORDS: Record<string, TaskStatus> = {
  "not started": "not_started",
  todo: "not_started",
  "to do": "not_started",
  "a faire": "not_started",
  "pas commence": "not_started",
  "non commencee": "not_started",
  "non commence": "not_started",
  ready: "ready",
  pret: "ready",
  prete: "ready",
  "in progress": "in_progress",
  doing: "in_progress",
  "en cours": "in_progress",
  waiting: "waiting",
  "en attente": "waiting",
  blocked: "blocked",
  bloque: "blocked",
  bloquee: "blocked",
  "in review": "in_review",
  review: "in_review",
  "en revision": "in_review",
  "en revue": "in_review",
  completed: "completed",
  done: "completed",
  complete: "completed",
  termine: "completed",
  terminee: "completed",
  fait: "completed",
  faite: "completed",
  cancelled: "cancelled",
  canceled: "cancelled",
  annule: "cancelled",
  annulee: "cancelled",
};

/** The status word autocomplete offers, per language. */
export const STATUS_LABELS: Record<TaskStatus, Record<CommandLocale, string>> = {
  not_started: { en: "not started", "fr-CA": "à faire" },
  ready: { en: "ready", "fr-CA": "prête" },
  in_progress: { en: "in progress", "fr-CA": "en cours" },
  waiting: { en: "waiting", "fr-CA": "en attente" },
  blocked: { en: "blocked", "fr-CA": "bloquée" },
  in_review: { en: "in review", "fr-CA": "en révision" },
  completed: { en: "completed", "fr-CA": "terminée" },
  cancelled: { en: "cancelled", "fr-CA": "annulée" },
};

/** Lower case, no accents, typographic apostrophes straightened. */
export function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[’‘]/g, "'")
    .toLowerCase();
}
