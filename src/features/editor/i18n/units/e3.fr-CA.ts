import type { e3EditorEn } from "./e3.en";

/** Wave 2 unit E3: its editor strings in Québec French. Only E3 edits this file. */
export const e3EditorFrCA: typeof e3EditorEn = {
  fallback: {
    message: "Ce bloc ne peut pas être affiché. Le reste de la page fonctionne toujours.",
    retry: "Réessayer",
    label: "Le bloc {type} ne peut pas être affiché",
  },
  placeholders: {
    quote: "Tapez les mots à citer",
    callout: "Écrivez la note à mettre en évidence",
    toggleListItem: "Titre du bloc dépliable. Ouvrez-le pour y ajouter des blocs",
  },
  code: {
    language: "Langage du code",
    plainText: "Texte brut",
    other: "Autre ({language})",
    copy: "Copier le code",
    copied: "Code copié.",
    copyFailed: "Impossible de copier. Sélectionnez le code et copiez-le avec Ctrl+C.",
    empty: "Tapez ou collez du code ici.",
    emptyReadOnly: "Aucun code pour l’instant.",
  },
  media: {
    named: {
      image: "Image : {name}",
      video: "Vidéo : {name}",
      audio: "Audio : {name}",
      file: "Fichier : {name}",
    },
    unnamed: {
      image: "Image sans description",
      video: "Vidéo",
      audio: "Fichier audio",
      file: "Fichier",
    },
    caption: "Légende",
    captionPlaceholder: "Ajouter une légende (facultatif)",
    alt: "Texte de remplacement",
    altPlaceholder: "Décrivez ce que montre l’image",
    altMissing: "Cette image n’a pas de description. Ajoutez un texte de remplacement pour que les personnes qui ne la voient pas sachent ce qu’elle montre.",
    emptyHint: {
      image: "Téléversez une image ou collez un lien vers une image. Décrivez-la ensuite avec un texte de remplacement.",
      video: "Téléversez une vidéo ou collez un lien vers une vidéo.",
      audio: "Téléversez un fichier audio ou collez un lien vers un fichier audio.",
      file: "Téléversez un fichier ou collez un lien vers un fichier.",
    },
    emptyReadOnly: {
      image: "Aucune image pour l’instant.",
      video: "Aucune vidéo pour l’instant.",
      audio: "Aucun audio pour l’instant.",
      file: "Aucun fichier pour l’instant.",
    },
    loading: "Chargement…",
    uploading: "Téléversement…",
    unsupported: "Cette adresse ne peut pas être affichée ici. Utilisez un fichier de la bibliothèque ou un lien sécurisé (https).",
    unavailable: "Ce fichier n’est pas disponible. Il est peut-être encore en cours d’analyse antivirus, ou il a été retiré.",
    failed: {
      image: "Impossible de charger cette image.",
      video: "Impossible de charger cette vidéo.",
      audio: "Impossible de charger cet audio.",
      file: "Impossible de charger ce fichier.",
    },
    retry: "Réessayer",
    open: "Ouvrir {name}",
  },
  links: {
    bookmarkUnsupported: "Ce lien ne peut pas être ouvert ici. Seuls les liens sécurisés (https) sont affichés.",
    bookmarkEmpty: "Aucun lien pour l’instant.",
    embedEmpty: "Rien d’intégré pour l’instant.",
  },
  objects: {
    empty: "Rien de choisi pour l’instant.",
  },
};
