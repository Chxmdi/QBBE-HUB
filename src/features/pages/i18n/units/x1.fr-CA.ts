import type { x1PagesEn } from "./x1.en";

/** Wave 2 unit X1: its pages strings in Québec French. Only X1 edits this file. */
export const x1PagesFrCA: typeof x1PagesEn = {
  export: {
    button: "Exporter",
    label: "Exporter {title} en Markdown",
    working: "Préparation de l’exportation…",
    done: "Exportation téléchargée : {file}",
    failed: "L’exportation n’a pas pu être faite. Vérifiez votre connexion et réessayez.",
    notFound: "Vous n’avez plus accès à cette page pour l’exporter.",
    retry: "Réessayer l’exportation",
    viewName: "Vue {index}",
  },
  import: {
    button: "Importer",
    workspaceLabel: "Importer un fichier comme page de l’espace de travail",
    privateLabel: "Importer un fichier comme page privée",
    title: "Importer une page",
    intro: "Choisissez un fichier Markdown (.md) ou HTML (.html) d’au plus 1 Mo. Il devient une nouvelle page avec les mêmes titres, listes, citations, blocs de code et tableaux. Tout ce qui pourrait s’exécuter, comme les scripts ou les cadres intégrés, est retiré.",
    workspaceArea: "La page est ajoutée à l’espace de travail, où votre équipe peut la lire.",
    privateArea: "La page est ajoutée à vos pages privées, où personne d’autre que vous ne peut la lire.",
    file: "Fichier à importer",
    noFile: "Aucun fichier choisi",
    submit: "Importer le fichier",
    working: "Importation en cours…",
    errors: {
      noFile: "Choisissez d’abord un fichier.",
      unsupported: "Ce type de fichier ne peut pas être importé. Choisissez un fichier Markdown (.md, .markdown, .txt) ou HTML (.html, .htm).",
      tooLarge: "Ce fichier dépasse 1 Mo. Divisez-le en fichiers plus petits et importez-les un à un.",
      empty: "Ce fichier est vide.",
      unreadable: "Ce fichier n’est pas du texte lisible (il doit être enregistré en UTF-8).",
      forbidden: "Vous ne pouvez pas ajouter de pages ici.",
      failed: "L’importation n’a pas fonctionné. Vérifiez votre connexion et réessayez.",
    },
  },
};
