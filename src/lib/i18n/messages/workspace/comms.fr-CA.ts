import type { commsEn } from "./comms.en";

/** Français québécois — inbox, channels, messages, announcements, comments (#141). À faire réviser. */
export const commsFrCA: typeof commsEn = {
  inbox: {
    title: "Boîte de réception",
    eyebrow: "Triage unifié",
    description:
      "Notifications de la plateforme, mentions, assignations, réponses et annonces au même endroit.",
    filtersLabel: "Filtres de la boîte de réception",
    filters: {
      all: "Tout",
      mention: "Mentions",
      assignment: "Assignations",
      reply: "Réponses",
      due_date: "Échéances",
      approval: "Approbations",
      decision: "Décisions",
      announcement: "Annonces",
      mail: "Courriel",
    },
    notificationsLabel: "Notifications",
    gmailNotConnectedTitle: "Gmail n’est pas connecté",
    gmailConnectPrompt:
      "Connectez votre compte Google QBBE pour lister vos courriels et répondre de façon sécurisée sans stocker le contenu des messages dans QBBE Hub.",
    gmailNotConfigured:
      "Gmail reste déconnecté tant qu’un administrateur n’a pas défini GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET et l’URI de redirection. Ce n’est pas une fausse boîte de réception.",
    noMailTitle: "Aucun courriel synchronisé pour l’instant",
    noMailBody:
      "Après une synchronisation Gmail réussie, les métadonnées des fils apparaissent ici. Le contenu des messages n’est pas conservé dans les journaux.",
    zeroTitle: "Boîte de réception vide",
    zeroBody:
      "Les notifications de mentions, d’assignations, de réponses et d’annonces arriveront ici.",
    fromTo: "De : {from} · À : {to}",
    noBody: "Gmail n’a fourni aucun contenu en texte brut.",
    unreadSummary: "{unread} non lues sur {shown} affichées",
    connectedEmail: "Courriel connecté",
    connected: "Connecté",
    notConnected: "Non connecté",
    lastSync: "Dernière synchronisation : {when}",
    reconnectRequired: "Reconnexion requise : {error}",
    connectedHelp:
      "Rédigez un nouveau courriel ici ou ouvrez un message synchronisé pour le lire sur demande et y répondre par Gmail. Les connexions existantes qui utilisent l’ancienne autorisation de modification doivent se reconnecter pour obtenir l’autorisation plus restreinte de lecture et d’envoi.",
    connectHelp:
      "Connectez Gmail pour lister vos courriels et envoyer ou répondre à partir d’un message sélectionné.",
    configHelp:
      "L’intégration Gmail nécessite une configuration Google OAuth approuvée par QBBE. Une fois les identifiants en place, le bouton Connecter apparaît ici.",
    connectGmail: "Connecter Gmail",
    setupDocs: "Consultez docs/runbooks/integrations.md pour la configuration.",
  },
  channels: {},
  messages: {},
  announcements: {},
  comments: {},
};
