import type { objectApprovalsEn } from "./en";

/** Français québécois — approbations sur tout objet (Workspace OS V2-7). À faire réviser. */
export const objectApprovalsFrCA: typeof objectApprovalsEn = {
  title: "Approbation",
  heading: "Approbation de {title}",
  backToRecord: "Retour à la fiche",
  kind: {
    task: "Tâche",
    project: "Projet",
    meeting: "Réunion",
    decision: "Décision",
  },
  none: "Aucune approbation n’a été demandée pour cette fiche.",
  history: "Approbations",
  status: {
    pending: "En attente d’approbation",
    approved: "Approuvé",
    rejected: "Refusé",
    withdrawn: "Retiré",
  },
  currentStep: "Actuellement chez : {label}",
  requestedBy: "Demandé par {name} le {date}",
  decidedOn: "Décidé le {date}",
  openItem: "Ouvrir dans Approbations",
  request: {
    heading: "Demander une approbation",
    hint: "La demande suit les règles d’approbation de votre organisation, y compris les délégations, et apparaît dans la boîte des approbateurs.",
    titleLabel: "Ce qui doit être approuvé (facultatif)",
    titleHint: "Laissez vide pour utiliser le nom de la fiche.",
    noteLabel: "Note pour l’approbateur (facultatif)",
    submit: "Demander l’approbation",
    sent: "Approbation demandée.",
    error: "L’approbation n’a pas pu être demandée. Il faut faire partie du personnel et pouvoir modifier cette fiche, et elle ne doit pas déjà être en attente.",
    waiting: "Cette fiche est déjà en attente d’approbation.",
  },
  errors: {
    notFound: "Cette fiche n’est pas disponible.",
    invalidInput: "Vérifiez le formulaire et réessayez.",
  },
};
