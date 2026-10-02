/**
 * Wave 2 unit C3: its pages strings, read as t("units.c3.…"). Only C3 edits
 * this file and c3.fr-CA.ts (which must have exactly the same keys).
 */
export const c3PagesEn = {
  watch: {
    watch: "Watch",
    hint: "Get a notification when someone comments on this page.",
    watchingHint: "You get a notification when someone comments on this page. Press to stop.",
    started: "You're watching this page. New comments will reach you.",
    stopped: "You stopped watching this page.",
    failed: "Could not change watching. Try again.",
    notAllowed: "You can't watch this page.",
  },
  inbox: {
    comment: "comment",
    watched_page: "watched page",
  },
  preferences: {
    intro: "Untick a kind of notification to stop it altogether: it no longer appears in the Hub and is not emailed. Security notices and required announcements always arrive.",
    inHub: "Show in the Hub",
    description: "Choose what reaches your inbox, and when. Under “Show in the Hub”, choose what appears in the Hub.",
    assignmentHint: "Tasks, reviews, and decisions.",
    hub: {
      mention: "Mentions",
      assignment: "Assigned work",
      comment: "Comments",
      approval: "Approvals",
      watched_page: "Watched pages",
    },
    categories: {
      comment: {
        label: "Replies to my comments",
        hint: "Someone answers a comment you wrote on a page.",
      },
      approval: {
        label: "Approvals",
        hint: "Something waits for your approval, or your request was decided.",
      },
      watched_page: {
        label: "Watched pages",
        hint: "New comments on pages you watch.",
      },
    },
  },
};
