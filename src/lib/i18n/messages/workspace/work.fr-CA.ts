import type { workEn } from "./work.en";

/** Français québécois — home, myWork, board, tasks, dashboard (#141). À faire réviser. */
export const workFrCA: typeof workEn = {
  home: {
    title: "Accueil",
    greeting: {
      morning: "Bonjour",
      afternoon: "Bon après-midi",
      evening: "Bonsoir",
    },
    greetingLine: "{greeting}, {name}",
    sections: {
      today: "Aujourd’hui",
      programHealth: "Santé des programmes",
      activityOverview: "Aperçu des activités",
      upcomingEvents: "Événements à venir",
      workload: "Charge de travail",
      commitments: "Engagements",
      outcomes: "Résultats",
      needsAttention: "Requiert une attention",
      recentActivity: "Activité récente",
    },
    attentionToday: "Voici ce qui requiert votre attention aujourd’hui.",
    overview: "Votre travail assigné, les annonces et votre horaire à venir.",
  },
  myWork: {
    title: "Mon travail",
    eyebrow: "Centre de commande",
    description:
      "Tout ce dont vous êtes responsable ou que vous devez réviser, groupé par urgence. Sélectionnez des lignes pour des modifications en lot ou ouvrez une tâche pour tous les détails.",
    buckets: {
      overdue: "En retard",
      today: "Échéance aujourd’hui",
      thisWeek: "Cette semaine",
      later: "Plus tard / non planifié",
    },
    loadFailed: "Votre travail n’a pas pu être chargé.",
    loadFailedDetail:
      "Il s’agit d’un échec de chargement, pas d’une charge de travail vide — rien n’a été modifié ni perdu.",
    reviewHeading: "En attente de votre révision",
    reviewQueue: "File de révision",
    blocked: "Bloqué",
    noMatchTitle: "Aucune tâche ne correspond à ces filtres",
    noMatchBody:
      "Essayez d’élargir un filtre — ou effacez-les pour voir tout votre travail en cours.",
    clearTitle: "Votre charge de travail est vide",
    clearBody:
      "Lorsque des tâches vous sont assignées — dans des projets, des réunions ou des conversations — elles apparaissent ici, groupées par échéance.",
    upcomingMeetings: "Réunions à venir",
  },
  board: {},
  tasks: {},
  dashboard: {},
};
