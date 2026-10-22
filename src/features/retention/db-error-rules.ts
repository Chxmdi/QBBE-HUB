import type { DbErrorRule } from "@/lib/db-error";

/**
 * The retention policy refusals people can meet, as the database words them, each
 * with its catalogue key. Anything not listed reaches the reader as the
 * action's generic message (and is logged), never as raw database text.
 * Groups capture the values the sentence carries, in the order of `params`;
 * a value the database writes in English (a label) is captured but not shown.
 */
export const RETENTION_DB_ERRORS: readonly DbErrorRule[] = [
  { key: "retention.dbErrors.actionNotAllowed", pattern: /^(?:(?:.+) cannot be set to "(?:.+)" — allowed here: (?:.+)\.)$/ },
  { key: "retention.dbErrors.tooShort", pattern: /^(?:Retention for (.+) cannot be shorter than (\d+) days\.)$/, params: ["_subject", "days"] },
  { key: "retention.dbErrors.unknownSubject", pattern: /^(?:There is no retention subject called "(?:.+)"\.)$/ },
];
