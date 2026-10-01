/** English text for the private API screens (Workspace OS S6, V2-8). */
export const apiTokensEn = {
  eyebrow: "Private API",
  title: "API access tokens",
  description: "A token lets another tool call the Hub's API as you, with your permissions and nothing more.",
  docsLink: "Read the API documentation",
  create: {
    heading: "Make a token",
    name: "Name",
    nameHint: "What will use it, for example “Zapier: new tasks”.",
    scopes: "What it may do",
    days: "Expires after (days)",
    daysHint: "At most 365 days.",
    submit: "Make token",
    shownOnce: "Copy this token now. It will not be shown again.",
    tokenLabel: "Your new token",
  },
  scopes: {
    "objects:read": "Read objects, their properties and relations",
    "actions:run": "Run actions (change things)",
  },
  list: {
    mine: "Your tokens",
    all: "All tokens in the organization",
    empty: "No tokens yet.",
    name: "Name",
    owner: "Person",
    prefix: "Starts with",
    scopes: "Scopes",
    expires: "Expires",
    lastUsed: "Last used",
    never: "Never",
    status: "Status",
    active: "Active",
    revoked: "Revoked",
    expired: "Expired",
    revoke: "Revoke {name}",
    revokeLabel: "Revoke",
  },
  log: {
    heading: "Recent calls",
    empty: "No calls yet.",
    when: "When",
    call: "Call",
    status: "Result",
  },
  errors: {
    invalid: "Check the form: {detail}",
    createFailed: "The token could not be made.",
    revokeFailed: "The token could not be revoked.",
    notFound: "Not found.",
    staffOnly: "API tokens are for staff.",
  },
  docs: {
    title: "Private API",
    intro: "A versioned REST API for tools QBBE uses. Every call acts as the person the token belongs to, with exactly their permissions, and is recorded.",
  },
} as const;

type Widen<T> = { -readonly [K in keyof T]: T[K] extends string ? string : Widen<T[K]> };
export type ApiTokensMessages = Widen<typeof apiTokensEn>;
