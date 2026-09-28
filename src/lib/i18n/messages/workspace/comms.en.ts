/**
 * English text for comms screens (#141). Mounted at the top level of the
 * catalogue; this file owns only these namespaces: inbox, channels, messages, announcements, comments.
 */
export const commsEn = {
  inbox: {
    title: "Inbox",
    eyebrow: "Unified triage",
    description:
      "Platform notifications, mentions, assignments, replies, and announcements in one place.",
    filtersLabel: "Inbox filters",
    filters: {
      all: "All",
      mention: "Mentions",
      assignment: "Assignments",
      reply: "Replies",
      due_date: "Due dates",
      approval: "Approvals",
      decision: "Decisions",
      announcement: "Announcements",
      mail: "Mail",
    },
    notificationsLabel: "Notifications",
    gmailNotConnectedTitle: "Gmail is not connected",
    gmailConnectPrompt:
      "Connect your QBBE Google account to list mail and securely reply without storing message bodies in QBBE Hub.",
    gmailNotConfigured:
      "Gmail stays disconnected until an administrator sets GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and the redirect URI. This is not a fake inbox.",
    noMailTitle: "No mail synced yet",
    noMailBody:
      "After a successful Gmail sync, thread metadata appears here. Message bodies are not stored in logs.",
    zeroTitle: "Inbox zero",
    zeroBody:
      "Notifications about mentions, assignments, replies, and announcements will arrive here.",
    fromTo: "From: {from} · To: {to}",
    noBody: "No plain-text body was supplied by Gmail.",
    unreadSummary: "{unread} unread of {shown} shown",
    connectedEmail: "Connected email",
    connected: "Connected",
    notConnected: "Not connected",
    lastSync: "Last sync: {when}",
    reconnectRequired: "Reconnect required: {error}",
    connectedHelp:
      "Compose new mail here or open a synced message to read it on demand and reply through Gmail. Existing connections using the older modify scope should reconnect to receive the narrower read + send grant.",
    connectHelp: "Connect Gmail to list mail and send/reply from a selected message.",
    configHelp:
      "Gmail integration requires a QBBE-approved Google OAuth configuration. Once credentials exist, Connect appears here.",
    connectGmail: "Connect Gmail",
    setupDocs: "See docs/runbooks/integrations.md for setup.",
  },
  channels: {},
  messages: {},
  announcements: {},
  comments: {},
};
