import type { Translation } from "@/features/universal-tasks/i18n/module-i18n";
import type { CommandsMessages } from "./en";

/** Langage de commandes : catalogue en français du Québec (M15). */
export const commandsFrCA: Translation<CommandsMessages> = {
  bar: {
    title: "Commandes",
    description:
      "Tapez une commande, par exemple : assigner « Réserver la salle » à Ada. Les commandes fonctionnent en français et en anglais.",
    label: "Commande",
    placeholder: "créer un projet, assigner, déplacer, afficher les tâches bloquées, ouvrir, ajouter…",
    suggestions: "Suggestions",
    run: "Exécuter",
    running: "Exécution…",
    hint: "Les flèches haut et bas parcourent les suggestions, Entrée en choisit une, Échap ferme la liste.",
    examples: "Exemples",
    count: "{count} suggestions disponibles.",
  },
  slot: {
    command: "Commande",
    name: "Nom",
    space: "Espace",
    task: "Tâche",
    person: "Personne",
    status: "Statut",
    target: "Ouvrir",
    reason: "Raison",
  },
  result: {
    projectCreated: "Projet « {name} » créé.",
    taskAssigned: "Tâche assignée.",
    taskMoved: "Tâche déplacée.",
    personAdded: "Personne ajoutée à l’espace.",
    opening: "Ouverture…",
  },
  errors: {
    empty: "Tapez une commande.",
    unknown:
      "Ce n’est pas une commande. Essayez « créer un projet », « assigner », « déplacer », « afficher les tâches bloquées », « ouvrir » ou « ajouter ».",
    incomplete: {
      name: "Ajoutez le nom du projet.",
      space: "Ajoutez le nom de l’espace.",
      task: "Ajoutez le titre de la tâche, entre guillemets, suivi de « à ».",
      person: "Ajoutez le nom de la personne.",
      status: "Ajoutez un statut, par exemple « en cours ».",
      target: "Ajoutez ce qu’il faut ouvrir.",
      reason: "Indiquez pourquoi elle est bloquée : ajoutez « parce que » et la raison.",
    },
    unknownStatus:
      "« {status} » n’est pas un statut. Essayez « à faire », « en cours », « en attente », « en révision », « terminée » ou « bloquée ».",
    notFound: "Aucun élément ({slot}) visible pour vous ne s’appelle « {name} ».",
    ambiguous: "Plus d’un élément ({slot}) correspond à « {name} » : {candidates}. Tapez une plus grande partie du nom.",
    failed: "La commande n’a pas pu être exécutée : {message}",
    unavailable: "Les commandes ne sont pas activées.",
  },
};
