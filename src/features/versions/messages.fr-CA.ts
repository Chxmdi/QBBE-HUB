import type { Catalogue } from "@/features/collab/i18n";
import type { versionsEn } from "./messages.en";

/** Français québécois : sauvegarde automatique, versions et corbeille (M16a). */
export const versionsFr: Catalogue<typeof versionsEn> = {
  history: {
    heading: "Historique des versions",
    none: "Aucune version pour l’instant. Une version est enregistrée automatiquement toutes les 10 minutes pendant la modification.",
    saveNamed: "Enregistrer une version",
    nameLabel: "Nom de la version (facultatif)",
    saved: "Version enregistrée.",
    kinds: {
      auto: "Automatique",
      manual: "Nommée",
      restore: "Avant restauration",
    },
    by: "{name}",
    formerMember: "Ancien membre",
    untitled: "Version sans nom",
  },
  autosave: {
    pending: "Modifications non enregistrées",
    saving: "Enregistrement…",
    saved: "Enregistré à {time}",
    error: "Échec de l’enregistrement. Nouvel essai…",
    idle: "Toutes les modifications sont enregistrées",
  },
  editor: {
    heading: "Contenu",
    label: "Description",
    hint: "Les modifications sont enregistrées automatiquement.",
  },
  trash: {
    title: "Corbeille",
    description: "Les éléments supprimés restent ici 30 jours. Restaurez-en un pour le remettre à sa place.",
    none: "La corbeille est vide.",
    delete: "Mettre à la corbeille",
    confirmDelete: "Mettre « {title} » à la corbeille? Il pourra être restauré pendant 30 jours.",
    restore: "Restaurer",
    restoreNamed: "Restaurer {title}",
    restored: "Restauré.",
    deletedBy: "Supprimé par {name} le {date}",
    daysLeft: "{count} jours restants",
    lastDay: "Dernier jour",
    columns: {
      item: "Élément",
      type: "Type",
      deleted: "Supprimé",
      remaining: "Temps restant",
      actions: "Actions",
    },
  },
  types: {
    task: "Tâche",
    project: "Projet",
    page: "Page",
    object: "Objet",
  },
  errors: {
    forbidden: "Vous n’avez pas la permission de faire cela.",
    held: "Cet élément est sous conservation légale et ne peut pas être supprimé avant la levée de la conservation.",
    alreadyInTrash: "Cet élément est déjà dans la corbeille.",
    notInTrash: "Cet élément n’est plus dans la corbeille.",
    inTrash: "Restaurez cet élément de la corbeille avant de le modifier.",
    notFound: "Cet élément n’existe pas ou vous ne pouvez pas l’ouvrir.",
    unsupported: "Les versions ne sont pas encore offertes pour ce type d’élément.",
    failed: "Cela n’a pas fonctionné. Réessayez.",
  },
  page: {
    title: "Versions",
    description: "Toutes les versions de cet élément, enregistrées automatiquement et sur demande.",
  },
};
