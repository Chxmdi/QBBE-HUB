import type { EditorMessages } from "./en";

/** Quebec French strings for the block editor (M4b). First draft; to be reviewed (#141). */
export const editorFrCA: EditorMessages = {
  label: "Contenu du document",
  keyboardHint:
    "Tapez / pour ajouter un bloc. Ctrl+/ ouvre le menu du bloc. Alt+F10 mène à la barre de mise en forme. Ctrl+Maj+Haut ou Bas déplace un bloc. Échap, puis Tab, quitte l’éditeur.",
  loading: "Chargement de l’éditeur…",
  save: {
    saving: "Enregistrement…",
    saved: "Enregistré",
    failed: "L’enregistrement a échoué. Vos modifications sont gardées et seront réessayées.",
    offline: "Hors ligne. Vos modifications seront enregistrées à votre retour en ligne.",
    conflict: "Quelqu’un d’autre a enregistré ce contenu dans une autre fenêtre. Rechargez pour voir la dernière version; vos dernières modifications n’ont pas été enregistrées.",
    forbidden: "Vous ne pouvez plus modifier ce contenu. Vos dernières modifications n’ont pas été enregistrées.",
  },
  blockMenu: {
    label: "Menu du bloc",
    moveUp: "Monter le bloc",
    moveDown: "Descendre le bloc",
    duplicate: "Dupliquer le bloc",
    delete: "Supprimer le bloc",
    turnInto: "Transformer en {type}",
    moved: "Bloc déplacé.",
    deleted: "Bloc supprimé.",
  },
  types: {
    paragraph: "Texte",
    heading1: "Titre 1",
    heading2: "Titre 2",
    heading3: "Titre 3",
    bulletListItem: "Liste à puces",
    numberedListItem: "Liste numérotée",
    checkListItem: "Liste de tâches",
    toggleListItem: "Liste dépliable",
    quote: "Citation",
    callout: "Encadré",
    codeBlock: "Code informatique",
  },
  slash: {
    group: "Espace de travail",
    callout: { title: "Encadré", subtext: "Une note mise en évidence, avec un ton", aliases: "encadré,note,info,avertissement,astuce" },
    bookmark: { title: "Signet", subtext: "Un lien affiché sous forme de carte", aliases: "signet,lien,url" },
    embed: {
      title: "Intégration",
      subtext: "YouTube, Vimeo, Google Docs, Sheets, Slides, Forms, Drive ou Loom",
      aliases: "intégrer,vidéo,youtube,vimeo,google,loom,iframe",
    },
  },
  callout: {
    tone: "Ton de l’encadré",
    info: "Renseignement",
    success: "Réussite",
    warning: "Avertissement",
    danger: "Important !",
  },
  bookmark: {
    inputLabel: "Adresse du lien (https)",
    placeholder: "https://exemple.org/article",
    add: "Ajouter le signet",
    invalid: "Entrez une adresse https://.",
    open: "Ouvrir {url} dans un nouvel onglet",
  },
  embed: {
    inputLabel: "Adresse à intégrer",
    placeholder: "https://www.youtube.com/watch?v=…",
    add: "Intégrer",
    unsupported:
      "Cette adresse ne peut pas être intégrée. Permis : YouTube, Vimeo, Google Docs, Sheets, Slides, Forms et fichiers Drive, et Loom.",
    frameTitle: "Contenu intégré de {provider}",
    openOriginal: "Ouvrir l’original",
  },
  files: {
    pending: "Vérification de sécurité en cours. Le fichier s’ouvrira à la fin de l’analyse.",
    tooLarge: "Un fichier peut peser au plus 25 Mo.",
    uploadFailed: "Le fichier n’a pas pu être téléversé. Réessayez.",
  },
  readOnly: "Vous pouvez lire ce contenu, mais pas le modifier.",
  a11y: {
    checkbox: "Terminé",
    slashList: "Blocs",
    toolbarControl: "Option de mise en forme",
  },
};
