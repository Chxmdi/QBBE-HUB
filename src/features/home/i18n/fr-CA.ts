import type { Translation } from "@/features/universal-tasks/i18n/module-i18n";
import type { HomeMessages } from "./en";

/** Accueil, Mon univers et attention : catalogue en français du Québec (M17). */
export const homeFrCA: Translation<HomeMessages> = {
  page: {
    title: "Accueil",
    description: "Ce qui vous attend maintenant, ce qui est prévu aujourd’hui et ce qui a changé.",
    worldTitle: "Mon univers",
    worldDescription: "Tout ce qui est à vous : tâches, réunions, projets, et ce que d’autres vous doivent.",
    tabs: "Vues de l’accueil",
    home: "Accueil",
    world: "Mon univers",
    commands: "Commandes",
  },
  section: {
    now: { title: "Maintenant", empty: "Rien d’urgent. Rien n’est en retard ni dû aujourd’hui." },
    today: { title: "Aujourd’hui", empty: "Aucune réunion et rien de dû aujourd’hui." },
    waiting: { title: "En attente", empty: "Vous n’attendez personne." },
    continue: { title: "Reprendre", empty: "Rien de récent à reprendre." },
    decisions: { title: "Décisions", empty: "Aucune décision ne vous attend, et aucune n’a été prise récemment." },
    changes: { title: "Changements", empty: "Rien n’a changé dans votre travail depuis trois jours." },
  },
  world: {
    tasks: { title: "Mes tâches", empty: "Aucune tâche ouverte ne vous est assignée." },
    meetings: { title: "Réunions", empty: "Aucune réunion dans les deux prochaines semaines." },
    projects: { title: "Projets", empty: "Vous ne dirigez, ne parrainez ni ne travaillez sur aucun projet ouvert." },
    waitingOn: { title: "En attente de", empty: "Personne ne vous doit rien pour le moment." },
    mentions: { title: "Mentions", empty: "Aucune mention depuis 30 jours." },
    decisionsNeeded: { title: "Décisions requises", empty: "Aucune approbation ni révision ne vous attend." },
  },
  fact: {
    due: "Échéance : {date}",
    overdue: "En retard depuis le {date}",
    dueToday: "Échéance aujourd’hui",
    target: "Cible : {date}",
    project: "Projet : {name}",
    person: "{name}",
    reason: "Bloquée : {text}",
    reviewer: "Vous révisez",
    approver: "Vous approuvez",
    requester: "Vous l’avez demandée",
    owner: "Vous en êtes responsable",
    approvalFallback: "Demande d’approbation",
  },
  health: {
    on_track: "Sur la bonne voie",
    at_risk: "À risque",
    off_track: "Hors de la voie",
    paused: "En pause",
    unknown: "État non défini",
  },
  status: {
    not_started: "À faire",
    ready: "Prête",
    in_progress: "En cours",
    waiting: "En attente",
    blocked: "Bloquée",
    in_review: "En révision",
    completed: "Terminée",
    cancelled: "Annulée",
  },
  count: "{count} éléments",
};
