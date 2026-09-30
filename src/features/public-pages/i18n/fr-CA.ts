import type { Catalogue } from "@/features/spaces/i18n/translator";
import type { publicPagesEn } from "./en";

/** Pages publiques (V1-18) : français du Québec. */
export const publicPagesFr: Catalogue<typeof publicPagesEn> = {
  metaTitle: "Pages publiques",
  title: "Pages publiques",
  description:
    "Publiez une copie en lecture seule de champs choisis d’un espace, d’un projet ou d’une page. Un autre propriétaire ou administrateur l’approuve d’abord; la dépublication la retire aussitôt. Les propriétés privées ne sont jamais proposées.",
  publicBadge: "Publique",
  ask: {
    heading: "Demander une publication",
    source: "Quoi publier",
    choose: "Choisir les champs",
    fields: "Champs à publier",
    fieldsHelp: "Seuls les champs cochés sont copiés. Les propriétés privées ne sont pas listées et ne peuvent jamais être publiées.",
    slug: "Adresse Web",
    slugHelp: "Lettres minuscules, chiffres et traits d’union, au moins 3 caractères. La page sera à /p/ suivie de cette adresse.",
    submit: "Envoyer pour approbation",
    sent: "Envoyé pour approbation. Un autre propriétaire ou administrateur doit l’approuver.",
    none: "Choisir…",
    empty: "(vide)",
  },
  review: {
    heading: "En attente d’approbation",
    empty: "Rien n’attend d’approbation.",
    askedBy: "Demandé par {name}",
    preview: "Ce qui sera publié",
    approve: "Approuver et publier",
    reject: "Refuser",
    note: "Note (facultative)",
    yours: "Vous avez fait cette demande : un autre propriétaire ou administrateur doit l’approuver.",
    approved: "Publié.",
    rejected: "Refusé.",
  },
  live: {
    heading: "Publiées",
    empty: "Rien n’est publié.",
    open: "Ouvrir la page publique",
    unpublish: "Dépublier",
    unpublished: "Retirée.",
  },
  history: {
    heading: "Précédentes",
    rejected: "Refusée",
    unpublished: "Dépubliée",
  },
  page: {
    published: "Publiée le {date}",
    footer: "Publiée par le QBBE. Cette page est une copie et ne change pas quand l’original change.",
  },
  errors: {
    invalid:
      "Choisissez au moins un champ et une adresse Web d’au moins 3 lettres minuscules, chiffres ou traits d’union.",
    taken: "Cette adresse Web est déjà utilisée, ou cet élément est déjà publié ou en attente. Choisissez-en une autre.",
    forbidden: "Seul un propriétaire ou un administrateur ayant ouvert une session en deux étapes peut faire ceci.",
    own: "Un autre propriétaire ou administrateur doit approuver ce que vous avez demandé de publier.",
    failed: "Cela n’a pas fonctionné. Réessayez.",
  },
};
