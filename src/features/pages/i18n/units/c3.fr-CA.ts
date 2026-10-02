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
    intro: "Choisissez ce qui vous parvient. Décochez « Dans le Hub » pour ne plus recevoir un type de notification, ni par courriel.",
    inHub: "Dans le Hub",
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
