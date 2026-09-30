import type { ObjectsMessages } from "./en";

/** Québec French strings for the object layer. Same keys as ./en.ts. */
export const objectsFr: ObjectsMessages = {
  common: {
    eyebrow: "Élément",
    untitled: "Sans titre",
  },
  related: {
    title: "Liés",
    description: "Tout ce qui est lié à cet élément ({type}), dans les deux sens.",
    count: "{count} liés",
    empty: "Aucun lien pour l’instant",
    emptyDescription: "Les liens s’affichent ici quand cet élément est ajouté à un projet, dépend d’une tâche ou est lié à autre chose.",
    hidden: "Certains liens ne sont pas affichés parce que vous n’avez pas accès à l’autre élément.",
    open: "Ouvrir {title}",
    source: {
      native: "Provient de la fiche elle-même",
      stored: "Ajouté comme lien",
    },
  },
  page: {
    notFound: "Cet élément n’existe pas, ou vous n’y avez pas accès.",
    archived: "Archivé",
  },
};
