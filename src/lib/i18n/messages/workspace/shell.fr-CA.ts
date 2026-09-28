import type { shellEn } from "./shell.en";

/** Français québécois — shell (#141). À faire réviser. */
export const shellFrCA: typeof shellEn = {
  shell: {
    optional: "(facultatif)",
    loading: {
      generic: "Chargement",
      board: "Chargement du tableau",
      calendar: "Chargement du calendrier",
      messages: "Chargement des messages",
    },
    status: {
      task: {
        not_started: "Non commencée",
        ready: "Prête",
        in_progress: "En cours",
        waiting: "En attente",
        blocked: "Bloquée",
        in_review: "En révision",
        completed: "Terminée",
        cancelled: "Annulée",
      },
      health: {
        on_track: "Sur la bonne voie",
        at_risk: "À risque",
        off_track: "Hors de la bonne voie",
        paused: "En pause",
        unknown: "État non défini",
      },
      stage: {
        proposed: "Proposé",
        approved: "Approuvé",
        planning: "Planification",
        active: "Actif",
        paused: "En pause",
        completed: "Terminé",
        cancelled: "Annulé",
        archived: "Archivé",
      },
      priority: {
        low: "Basse",
        medium: "Moyenne",
        high: "Haute",
        critical: "Critique",
      },
    },
    search: {
      title: "Recherche",
      resultsFor: "Résultats pour « {query} »",
      resultOne: "{count} résultat auquel vous avez accès.",
      resultOther: "{count} résultats auxquels vous avez accès.",
      intro:
        "Recherchez dans les tâches, projets, programmes, canaux, messages, personnes, réunions, événements, documents, risques, enjeux, occasions et relations.",
      placeholder: "Tout rechercher…",
      queryLabel: "Termes de recherche",
      submit: "Rechercher",
      filterByType: "Filtrer par type",
      all: "Tous ({count})",
      tooShortTitle: "Tapez au moins deux caractères",
      tooShortBody:
        "La recherche ne porte que sur les dossiers que vous êtes autorisé à voir — les canaux privés et les dossiers restreints n’apparaissent jamais aux personnes non autorisées.",
      noResultsTitle: "Aucun résultat pour « {query} »",
      noResultsFiltered: "Retirez le filtre de type ou vérifiez l’orthographe.",
      noResultsBody:
        "Vérifiez l’orthographe, essayez une expression plus courte ou recherchez le nom d’une personne.",
      clearFilter: "Retirer le filtre de type",
      types: {
        person: { singular: "Personne", plural: "Personnes" },
        task: { singular: "Tâche", plural: "Tâches" },
        project: { singular: "Projet", plural: "Projets" },
        program: { singular: "Programme", plural: "Programmes" },
        channel: { singular: "Canal", plural: "Canaux" },
        meeting: { singular: "Réunion", plural: "Réunions" },
        event: { singular: "Événement", plural: "Événements" },
        agenda: { singular: "Point à l’ordre du jour", plural: "Points à l’ordre du jour" },
        contact: { singular: "Contact", plural: "Contacts" },
        document: { singular: "Document", plural: "Documents" },
        risk: { singular: "Risque", plural: "Risques" },
        issue: { singular: "Enjeu", plural: "Enjeux" },
        opportunity: { singular: "Occasion", plural: "Occasions" },
        crm: { singular: "Relation", plural: "Relations" },
        comment: { singular: "Commentaire", plural: "Commentaires" },
        message: { singular: "Message", plural: "Messages" },
      },
    },
    saved: {
      title: "Messages enregistrés",
      eyebrow: "Communication",
      description:
        "Gardez les conversations importantes à portée de main. L’accès est revérifié chaque fois que vous ouvrez un message.",
      emptyTitle: "Aucun message enregistré",
      emptyBody:
        "Utilisez le menu d’actions d’un message dans un canal ou un message direct pour l’enregistrer pour plus tard.",
      directMessage: "Message direct",
      unknown: "Inconnu",
      deleted: "Ce message a été supprimé.",
    },
  },
};
