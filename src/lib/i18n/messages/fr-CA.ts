import type { Messages } from "@/lib/i18n/messages/en";

/**
 * Texte de l'interface en français québécois (#141).
 *
 * Typed against the English catalogue: a missing or extra key fails the
 * typecheck. Follows OQLF usage (« courriel », 24-hour clock, a non-breaking
 * space before a colon, none before ? or !).
 *
 * NEEDS REVIEW: machine-assisted first draft, to be reviewed by a fluent
 * French speaker named by QBBE before the switch-over.
 */
export const frCA: Messages = {
  common: {
    appName: "QBBE Hub",
    tryAgain: "Réessayer",
    backToSignIn: "Retour à la connexion",
    backToHome: "Retour à l’accueil",
    email: "Courriel",
    password: "Mot de passe",
    save: "Enregistrer",
    saving: "Enregistrement…",
    saved: "Enregistré",
    cancel: "Annuler",
    unknown: "Inconnu",
    never: "jamais",
    system: "Système",
    noSubject: "(sans objet)",
    unreadPrefix: "Non lu. ",
    openItems: " éléments ouverts",
    internalWorkspace: "Espace de travail des opérations internes",
    skipToContent: "Passer au contenu principal",
  },
  meta: {
    description:
      "Le système interne d’exploitation et de communication du Quebec Board of Black Educators.",
  },
  language: {
    label: "Langue",
    english: "English",
    french: "Français",
    followBrowser: "Suivre mon navigateur",
    switcher: "Choisir une langue",
    settingsTitle: "Langue",
    settingsDescription:
      "La langue qu’utilise QBBE Hub pour vous. Les dates, les nombres et les montants suivent le même choix.",
    saveError: "Impossible d’enregistrer votre langue. Réessayez.",
    invalid: "Choisissez une langue prise en charge.",
    reviewNote: "La formulation française doit encore être révisée par une personne francophone.",
  },
  nav: {
    main: "Navigation principale",
    primary: "Principale",
    groups: {
      work: "Travail",
      communication: "Communication",
      organization: "Organisation",
    },
    items: {
      home: "Accueil",
      myWork: "Mon travail",
      board: "Tableau",
      requests: "Demandes",
      forms: "Formulaires",
      projects: "Projets",
      programs: "Programmes",
      approvals: "Approbations",
      inbox: "Boîte de réception",
      channels: "Canaux",
      messages: "Messages",
      saved: "Enregistrés",
      announcements: "Annonces",
      calendar: "Calendrier",
      schedule: "Calendrier directeur",
      meetings: "Réunions",
      events: "Événements",
      signatures: "Signatures",
      relationships: "Relations",
      reports: "Rapports",
      documents: "Documents",
      receipts: "Reçus",
      ledger: "Grand livre",
      bank: "Banque",
      people: "Personnes",
      admin: "Administration",
    },
    more: "Plus",
    homeLink: "Accueil de QBBE Hub",
    openNavigation: "Ouvrir la navigation",
    closeNavigation: "Fermer la navigation",
    navigation: "Navigation",
    channelsHeading: "Canaux",
    programsHeading: "Programmes",
    managePrograms: "Ajouter ou gérer des programmes",
    viewAllPrograms: "Voir tous les programmes",
    unreadMessages: "Messages non lus",
  },
  topbar: {
    searchPlaceholder: "Rechercher ou aller à…",
    quickCreate: "Création rapide",
    create: {
      task: "Nouvelle tâche",
      proposal: "Nouvelle proposition de projet",
      project: "Nouveau projet",
      program: "Nouveau programme",
      meeting: "Nouvelle réunion",
      event: "Nouvel événement",
      channel: "Nouveau canal",
      crmOrganization: "Nouvelle organisation (GRC)",
      crmContact: "Nouveau contact (GRC)",
      crmFollowUp: "Nouveau suivi (GRC)",
      announcement: "Nouvelle annonce",
    },
    notificationsFailed: "Les notifications n’ont pas pu être chargées.",
    notifications: "Notifications",
    notificationsUnread: "Notifications ({count} non lues)",
    markAllRead: "Tout marquer comme lu",
    allCaughtUp: "Vous êtes à jour.",
    needsYou: "Requiert votre attention",
    forInformation: "Pour information",
    openInbox: "Ouvrir la boîte de réception",
    switchDensity: "Passer à l’affichage {density}",
    densityTitle: "Affichage {density}",
    density: {
      comfortable: "aéré",
      compact: "compact",
      comfortableTitle: "aéré",
      compactTitle: "compact",
    },
    toggleTheme: "Changer le thème de couleur",
    accountMenu: "Menu du compte",
    accountSettings: "Paramètres du compte",
    emailPreferences: "Préférences de courriel",
    signOut: "Se déconnecter",
  },
  palette: {
    label: "Palette de commandes",
    placeholder: "Rechercher des tâches, projets, personnes, documents, risques…",
    search: "Rechercher",
    searching: "Recherche…",
    goTo: "Aller à",
    create: "Créer",
    results: "Résultats",
    searchFailed: "La recherche n’est pas disponible pour le moment.",
    seeAll: "Voir tous les résultats pour « {query} »",
    noMatches: "Aucun dossier correspondant auquel vous avez accès.",
    prompt: "Tapez pour rechercher ou choisissez une destination.",
  },
  auth: {
    tagline:
      "Travail, communication et opérations de programmes sécurisés pour le Quebec Board of Black Educators.",
    signIn: {
      title: "Connexion",
      submit: "Se connecter",
      badCredentials:
        "Ce courriel et ce mot de passe ne correspondent pas. Vérifiez-les et réessayez.",
      forgot: "Mot de passe oublié?",
      newHere: "Nouveau sur QBBE Hub?",
      createAccount: "Créer un compte",
    },
    signUp: {
      title: "Créer un compte",
      fullName: "Nom complet",
      passwordHint: "Au moins 8 caractères.",
      submit: "Créer le compte",
      haveAccount: "Vous avez déjà un compte?",
      signIn: "Se connecter",
      checkFailed: "Impossible de vérifier si l’inscription est ouverte. Réessayez.",
      inviteOnly:
        "Cet espace de travail est sur invitation seulement. Demandez à un administrateur de vous envoyer une invitation.",
      checkEmail: "Vérifiez vos courriels",
      confirmationSent:
        "Nous avons envoyé un lien de confirmation à {email}. Suivez-le pour terminer la création de votre compte.",
    },
    recovery: {
      requestTitle: "Récupérer le compte",
      resetTitle: "Réinitialiser le mot de passe",
      requestHeading: "Récupérer votre compte",
      resetHeading: "Choisir un nouveau mot de passe",
      requestDone:
        "Si cette adresse correspond à un compte, un lien de récupération arrivera sous peu. Ouvrez-le dans ce navigateur.",
      resetDone:
        "Votre mot de passe a été modifié. Connectez-vous avec votre nouveau mot de passe.",
      passwordRules:
        "Utilisez au moins 12 caractères. Votre espace de travail peut exiger des mesures de protection supplémentaires.",
      newPassword: "Nouveau mot de passe",
      confirmPassword: "Confirmer le mot de passe",
      sendLink: "Envoyer le lien de récupération",
      savePassword: "Enregistrer le mot de passe",
      requestFailed: "Impossible de demander la récupération. Patientez un moment et réessayez.",
      mismatch: "Les mots de passe ne correspondent pas.",
      updateFailed:
        "Impossible de modifier votre mot de passe. Vérifiez les exigences ou demandez un nouveau lien de récupération.",
      failed: "Impossible de terminer la récupération. Veuillez réessayer.",
      sessionMissing: "Votre session de récupération est absente ou a expiré.",
      requestNewLink: "Demander un nouveau lien de récupération",
    },
  },
  errors: {
    rootTitle: "Le Hub n’a pas pu se charger",
    rootBody:
      "Une erreur s’est produite avant que la page puisse être construite. Vos données sont en sécurité — réessayez et, si le problème persiste, prévenez un administrateur",
    workspaceTitle: "Un problème est survenu",
    workspaceBody:
      "La page a rencontré une erreur inattendue. Vos données sont en sécurité — réessayez et, si le problème persiste, prévenez un administrateur",
    reference: " (référence : {digest})",
    notFoundTitle: "Introuvable — ou non accessible pour vous",
    notFoundBody:
      "Ce dossier n’existe pas, a été archivé ou ne fait pas partie de vos accès. Les liens directs revérifient toujours les autorisations.",
  },
  due: {
    none: "Aucune échéance",
    overdueDays: "En retard de {days} j",
    today: "Échéance aujourd’hui",
    tomorrow: "Échéance demain",
  },
  settings: {
    title: "Paramètres du compte",
    eyebrow: "Compte",
    heading: "Paramètres",
    description:
      "Gérez la façon dont QBBE Hub vous avise. Les administrateurs gèrent séparément les paramètres par défaut de l’organisation.",
  },
  home: {
    title: "Accueil",
    greeting: {
      morning: "Bonjour",
      afternoon: "Bon après-midi",
      evening: "Bonsoir",
    },
    greetingLine: "{greeting}, {name}",
    sections: {
      today: "Aujourd’hui",
      programHealth: "Santé des programmes",
      activityOverview: "Aperçu des activités",
      upcomingEvents: "Événements à venir",
      workload: "Charge de travail",
      commitments: "Engagements",
      outcomes: "Résultats",
      needsAttention: "Requiert une attention",
      recentActivity: "Activité récente",
    },
    attentionToday: "Voici ce qui requiert votre attention aujourd’hui.",
    overview: "Votre travail assigné, les annonces et votre horaire à venir.",
  },
  myWork: {
    title: "Mon travail",
    eyebrow: "Centre de commande",
    description:
      "Tout ce dont vous êtes responsable ou que vous devez réviser, groupé par urgence. Sélectionnez des lignes pour des modifications en lot ou ouvrez une tâche pour tous les détails.",
    buckets: {
      overdue: "En retard",
      today: "Échéance aujourd’hui",
      thisWeek: "Cette semaine",
      later: "Plus tard / non planifié",
    },
    loadFailed: "Votre travail n’a pas pu être chargé.",
    loadFailedDetail:
      "Il s’agit d’un échec de chargement, pas d’une charge de travail vide — rien n’a été modifié ni perdu.",
    reviewHeading: "En attente de votre révision",
    reviewQueue: "File de révision",
    blocked: "Bloqué",
    noMatchTitle: "Aucune tâche ne correspond à ces filtres",
    noMatchBody:
      "Essayez d’élargir un filtre — ou effacez-les pour voir tout votre travail en cours.",
    clearTitle: "Votre charge de travail est vide",
    clearBody:
      "Lorsque des tâches vous sont assignées — dans des projets, des réunions ou des conversations — elles apparaissent ici, groupées par échéance.",
    upcomingMeetings: "Réunions à venir",
  },
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
};
