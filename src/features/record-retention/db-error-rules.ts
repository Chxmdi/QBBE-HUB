import type { DbErrorRule } from "@/lib/db-error";

/**
 * The records retention and legal hold refusals people can meet, as the database words them, each
 * with its catalogue key. Anything not listed reaches the reader as the
 * action's generic message (and is logged), never as raw database text.
 * Groups capture the values the sentence carries, in the order of `params`;
 * a value the database writes in English (a label) is captured but not shown.
 */
export const RECORD_DB_ERRORS: readonly DbErrorRule[] = [
  { key: "records.dbErrors.permanent", pattern: /^(?:(?:.+) are kept permanently; they have no retention period to set\.)$/ },
  { key: "records.dbErrors.minYears", pattern: /^(?:(.+) must be kept for at least (\d+) years\.)$/, params: ["_category", "years"] },
  { key: "records.dbErrors.enterYears", pattern: /^(?:Enter how many years (?:.+) are kept\.)$/ },
  { key: "records.dbErrors.unknownCategory", pattern: /^(?:There is no record category called "(?:.+)"\.)$/ },
  { key: "records.dbErrors.holdNoEdit", pattern: /^(?:A hold cannot be edited, only released\.)$/ },
  { key: "records.dbErrors.holdOrder", pattern: /^(?:A hold is placed first and released later\.)$/ },
  { key: "records.dbErrors.releaseReason", pattern: /^(?:Say why the hold is being released\.)$/ },
  { key: "records.dbErrors.recordMissing", pattern: /^(?:That record does not exist in this organization\.)$/ },
  { key: "records.dbErrors.holdReleased", pattern: /^(?:This hold has already been released\.)$/ },
  { key: "records.dbErrors.shortensForever", pattern: /^(?:This change would shorten how long the record must be kept \(until permanently\)\.)$/ },
  { key: "records.dbErrors.shortens", pattern: /^(?:This change would shorten how long the record must be kept \(until (\d{4}-\d{2}-\d{2})\)\.)$/, params: ["date"] },
  { key: "records.dbErrors.underHold", pattern: /^(?:This record is under legal hold and cannot be reclassified\.)$/ },
];
