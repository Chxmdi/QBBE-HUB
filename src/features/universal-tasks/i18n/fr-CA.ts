import type { Translation } from "./module-i18n";
import type { UniversalTasksMessages } from "./en";

/** Tâches universelles : catalogue en français du Québec (M7). */
export const universalTasksFrCA: Translation<UniversalTasksMessages> = {
  source: {
    label: "Origine",
    from: "Provient de : {kind}",
    fromNamed: "Provient de : {kind} « {title} »",
    unavailable: "Provient de : {kind} auquel vous n’avez pas accès",
    kind: {
      manual: "formulaire de tâche",
      meeting: "réunion",
      document: "document",
      comment: "commentaire",
      project: "modèle de projet",
      message: "message",
      workflow: "flux de travail",
      contact: "suivi de contact",
      template: "modèle de fiche",
      recurrence: "tâche récurrente",
      capture: "boîte de saisie",
      command: "palette de commandes",
    },
  },
  errors: {
    invalid: "Vérifiez les détails de la tâche et réessayez.",
    sourceNotFound: "L’élément d’où provient cette tâche ne vous est pas accessible.",
    saveFailed: "Impossible de créer la tâche.",
  },
};
