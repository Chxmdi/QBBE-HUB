import type { ApiTokensMessages } from "./api-tokens.en";

/** Texte en français québécois pour les écrans de l’API privée (Workspace OS S6, V2-8). */
export const apiTokensFrCA: ApiTokensMessages = {
  eyebrow: "API privée",
  title: "Jetons d’accès à l’API",
  description: "Un jeton permet à un autre outil d’appeler l’API du Hub en votre nom, avec vos permissions et rien de plus.",
  docsLink: "Lire la documentation de l’API",
  create: {
    heading: "Créer un jeton",
    name: "Nom",
    nameHint: "Ce qui l’utilisera, par exemple « Zapier : nouvelles tâches ».",
    scopes: "Ce qu’il peut faire",
    days: "Expire après (jours)",
    daysHint: "Au plus 365 jours.",
    submit: "Créer le jeton",
    shownOnce: "Copiez ce jeton maintenant. Il ne sera plus affiché.",
    tokenLabel: "Votre nouveau jeton",
  },
  scopes: {
    "objects:read": "Lire les objets, leurs propriétés et leurs relations",
    "actions:run": "Exécuter des actions (modifier des choses)",
  },
  list: {
    mine: "Vos jetons",
    all: "Tous les jetons de l’organisation",
    empty: "Aucun jeton pour l’instant.",
    name: "Nom",
    owner: "Personne",
    prefix: "Commence par",
    scopes: "Portées",
    expires: "Expire",
    lastUsed: "Dernière utilisation",
    never: "Jamais",
    status: "État",
    active: "Actif",
    revoked: "Révoqué",
    expired: "Expiré",
    revoke: "Révoquer {name}",
    revokeLabel: "Révoquer",
  },
  log: {
    heading: "Appels récents",
    empty: "Aucun appel pour l’instant.",
    when: "Quand",
    call: "Appel",
    status: "Résultat",
  },
  errors: {
    invalid: "Vérifiez le formulaire : {detail}",
    createFailed: "Le jeton n’a pas pu être créé.",
    revokeFailed: "Le jeton n’a pas pu être révoqué.",
    notFound: "Introuvable.",
  },
  docs: {
    title: "API privée",
    intro: "Une API REST versionnée pour les outils qu’utilise le QBBE. Chaque appel agit au nom de la personne à qui appartient le jeton, avec exactement ses permissions, et est consigné.",
  },
};
