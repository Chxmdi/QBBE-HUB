import type { Catalogue } from "@/features/spaces/i18n/translator";
import type { sharingEn } from "./en";

/** Menu de partage (M10f) : français du Québec. */
export const sharingFr: Catalogue<typeof sharingEn> = {
  heading: "Partager « {name} »",
  whoHasAccess: "Qui y a accès",
  everyoneAdmins:
    "Les propriétaires et les administrateurs (avec une ouverture de session en deux étapes) peuvent tout gérer hors des espaces privés.",
  nobodyYet: "Personne n’a encore reçu d’accès ici.",
  direct: "Donné ici",
  inheritedFrom: "Hérité de {kind} « {name} »",
  inheritedHidden: "Hérité d’un espace ou d’une page de niveau supérieur",
  fromTodaysRules: "Selon l’accès propre au programme ou au projet",
  sources: {
    default: "Toutes les personnes de ce rôle, par défaut",
    owner: "Propriétaire de cet espace privé",
  },
  kinds: {
    workspace: "l’espace de travail",
    program: "le programme",
    private: "l’espace privé",
    custom: "l’espace",
    project: "le projet",
    task: "la tâche",
    object: "la page",
  },
  principals: {
    person: "Personne",
    team: "Équipe",
    org_role: "Toutes les personnes d’un rôle",
  },
  orgRoles: {
    owner: "Propriétaires",
    admin: "Administrateurs",
    leadership_viewer: "Observateurs de la direction",
    staff: "Personnel",
    volunteer: "Bénévoles",
    guest: "Invités",
  },
  reach: {
    label: "Donner aussi accès à tout son contenu",
    subtree: "Inclut tout son contenu",
    self: "Cet élément seulement",
    self_and_child_tasks: "Cet élément et ses tâches",
  },
  add: {
    heading: "Donner accès",
    who: "Qui",
    whoKind: "Partager avec",
    person: "Personne",
    team: "Équipe",
    orgRole: "Rôle",
    role: "Accès",
    submit: "Partager",
    none: "Choisir…",
  },
  roleFor: "Accès pour {name}",
  remove: "Retirer l’accès de {name}",
  save: "Enregistrer",
  overrideFor: "Donner plus d’accès ici à {name}",
  overrideHelp:
    "Les accès s’additionnent : vous pouvez donner ici plus que l’accès hérité, pas moins. Pour cacher quelque chose aux personnes qui en héritent, déplacez-le dans un espace dont elles ne font pas partie.",
  cannotShare: "Vous voyez qui y a accès, mais vous ne pouvez pas le modifier ici.",
  privateSpace: "Un espace privé ne peut pas être partagé. Partagez ses pages une à une.",
  programSpace: "Les membres d’un programme se gèrent sur la page du programme.",
  programLink: "Ouvrir les accès du programme",
  done: {
    added: "Accès donné.",
    saved: "Accès modifié.",
    removed: "Accès retiré.",
  },
  errors: {
    invalid: "Choisissez avec qui partager et quel accès donner.",
    forbidden:
      "Vous ne pouvez pas donner cet accès ici. Vous ne pouvez partager que ce que vous avez vous-même, là où le partage vous est permis.",
    failed: "Cela n’a pas fonctionné. Réessayez.",
    duplicate: "Cette personne a déjà cet accès ici.",
  },
};
