import type { Locale } from "@/lib/i18n/config";

/** English and Quebec French for offline mode (V3-1); French is typed from English. */
const en = {
  eyebrow: "Workspace OS",
  title: "Work offline",
  description: "Change your tasks with or without a connection. Changes made offline are kept on this device and sent when you are back online.",
  online: "You are online.",
  offline: "You are offline. Changes are kept on this device.",
  pending: "{count} changes waiting to be sent.",
  nothingPending: "Nothing waiting to be sent.",
  syncNow: "Send now",
  syncing: "Sending…",
  synced: "All changes sent.",
  syncFailed: "Could not send yet. Your changes are kept and will be sent when the connection is back.",
  readingHelp: "Pages you open in My Work, Projects, Programs and the Board while this is on are kept on this device, so you can read the most recent ones offline.",
  tasksHeading: "My open tasks",
  noTasks: "No open tasks.",
  statusFor: "Status for {title}",
  priorityFor: "Priority for {title}",
  newTask: "New task",
  newTaskLabel: "Title of the new task",
  add: "Add",
  queuedNew: "New, not sent yet",
  reviewHeading: "Changes to review",
  reviewHelp: "When two people changed the same thing, the later change is kept. Check these and change them again if needed.",
  keptTheirs: "A later change to {field} on “{title}” was kept: {kept}. Yours was {overwritten}.",
  keptYours: "Your change to {field} on “{title}” was later and replaced someone else's: yours is {kept}, theirs was {overwritten}.",
  dismiss: "Got it",
  failed: "Could not save a change to “{title}”: you may no longer be allowed to change it.",
  fields: { status: "status", priority: "priority", due_at: "due date", start_at: "start date", title: "title" },
  empty: "(empty)",
  statuses: {
    not_started: "Not started",
    ready: "Ready",
    in_progress: "In progress",
    waiting: "Waiting",
    blocked: "Blocked",
    in_review: "In review",
    completed: "Completed",
    cancelled: "Cancelled",
  },
  priorities: { low: "Low", medium: "Medium", high: "High", critical: "Critical" },
};

export type OfflineText = typeof en;

const frCA: OfflineText = {
  eyebrow: "Espace de travail",
  title: "Travailler hors ligne",
  description: "Modifiez vos tâches avec ou sans connexion. Les changements faits hors ligne sont conservés sur cet appareil et envoyés au retour de la connexion.",
  online: "Vous êtes en ligne.",
  offline: "Vous êtes hors ligne. Les changements sont conservés sur cet appareil.",
  pending: "{count} changements en attente d’envoi.",
  nothingPending: "Rien en attente d’envoi.",
  syncNow: "Envoyer maintenant",
  syncing: "Envoi…",
  synced: "Tous les changements ont été envoyés.",
  syncFailed: "Envoi impossible pour le moment. Vos changements sont conservés et seront envoyés au retour de la connexion.",
  readingHelp: "Les pages que vous ouvrez dans Mon travail, Projets, Programmes et le Tableau pendant que ceci est activé sont conservées sur cet appareil, pour lire les plus récentes hors ligne.",
  tasksHeading: "Mes tâches ouvertes",
  noTasks: "Aucune tâche ouverte.",
  statusFor: "Statut de {title}",
  priorityFor: "Priorité de {title}",
  newTask: "Nouvelle tâche",
  newTaskLabel: "Titre de la nouvelle tâche",
  add: "Ajouter",
  queuedNew: "Nouvelle, pas encore envoyée",
  reviewHeading: "Changements à vérifier",
  reviewHelp: "Quand deux personnes ont changé la même chose, le changement le plus récent est conservé. Vérifiez-les et modifiez-les au besoin.",
  keptTheirs: "Un changement plus récent de {field} sur « {title} » a été conservé : {kept}. Le vôtre était {overwritten}.",
  keptYours: "Votre changement de {field} sur « {title} » était plus récent et a remplacé celui d’une autre personne : le vôtre est {kept}, l’autre était {overwritten}.",
  dismiss: "Compris",
  failed: "Impossible d’enregistrer un changement sur « {title} » : vous n’avez peut-être plus le droit de le modifier.",
  fields: { status: "statut", priority: "priorité", due_at: "échéance", start_at: "date de début", title: "titre" },
  empty: "(vide)",
  statuses: {
    not_started: "Pas commencée",
    ready: "Prête",
    in_progress: "En cours",
    waiting: "En attente",
    blocked: "Bloquée",
    in_review: "En révision",
    completed: "Terminée",
    cancelled: "Annulée",
  },
  priorities: { low: "Basse", medium: "Moyenne", high: "Haute", critical: "Critique" },
};

export function offlineText(locale: Locale): OfflineText {
  return locale === "fr-CA" ? frCA : en;
}

export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in values ? String(values[name]) : match));
}
