import type { Locale } from "@/lib/i18n/config";

/** English and Quebec French for workspace upkeep (V3-2); French is typed from English. */
const en = {
  eyebrow: "Workspace OS",
  title: "Workspace upkeep",
  description: "Pages nobody has looked at in a while, links that no longer work, things with no home, possible duplicates and things nobody uses. You only see what you can open.",
  summary: "{count} things to look at",
  staleHeading: "Pages to review",
  staleHelp: "Not changed or confirmed for at least {days} days. Owners confirm a page is still right, or archive it.",
  idleFor: "Idle {days} days",
  owner: "Owner: {name}",
  noOwner: "No owner",
  thresholdLabel: "Idle for at least",
  days: "{days} days",
  show: "Show",
  stillCurrent: "Still current: {title}",
  archive: "Archive {title}",
  reviewedCurrent: "Marked as still current.",
  reviewedArchive: "Archived.",
  brokenHeading: "Broken links",
  orphansHeading: "Things with no home",
  duplicatesHeading: "Possible duplicates",
  unusedHeading: "Not used",
  unusedHelp: "Unused properties and lenses will appear here once properties and lenses are available.",
  nothing: "Nothing here.",
  open: "Open {title}",
  issues: {
    unapproved_host: "Links to {detail}, which is no longer an approved source",
    archived_project: "Still open in the archived project “{detail}”",
    no_home_no_assignee: "No project, program or person",
    filed_nowhere: "Not in any project, program, meeting or folder",
    type_without_objects: "A type with nothing in it",
    view_for_missing_project: "A saved view for a project that is archived or gone",
  },
  kinds: { task: "Task", project: "Project", document: "Document", page: "Page", type: "Type", view: "Saved view" },
  sameAs: "{count} with the same name: {titles}",
  errors: {
    generic: "Something went wrong. Please try again.",
    forbidden: "Only the page's owner or someone who manages it can review it.",
  },
};

export type UpkeepText = typeof en;

const frCA: UpkeepText = {
  eyebrow: "Espace de travail",
  title: "Entretien de l’espace",
  description: "Les pages que personne n’a consultées depuis un moment, les liens qui ne fonctionnent plus, ce qui n’a pas de place, les doublons possibles et ce que personne n’utilise. Vous voyez seulement ce que vous pouvez ouvrir.",
  summary: "{count} éléments à examiner",
  staleHeading: "Pages à réviser",
  staleHelp: "Ni modifiées ni confirmées depuis au moins {days} jours. Les responsables confirment qu’une page est toujours juste, ou l’archivent.",
  idleFor: "Inactive depuis {days} jours",
  owner: "Responsable : {name}",
  noOwner: "Aucun responsable",
  thresholdLabel: "Inactive depuis au moins",
  days: "{days} jours",
  show: "Afficher",
  stillCurrent: "Toujours à jour : {title}",
  archive: "Archiver {title}",
  reviewedCurrent: "Marquée comme toujours à jour.",
  reviewedArchive: "Archivée.",
  brokenHeading: "Liens brisés",
  orphansHeading: "Éléments sans place",
  duplicatesHeading: "Doublons possibles",
  unusedHeading: "Inutilisés",
  unusedHelp: "Les propriétés et les vues inutilisées apparaîtront ici lorsque les propriétés et les vues seront offertes.",
  nothing: "Rien ici.",
  open: "Ouvrir {title}",
  issues: {
    unapproved_host: "Pointe vers {detail}, qui n’est plus une source approuvée",
    archived_project: "Toujours ouvert dans le projet archivé « {detail} »",
    no_home_no_assignee: "Aucun projet, programme ni personne",
    filed_nowhere: "Dans aucun projet, programme, réunion ni dossier",
    type_without_objects: "Un type qui ne contient rien",
    view_for_missing_project: "Une vue enregistrée pour un projet archivé ou supprimé",
  },
  kinds: { task: "Tâche", project: "Projet", document: "Document", page: "Page", type: "Type", view: "Vue enregistrée" },
  sameAs: "{count} avec le même nom : {titles}",
  errors: {
    generic: "Un problème est survenu. Veuillez réessayer.",
    forbidden: "Seul le responsable de la page ou une personne qui la gère peut la réviser.",
  },
};

export function upkeepText(locale: Locale): UpkeepText {
  return locale === "fr-CA" ? frCA : en;
}

export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in values ? String(values[name]) : match));
}
