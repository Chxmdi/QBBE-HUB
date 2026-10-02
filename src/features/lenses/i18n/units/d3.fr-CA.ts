import type { d3LensesEn } from "./d3.en";

/** Wave 2 unit D3: its lenses strings in Québec French. Only D3 edits this file. */
export const d3LensesFrCA: typeof d3LensesEn = {
  layout: "Graphique",
  kinds: {
    bar: "Graphique à barres",
    line: "Graphique linéaire",
    pie: "Graphique circulaire",
    number: "Nombre unique",
  },
  settings: {
    kind: "Type de graphique",
    total: "Total",
    count: "Nombre d’éléments",
    sum: "Somme de {property}",
    avg: "Moyenne de {property}",
    groupHint: "Les graphiques à barres, linéaires et circulaires présentent une valeur pour chaque valeur de « Regrouper par ». Sans regroupement, les tâches sont regroupées par statut et les projets par étape.",
  },
  figure: {
    summary: "{kind} : {measure} par {group}",
    summaryNumber: "{kind} : {measure}",
    count: "Nombre",
    noValue: "Aucune valeur",
    other: "Autres",
    share: "Part",
    showTable: "Afficher les chiffres",
    hideTable: "Masquer les chiffres",
    moreGroups: "{count} autres groupes figurent dans les chiffres.",
  },
  states: {
    loading: "Chargement du graphique…",
    empty: "Rien à afficher : aucun élément que vous pouvez voir ne correspond à cette vue.",
    failed: "Impossible de charger ce graphique.",
    invalid: "Les paramètres de ce graphique ne sont pas valides. Une somme ou une moyenne exige une propriété numérique.",
    needsGroup: "Ce graphique exige une propriété « Regrouper par » que ses éléments possèdent. Choisissez-en une dans ses paramètres.",
    missing: "La vue que présente ce graphique n’existe plus ou n’est pas partagée avec vous.",
    off: "Les vues sont désactivées pour cet espace de travail.",
    retry: "Réessayer",
  },
};
