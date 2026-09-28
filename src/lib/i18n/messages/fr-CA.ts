import { shellFrCA } from "@/lib/i18n/messages/workspace/shell.fr-CA";
import { accountFrCA } from "@/lib/i18n/messages/workspace/account.fr-CA";
import { workFrCA } from "@/lib/i18n/messages/workspace/work.fr-CA";
import { intakeFrCA } from "@/lib/i18n/messages/workspace/intake.fr-CA";
import { portfolioFrCA } from "@/lib/i18n/messages/workspace/portfolio.fr-CA";
import { commsFrCA } from "@/lib/i18n/messages/workspace/comms.fr-CA";
import { timeFrCA } from "@/lib/i18n/messages/workspace/time.fr-CA";
import { peopleFrCA } from "@/lib/i18n/messages/workspace/people.fr-CA";
import { knowledgeFrCA } from "@/lib/i18n/messages/workspace/knowledge.fr-CA";
import { adminFrCA } from "@/lib/i18n/messages/workspace/admin.fr-CA";
import { opsFrCA } from "@/lib/i18n/messages/workspace/ops.fr-CA";
import type { Messages } from "@/lib/i18n/messages/en";
import { commonFrCA } from "@/lib/i18n/messages/finance/common.fr-CA";
import { approvalsFrCA } from "@/lib/i18n/messages/finance/approvals.fr-CA";
import { receiptsFrCA } from "@/lib/i18n/messages/finance/receipts.fr-CA";
import { payablesFrCA } from "@/lib/i18n/messages/finance/payables.fr-CA";
import { bankFrCA } from "@/lib/i18n/messages/finance/bank.fr-CA";
import { salesTaxFrCA } from "@/lib/i18n/messages/finance/salesTax.fr-CA";
import { budgetsFrCA } from "@/lib/i18n/messages/finance/budgets.fr-CA";
import { ledgerFrCA } from "@/lib/i18n/messages/finance/ledger.fr-CA";
import { ledgerReportsFrCA } from "@/lib/i18n/messages/finance/ledgerReports.fr-CA";
import { giftsFrCA } from "@/lib/i18n/messages/finance/gifts.fr-CA";
import { payrollFrCA } from "@/lib/i18n/messages/finance/payroll.fr-CA";

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
  ...shellFrCA,
  ...accountFrCA,
  ...workFrCA,
  ...intakeFrCA,
  ...portfolioFrCA,
  ...commsFrCA,
  ...timeFrCA,
  ...peopleFrCA,
  ...knowledgeFrCA,
  ...adminFrCA,
  ...opsFrCA,
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
      payables: "Factures",
      salesTax: "TPS et TVQ",
      gifts: "Dons et subventions",
      budgets: "Budgets",
      payroll: "Paie",
      people: "Personnes",
      admin: "Administration",
    },
    more: "Plus",
    moreDestinations: "Autres destinations",
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
  ui: {
    closeDialog: "Fermer la boîte de dialogue",
    closePanel: "Fermer le panneau",
    moreActions: "Plus d’actions",
    sections: "Sections",
    breadcrumb: "Fil d’Ariane",
    loadFailed: "Impossible de charger ce contenu.",
    somethingWrong: "Une erreur s’est produite. Réessayez.",
    toast: {
      success: "Réussite",
      warning: "Avertissement",
      error: "Erreur",
      info: "Information",
      dismiss: "Fermer la notification",
    },
  },
  finance: {
    common: commonFrCA,
    approvals: approvalsFrCA,
    receipts: receiptsFrCA,
    payables: payablesFrCA,
    bank: bankFrCA,
    salesTax: salesTaxFrCA,
    budgets: budgetsFrCA,
    ledger: ledgerFrCA,
    ledgerReports: ledgerReportsFrCA,
    gifts: giftsFrCA,
    payroll: payrollFrCA,
  },
};
