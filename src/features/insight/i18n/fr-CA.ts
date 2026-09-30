import type { InsightMessages } from "./en";

/** Chaînes françaises (Québec) du volet Aperçu. Mêmes clés que ./en.ts. */
export const insightFr: InsightMessages = {
  common: {
    eyebrow: "Aperçu",
    apply: "Appliquer",
    types: {
      program: "Programme",
      project: "Projet",
      milestone: "Jalon",
      task: "Tâche",
      event: "Événement",
    },
  },
  graph: {
    title: "Graphe des liens",
    description: "Comment les programmes, projets, jalons et tâches sont reliés. Choisissez un élément à placer au centre et le nombre d’étapes à afficher.",
    filters: "Filtres du graphe",
    typesLegend: "Afficher ces types",
    root: "Centrer sur",
    rootAll: "Tout (sans centre)",
    depth: "Étapes",
    depthOption: "{count} étapes",
    depthOne: "1 étape",
    viewLabel: "Affichage",
    viewGraph: "Graphe",
    viewList: "Liste",
    summary: "{nodes} éléments et {edges} liens affichés.",
    truncated: "Cet espace de travail est volumineux : seuls les éléments les plus récents sont inclus.",
    graphLabel: "Graphe de {nodes} éléments et {edges} liens. L’affichage en liste présente la même information en texte.",
    centreHere: "Centrer le graphe sur {title}",
    open: "Ouvrir {title}",
    emptyTitle: "Rien à afficher",
    emptyDescription: "Aucun élément ne correspond à ces filtres, ou vous n’avez encore accès à aucun.",
    relation: {
      containsOut: "contient",
      containsIn: "fait partie de",
      blocksOut: "bloque",
      blocksIn: "est bloqué par",
    },
    legendContains: "Trait plein : contient",
    legendBlocks: "Trait pointillé : bloque",
  },
};
