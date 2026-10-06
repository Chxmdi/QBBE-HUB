import type { Locale } from "@/lib/i18n/config";

/** English and Quebec French for following (V1-14); French is typed from English. */
const en = {
  eyebrow: "Workspace OS",
  title: "Following",
  description: "What you follow, and how you hear about it.",
  followingHeading: "What you follow",
  nothingFollowed: "You are not following anything yet.",
  unfollow: "Unfollow {name}",
  unfollowed: "Unfollowed.",
  follow: "Follow",
  following: "Following",
  followed: "You are following {name}.",
  followThis: "Follow {name}?",
  followHelp: "You will hear about changes to it as your rules below say.",
  kinds: { task: "Task", project: "Project", query: "Saved search" },
  queriesHeading: "Follow a saved search",
  queriesHelp: "Hear when a task starts to match, or a matching task changes.",
  presets: {
    my_blocked: "My tasks that are blocked",
    due_this_week: "My tasks due this week",
    i_requested: "Tasks I asked for",
  },
  followQuery: "Follow this search",
  rulesHeading: "How you hear about changes",
  rulesHelp: "Email follows your quiet hours. Daily and weekly digests arrive at your digest time.",
  events: {
    status: "Status changes",
    assignment: "Assignment changes",
    due: "Date changes",
    comment: "New comments",
    change: "Other changes",
  },
  choices: {
    none: "Don't tell me",
    hub: "In the Hub only",
    immediate: "In the Hub and by email right away",
    daily: "In the Hub and in the daily digest",
    weekly: "In the Hub and in the weekly digest",
  },
  saveRules: "Save my rules",
  rulesSaved: "Your rules are saved.",
  errors: {
    generic: "Something went wrong. Please try again.",
    forbidden: "You cannot do this.",
    cannotSee: "You can only follow things you can see.",
    already: "You already follow this.",
  },
};

export type FollowingText = typeof en;

const frCA: FollowingText = {
  eyebrow: "Espace de travail",
  title: "Suivis",
  description: "Ce que vous suivez, et comment vous en êtes informé.",
  followingHeading: "Ce que vous suivez",
  nothingFollowed: "Vous ne suivez rien pour l’instant.",
  unfollow: "Ne plus suivre {name}",
  unfollowed: "Suivi retiré.",
  follow: "Suivre",
  following: "Suivi",
  followed: "Vous suivez {name}.",
  followThis: "Suivre {name}?",
  followHelp: "Vous serez informé de ses changements selon vos règles ci-dessous.",
  kinds: { task: "Tâche", project: "Projet", query: "Recherche enregistrée" },
  queriesHeading: "Suivre une recherche enregistrée",
  queriesHelp: "Soyez informé quand une tâche commence à correspondre, ou qu’une tâche correspondante change.",
  presets: {
    my_blocked: "Mes tâches bloquées",
    due_this_week: "Mes tâches dues cette semaine",
    i_requested: "Les tâches que j’ai demandées",
  },
  followQuery: "Suivre cette recherche",
  rulesHeading: "Comment être informé des changements",
  rulesHelp: "Les courriels respectent vos heures de tranquillité. Les résumés quotidien et hebdomadaire arrivent à votre heure de résumé.",
  events: {
    status: "Changements de statut",
    assignment: "Changements d’attribution",
    due: "Changements de date",
    comment: "Nouveaux commentaires",
    change: "Autres changements",
  },
  choices: {
    none: "Ne pas m’informer",
    hub: "Dans le Hub seulement",
    immediate: "Dans le Hub et par courriel immédiatement",
    daily: "Dans le Hub et dans le résumé quotidien",
    weekly: "Dans le Hub et dans le résumé hebdomadaire",
  },
  saveRules: "Enregistrer mes règles",
  rulesSaved: "Vos règles sont enregistrées.",
  errors: {
    generic: "Un problème est survenu. Veuillez réessayer.",
    forbidden: "Vous ne pouvez pas faire ceci.",
    cannotSee: "Vous pouvez seulement suivre ce que vous pouvez voir.",
    already: "Vous suivez déjà ceci.",
  },
};

export function followingText(locale: Locale): FollowingText {
  return locale === "fr-CA" ? frCA : en;
}

export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in values ? String(values[name]) : match));
}
