import type { Catalogue } from "./translator";
import type { spacesEn } from "./en";

/** Espaces (M10a) : français du Québec. */
export const spacesFr: Catalogue<typeof spacesEn> = {
  metaTitle: "Espaces",
  title: "Espaces",
  description:
    "Chaque travail se trouve dans un espace. L’espace de travail est partagé avec le personnel, chaque programme est un espace et votre espace privé n’appartient qu’à vous.",
  sections: {
    workspace: "Espace de travail",
    private: "Votre espace privé",
    programs: "Programmes",
    custom: "Autres espaces",
  },
  kinds: {
    workspace: "Espace de travail",
    program: "Programme",
    private: "Privé",
    custom: "Espace",
  },
  archived: "Archivé",
  youCan: "Vous pouvez :",
  nothingYet: "Aucun accès pour l’instant",
  emptyPrograms: "Aucun espace de programme visible pour vous.",
  emptyCustom: "Aucun autre espace pour l’instant.",
  capabilities: {
    view: "consulter",
    comment: "commenter",
    edit_content: "modifier le contenu",
    edit_structure: "modifier la structure",
    manage: "gérer",
    run_workflow: "lancer des flux de travail",
    share: "partager",
  },
  create: {
    heading: "Créer un espace",
    help: "Seuls les administrateurs créent des espaces. Nommez-le dans les deux langues.",
    nameEn: "Nom en anglais",
    nameFr: "Nom en français",
    descriptionLabel: "Description (facultative)",
    submit: "Créer l’espace",
    submitting: "Création…",
    created: "Espace créé.",
  },
  errors: {
    invalid: "Entrez un nom dans les deux langues (120 caractères au plus).",
    forbidden: "Seul un administrateur ayant ouvert une session en deux étapes peut créer un espace.",
    failed: "L’espace n’a pas pu être créé. Réessayez.",
  },
};
