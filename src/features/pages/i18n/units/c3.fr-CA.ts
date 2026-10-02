import type { c3PagesEn } from "./c3.en";

/** Wave 2 unit C3: its pages strings in Québec French. Only C3 edits this file. */
export const c3PagesFrCA: typeof c3PagesEn = {
  watch: {
    watch: "Suivre",
    hint: "Recevez une notification quand quelqu’un commente cette page.",
    watchingHint: "Vous recevez une notification quand quelqu’un commente cette page. Appuyez pour arrêter.",
    started: "Vous suivez cette page. Les nouveaux commentaires vous parviendront.",
    stopped: "Vous ne suivez plus cette page.",
    failed: "Impossible de changer le suivi. Réessayez.",
    notAllowed: "Vous ne pouvez pas suivre cette page.",
  },
  inbox: {
    comment: "Commentaire",
    watched_page: "Page suivie",
  },
  preferences: {
    intro: "Décochez un type de notification pour l’arrêter complètement : il n’apparaît plus dans le Hub et n’est pas envoyé par courriel. Les avis de sécurité et les annonces obligatoires arrivent toujours.",
    inHub: "Afficher dans le Hub",
    hub: {
      mention: "Mentions",
      assignment: "Travail assigné",
      comment: "Commentaires",
      approval: "Approbations",
      watched_page: "Pages suivies",
    },
    categories: {
      comment: {
        label: "Réponses à mes commentaires",
        hint: "Quelqu’un répond à un commentaire que vous avez écrit sur une page.",
      },
      approval: {
        label: "Approbations",
        hint: "Un élément attend votre approbation, ou votre demande a été tranchée.",
      },
      watched_page: {
        label: "Pages suivies",
        hint: "Nouveaux commentaires sur les pages que vous suivez.",
      },
    },
  },
};
