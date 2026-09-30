import type { decisionsV2En } from "./en";

/** Français québécois — décisions complètes (Workspace OS V1-10). À faire réviser. */
export const decisionsV2FrCA: typeof decisionsV2En = {
  title: "Décision",
  trailTitle: "Historique des décisions",
  trailDescription: "Toutes les décisions de {project}, des plus récentes aux plus anciennes, avec ce qui a été pesé et pourquoi.",
  trailEmpty: "Aucune décision consignée pour ce projet.",
  backToProject: "Retour au projet",
  openDecision: "Ouvrir la décision",
  decidedBy: "Décidé par {name}",
  decidedOn: "Décidé le",
  inMeeting: "Lors de la réunion « {meeting} »",
  reopened: "Rouverte",
  revisitOn: "À revoir le {date}",
  revisitDue: "À revoir maintenant",
  fields: {
    problem: "Problème",
    options: "Options envisagées",
    optionsHint: "Une option par ligne.",
    chosen: "Décision",
    evidence: "Données probantes",
    reasoning: "Raisonnement",
    participants: "Participants",
    revisit: "Date de révision (facultatif)",
    revisitHint: "La personne qui a décidé et les participants recevront un rappel ce jour-là.",
    legacyRationale: "Justification",
    legacyAlternatives: "Solutions de rechange (ancienne fiche)",
  },
  empty: "Non consigné",
  form: {
    heading: "Modifier la fiche",
    save: "Enregistrer la décision",
    saved: "Décision enregistrée.",
    error: "La décision n’a pas pu être enregistrée.",
    readOnly: "Seule une personne qui gère cette décision peut la modifier.",
  },
  participants: {
    add: "Ajouter un participant",
    person: "Personne",
    choose: "Choisissez une personne",
    remove: "Retirer {name}",
    none: "Aucun participant consigné.",
    error: "Le participant n’a pas pu être modifié.",
  },
  notify: {
    title: "À revoir : {title}",
    body: "Cette décision devait être revue le {date}.",
  },
  errors: {
    invalidInput: "Vérifiez le formulaire et réessayez.",
    notFound: "Cette décision n’est pas disponible.",
  },
};
