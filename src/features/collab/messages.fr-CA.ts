import type { Catalogue } from "./i18n";
import type { collabEn } from "./messages.en";

/** Français québécois : présence, curseurs et verrouillage (V1-17). */
export const collabFr: Catalogue<typeof collabEn> = {
  presence: {
    label: "Personnes présentes",
    alone: "Vous êtes seul ici.",
    you: "Vous",
    editing: "{name} (en modification)",
    viewing: "{name} (en consultation)",
    cursor: "{name} est au caractère {offset} de {block}",
    selecting: "{name} a sélectionné {length} caractères dans {block}",
    others: "{count} autres personnes ici",
    offline: "Les mises à jour en direct sont en pause. Nouvel essai…",
  },
  lock: {
    lock: "Verrouiller la page",
    unlock: "Déverrouiller la page",
    reasonLabel: "Pourquoi la verrouiller? (facultatif)",
    locked: "Verrouillée par {name}",
    lockedReason: "Verrouillée par {name} : {reason}",
    lockedHint: "Personne ne peut modifier le contenu avant le déverrouillage.",
    formerMember: "un ancien membre",
    failed: "Cela n’a pas fonctionné. Réessayez.",
  },
  page: {
    title: "Modification en direct",
    description: "Voyez qui d’autre est ici et où chaque personne travaille.",
    notFound: "Cet élément n’existe pas ou vous ne pouvez pas l’ouvrir.",
    blocks: {
      description: "Description",
    },
  },
};
