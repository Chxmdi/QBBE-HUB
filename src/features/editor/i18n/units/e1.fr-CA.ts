import type { e1EditorEn } from "./e1.en";

/** Wave 2 unit E1: its editor strings in Québec French. Only E1 edits this file. */
export const e1EditorFrCA: typeof e1EditorEn = {
  file: {
    uploading: "Téléversement de {name}…",
    pending: "Vérification de sécurité en cours pour {name}. Le fichier s'ouvrira une fois l'analyse terminée.",
    failed: "{name} n'a pas pu être téléversé. {reason}",
    refused: "{name} n'a pas réussi la vérification de sécurité et ne peut pas être ouvert. Retirez ce bloc.",
    retry: "Réessayer",
  },
  tooLarge: {
    title: "Rien n'a été collé.",
    fileTitle: "Un fichier a été laissé de côté.",
    dismiss: "Fermer",
  },
};
