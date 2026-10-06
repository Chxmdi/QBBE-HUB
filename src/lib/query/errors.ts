/** Why the engine refused a spec. The database uses the same codes. */
export const QUERY_ERROR_CODES = [
  "invalid_spec",
  "unknown_type",
  "unknown_property",
  "bad_operator",
  "bad_value",
  "not_sortable",
  "not_groupable",
  "too_complex",
  "signed_out",
  "failed",
] as const;
export type QueryErrorCode = (typeof QUERY_ERROR_CODES)[number];

/** A refused or failed lens query. Messages never repeat the caller's text. */
export class QueryError extends Error {
  constructor(
    readonly code: QueryErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "QueryError";
  }
}

/**
 * Turns a PostgREST error from `lens_query` into a QueryError. The database
 * raises `lens:<code>: <sentence>`; anything else (a timeout, a network error)
 * is `failed`, with a generic message so no database detail reaches a screen.
 */
export function queryErrorFrom(error: { message?: string } | null | undefined): QueryError {
  const match = /^lens:([a-z_]+): (.*)$/s.exec(error?.message ?? "");
  if (match && (QUERY_ERROR_CODES as readonly string[]).includes(match[1])) {
    return new QueryError(match[1] as QueryErrorCode, match[2]);
  }
  return new QueryError("failed", "The lens could not be loaded.");
}

/**
 * True when the engine refused the query because of what it asked for (an
 * unknown type or property, an operator the kind does not take, a shape the
 * engine cannot express), as opposed to a failure running it. Screens turn a
 * refusal into a plain "cannot show this" notice and let a failure reach the
 * error boundary.
 */
export function isQueryRefusal(error: unknown): error is QueryError {
  return error instanceof QueryError && error.code !== "failed" && error.code !== "signed_out";
}
