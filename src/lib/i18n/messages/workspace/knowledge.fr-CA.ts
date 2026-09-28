import type { knowledgeEn } from "./knowledge.en";

/** Français québécois — reports, documents, exports, textReader (#141). À faire réviser. */
export const knowledgeFrCA: typeof knowledgeEn = {
  reports: {},
  documents: {},
  exports: {},
  textReader: {
    loading: "Préparation de la lecture des mots de ce fichier, pour que la recherche puisse le trouver…",
    reading: "Lecture des mots de ce fichier pour la recherche… {percent} %",
    found: "Les mots de ce fichier ont été lus. La recherche le trouvera grâce à eux.",
    notFound:
      "Aucun mot n’a pu être lu dans ce fichier. Il sera trouvé par son titre, sa description et ses étiquettes.",
    failed:
      "Les mots de ce fichier n’ont pas pu être lus. Il sera trouvé par son titre, sa description et ses étiquettes.",
    timedOut:
      "La lecture de ce fichier a pris trop de temps. Il sera trouvé par son titre, sa description et ses étiquettes.",
    skipped: "Lecture ignorée. Ce fichier sera trouvé par son titre, sa description et ses étiquettes.",
    skip: "Ignorer la lecture",
  },
};
