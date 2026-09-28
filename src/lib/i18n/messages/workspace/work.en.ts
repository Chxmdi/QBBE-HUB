/**
 * English text for work screens (#141). Mounted at the top level of the
 * catalogue; this file owns only these namespaces: home, myWork, board, tasks, dashboard.
 */
export const workEn = {
  home: {
    title: "Home",
    greeting: {
      morning: "Good morning",
      afternoon: "Good afternoon",
      evening: "Good evening",
    },
    greetingLine: "{greeting}, {name}",
    sections: {
      today: "Today",
      programHealth: "Program health",
      activityOverview: "Activity overview",
      upcomingEvents: "Upcoming events",
      workload: "Workload",
      commitments: "Commitments",
      outcomes: "Outcomes",
      needsAttention: "Needs attention",
      recentActivity: "Recent activity",
    },
    attentionToday: "Here's what needs your attention today.",
    overview: "Your assigned work, announcements, and upcoming schedule.",
  },
  myWork: {
    title: "My Work",
    eyebrow: "Command center",
    description:
      "Everything you own or must review, grouped by urgency. Select rows for bulk changes, or open a task for full detail.",
    buckets: {
      overdue: "Overdue",
      today: "Due today",
      thisWeek: "This week",
      later: "Later / unscheduled",
    },
    loadFailed: "Your work could not be loaded.",
    loadFailedDetail:
      "This is a loading failure, not an empty workload — nothing has been changed or lost.",
    reviewHeading: "Waiting for your review",
    reviewQueue: "Review queue",
    blocked: "Blocked",
    noMatchTitle: "No tasks match these filters",
    noMatchBody: "Try widening a filter — or clear them to see all of your open work.",
    clearTitle: "Your workload is clear",
    clearBody:
      "When tasks are assigned to you — from projects, meetings, or conversations — they appear here grouped by due date.",
    upcomingMeetings: "Upcoming meetings",
  },
  board: {},
  tasks: {},
  dashboard: {},
};
