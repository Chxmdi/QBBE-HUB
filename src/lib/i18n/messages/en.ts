import { shellEn } from "@/lib/i18n/messages/workspace/shell.en";
import { accountEn } from "@/lib/i18n/messages/workspace/account.en";
import { workEn } from "@/lib/i18n/messages/workspace/work.en";
import { intakeEn } from "@/lib/i18n/messages/workspace/intake.en";
import { portfolioEn } from "@/lib/i18n/messages/workspace/portfolio.en";
import { commsEn } from "@/lib/i18n/messages/workspace/comms.en";
import { timeEn } from "@/lib/i18n/messages/workspace/time.en";
import { peopleEn } from "@/lib/i18n/messages/workspace/people.en";
import { knowledgeEn } from "@/lib/i18n/messages/workspace/knowledge.en";
import { adminEn } from "@/lib/i18n/messages/workspace/admin.en";
import { opsEn } from "@/lib/i18n/messages/workspace/ops.en";
import { commonEn } from "@/lib/i18n/messages/finance/common.en";
import { approvalsEn } from "@/lib/i18n/messages/finance/approvals.en";
import { receiptsEn } from "@/lib/i18n/messages/finance/receipts.en";
import { payablesEn } from "@/lib/i18n/messages/finance/payables.en";
import { bankEn } from "@/lib/i18n/messages/finance/bank.en";
import { salesTaxEn } from "@/lib/i18n/messages/finance/salesTax.en";
import { budgetsEn } from "@/lib/i18n/messages/finance/budgets.en";
import { ledgerEn } from "@/lib/i18n/messages/finance/ledger.en";
import { ledgerReportsEn } from "@/lib/i18n/messages/finance/ledgerReports.en";
import { giftsEn } from "@/lib/i18n/messages/finance/gifts.en";
import { payrollEn } from "@/lib/i18n/messages/finance/payroll.en";

/**
 * English interface text — the source catalogue (#141).
 *
 * Every other catalogue is typed against this one, so adding a key here and
 * not in French is a compile error, and `i18n.test.ts` repeats the check for
 * placeholders. Group keys by screen; `common` is for words that really are
 * shared. Placeholders are written `{name}`.
 */
export const en = {
  ...shellEn,
  ...accountEn,
  ...workEn,
  ...intakeEn,
  ...portfolioEn,
  ...commsEn,
  ...timeEn,
  ...peopleEn,
  ...knowledgeEn,
  ...adminEn,
  ...opsEn,
  common: {
    appName: "QBBE Hub",
    tryAgain: "Try again",
    backToSignIn: "Back to sign in",
    backToHome: "Back to Home",
    email: "Email",
    password: "Password",
    save: "Save",
    saving: "Saving…",
    saved: "Saved",
    cancel: "Cancel",
    unknown: "Unknown",
    never: "never",
    system: "System",
    noSubject: "(no subject)",
    unreadPrefix: "Unread. ",
    openItems: " open items",
    internalWorkspace: "Internal operations workspace",
    skipToContent: "Skip to main content",
  },
  meta: {
    description:
      "The Quebec Board of Black Educators' internal operating and communication system.",
  },
  language: {
    label: "Language",
    english: "English",
    french: "Français",
    followBrowser: "Follow my browser",
    switcher: "Choose a language",
    settingsTitle: "Language",
    settingsDescription:
      "The language QBBE Hub uses for you. Dates, numbers and amounts follow the same choice.",
    saveError: "Could not save your language. Try again.",
    invalid: "Choose a supported language.",
    reviewNote: "French wording is awaiting review by a fluent speaker.",
  },
  nav: {
    main: "Main navigation",
    primary: "Primary",
    groups: {
      work: "Work",
      communication: "Communication",
      organization: "Organization",
    },
    items: {
      home: "Home",
      myWork: "My Work",
      board: "Board",
      requests: "Requests",
      forms: "Forms",
      projects: "Projects",
      programs: "Programs",
      approvals: "Approvals",
      inbox: "Inbox",
      channels: "Channels",
      messages: "Messages",
      saved: "Saved",
      announcements: "Announcements",
      calendar: "Calendar",
      schedule: "Master Schedule",
      meetings: "Meetings",
      events: "Events",
      signatures: "Signatures",
      relationships: "Relationships",
      reports: "Reports",
      documents: "Documents",
      receipts: "Receipts",
      ledger: "Ledger",
      bank: "Bank",
      payables: "Bills & invoices",
      salesTax: "GST and QST",
      gifts: "Gifts and grants",
      budgets: "Budgets",
      payroll: "Payroll",
      people: "People",
      admin: "Admin",
    },
    more: "More",
    moreDestinations: "More destinations",
    homeLink: "QBBE Hub home",
    openNavigation: "Open navigation",
    closeNavigation: "Close navigation",
    navigation: "Navigation",
    channelsHeading: "Channels",
    programsHeading: "Programs",
    managePrograms: "Add or manage programs",
    viewAllPrograms: "View all programs",
    unreadMessages: "Unread messages",
  },
  topbar: {
    searchPlaceholder: "Search or jump to…",
    quickCreate: "Quick create",
    create: {
      task: "New task",
      proposal: "New project proposal",
      project: "New project",
      program: "New program",
      meeting: "New meeting",
      event: "New event",
      channel: "New channel",
      crmOrganization: "New CRM organization",
      crmContact: "New CRM contact",
      crmFollowUp: "New CRM follow-up",
      announcement: "New announcement",
    },
    notificationsFailed: "Notifications couldn't be loaded.",
    notifications: "Notifications",
    notificationsUnread: "Notifications ({count} unread)",
    markAllRead: "Mark all read",
    allCaughtUp: "You're all caught up.",
    needsYou: "Needs you",
    forInformation: "For information",
    openInbox: "Open Inbox",
    switchDensity: "Switch to {density} density",
    densityTitle: "{density} density",
    density: {
      comfortable: "comfortable",
      compact: "compact",
      comfortableTitle: "Comfortable",
      compactTitle: "Compact",
    },
    toggleTheme: "Toggle color theme",
    accountMenu: "Account menu",
    accountSettings: "Account settings",
    emailPreferences: "Email preferences",
    signOut: "Sign out",
  },
  palette: {
    label: "Command palette",
    placeholder: "Search tasks, projects, people, documents, risks…",
    search: "Search",
    searching: "Searching…",
    goTo: "Go to",
    create: "Create",
    results: "Results",
    searchFailed: "Search isn't available right now.",
    seeAll: "See all results for “{query}”",
    noMatches: "No matching records you have access to.",
    prompt: "Type to search, or pick a destination.",
  },
  errors: {
    rootTitle: "The Hub couldn't load",
    rootBody:
      "Something failed before the page could be built. Your data is safe — try again, and if this keeps happening let an administrator know",
    workspaceTitle: "Something went wrong",
    workspaceBody:
      "The page hit an unexpected error. Your data is safe — try again, and if this keeps happening let an administrator know",
    reference: " (reference: {digest})",
    notFoundTitle: "Not found — or not yours to see",
    notFoundBody:
      "This record doesn't exist, was archived, or your access doesn't include it. Deep links always re-check authorization.",
  },
  due: {
    none: "No due date",
    overdueDays: "Overdue {days}d",
    today: "Due today",
    tomorrow: "Due tomorrow",
  },
  ui: {
    closeDialog: "Close dialog",
    closePanel: "Close panel",
    moreActions: "More actions",
    sections: "Sections",
    breadcrumb: "Breadcrumb",
    loadFailed: "This couldn't be loaded.",
    somethingWrong: "Something went wrong. Try again.",
    toast: {
      success: "Success",
      warning: "Warning",
      error: "Error",
      info: "Information",
      dismiss: "Dismiss notification",
    },
  },
  finance: {
    common: commonEn,
    approvals: approvalsEn,
    receipts: receiptsEn,
    payables: payablesEn,
    bank: bankEn,
    salesTax: salesTaxEn,
    budgets: budgetsEn,
    ledger: ledgerEn,
    ledgerReports: ledgerReportsEn,
    gifts: giftsEn,
    payroll: payrollEn,
  },
};

export type Messages = typeof en;
