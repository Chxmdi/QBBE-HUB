/**
 * The vocabulary of global search, in one place.
 *
 * Two surfaces render these results — the command palette and the search page
 * — and a result type that reaches either one without a label renders as its
 * raw database string ("crm", "result_type"). Keeping the list here, with a
 * test that every type carries a label, means adding a branch to
 * `global_search` and forgetting the UI is a failing test rather than a
 * shabby row in front of a user.
 *
 * The order matches the priority the SQL function round-robins by, so the two
 * halves of the feature describe the same thing in the same sequence.
 */

export const SEARCH_RESULT_TYPES = [
  "person",
  "task",
  "project",
  "program",
  "channel",
  "meeting",
  "event",
  "document",
  "risk",
  "issue",
  "crm",
  "message",
] as const;

export type SearchResultType = (typeof SEARCH_RESULT_TYPES)[number];

/**
 * Plural for the grouped headings and filter chips on the search page,
 * singular for the one-line hint beside a palette row.
 */
export const SEARCH_TYPE_LABELS: Record<
  SearchResultType,
  { singular: string; plural: string }
> = {
  person: { singular: "Person", plural: "People" },
  task: { singular: "Task", plural: "Tasks" },
  project: { singular: "Project", plural: "Projects" },
  program: { singular: "Program", plural: "Programs" },
  channel: { singular: "Channel", plural: "Channels" },
  meeting: { singular: "Meeting", plural: "Meetings" },
  event: { singular: "Event", plural: "Events" },
  document: { singular: "Document", plural: "Documents" },
  risk: { singular: "Risk", plural: "Risks" },
  issue: { singular: "Issue", plural: "Issues" },
  crm: { singular: "Relationship", plural: "Relationships" },
  message: { singular: "Message", plural: "Messages" },
};

function isKnown(type: string): type is SearchResultType {
  return type in SEARCH_TYPE_LABELS;
}

export function searchTypeLabel(
  type: string,
  form: "singular" | "plural" = "plural",
): string {
  return isKnown(type) ? SEARCH_TYPE_LABELS[type][form] : type;
}

/** Search-page ordering, so headings appear in the same order every time. */
export function searchTypeOrder(type: string): number {
  const index = SEARCH_RESULT_TYPES.indexOf(type as SearchResultType);
  return index === -1 ? SEARCH_RESULT_TYPES.length : index;
}
