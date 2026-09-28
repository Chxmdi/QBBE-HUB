/**
 * English text for shell screens (#141). Mounted at the top level of the
 * catalogue; this file owns only these namespaces: shell.
 */
export const shellEn = {
  shell: {
    rateLimit: {
      soon: "You're doing that too quickly. Wait a moment and try again.",
      secondOne: "{count} second",
      secondOther: "{count} seconds",
      minuteOne: "{count} minute",
      minuteOther: "{count} minutes",
      later: "You're doing that too quickly. Try again in about {wait}.",
    },
    optional: "(optional)",
    loading: {
      generic: "Loading",
      board: "Loading the board",
      calendar: "Loading the calendar",
      messages: "Loading messages",
    },
    status: {
      task: {
        not_started: "Not started",
        ready: "Ready",
        in_progress: "In progress",
        waiting: "Waiting",
        blocked: "Blocked",
        in_review: "In review",
        completed: "Completed",
        cancelled: "Cancelled",
      },
      health: {
        on_track: "On track",
        at_risk: "At risk",
        off_track: "Off track",
        paused: "Paused",
        unknown: "No health set",
      },
      stage: {
        proposed: "Proposed",
        approved: "Approved",
        planning: "Planning",
        active: "Active",
        paused: "Paused",
        completed: "Completed",
        cancelled: "Cancelled",
        archived: "Archived",
      },
      priority: {
        low: "Low",
        medium: "Medium",
        high: "High",
        critical: "Critical",
      },
    },
    search: {
      title: "Search",
      resultsFor: "Results for “{query}”",
      resultOne: "{count} result you have access to.",
      resultOther: "{count} results you have access to.",
      intro:
        "Search across tasks, projects, programs, channels, messages, people, meetings, events, documents, risks, issues, opportunities, and relationships.",
      placeholder: "Search everything…",
      queryLabel: "Search query",
      submit: "Search",
      filterByType: "Filter by type",
      all: "All ({count})",
      tooShortTitle: "Type at least two characters",
      tooShortBody:
        "Search covers only records you're authorized to see — private channels and restricted records never appear for unauthorized viewers.",
      noResultsTitle: "No results for “{query}”",
      noResultsFiltered: "Try removing the type filter, or check the spelling.",
      noResultsBody: "Check the spelling, try a shorter phrase, or search for a person's name.",
      clearFilter: "Clear type filter",
      types: {
        person: { singular: "Person", plural: "People" },
        task: { singular: "Task", plural: "Tasks" },
        project: { singular: "Project", plural: "Projects" },
        program: { singular: "Program", plural: "Programs" },
        channel: { singular: "Channel", plural: "Channels" },
        meeting: { singular: "Meeting", plural: "Meetings" },
        event: { singular: "Event", plural: "Events" },
        agenda: { singular: "Agenda item", plural: "Agenda items" },
        contact: { singular: "Contact", plural: "Contacts" },
        document: { singular: "Document", plural: "Documents" },
        risk: { singular: "Risk", plural: "Risks" },
        issue: { singular: "Issue", plural: "Issues" },
        opportunity: { singular: "Opportunity", plural: "Opportunities" },
        crm: { singular: "Relationship", plural: "Relationships" },
        comment: { singular: "Comment", plural: "Comments" },
        message: { singular: "Message", plural: "Messages" },
      },
    },
    saved: {
      title: "Saved messages",
      eyebrow: "Communication",
      description:
        "Keep important conversations close at hand. Access is checked again each time you open a message.",
      emptyTitle: "No saved messages",
      emptyBody:
        "Use the message actions menu in a channel or direct message to save something for later.",
      directMessage: "Direct message",
      unknown: "Unknown",
      deleted: "This message was deleted.",
    },
  },
};
