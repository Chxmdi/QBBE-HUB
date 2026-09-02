/**
 * Composes the summary a completed meeting posts to its channel.
 *
 * Extracted from `completeMeeting` so the body can be tested without a
 * database. The specification lists what a summary must cover, and until this
 * was a function the only way to check it was to read the action and believe
 * the reading — which is how the attendees line came to be missing for as long
 * as it was.
 *
 * The `none recorded` fallbacks are deliberate rather than an omission of the
 * line. A summary that silently drops its Decisions heading reads as though
 * the meeting had none *and* as though the section was never meant to be
 * there; saying "none recorded" distinguishes "we decided nothing" from
 * "nobody wrote anything down", which are different meetings.
 */

export interface SummaryAttendee {
  fullName: string | null;
}

export interface SummaryDecision {
  title: string;
}

export interface SummaryAction {
  title: string;
  dueAt: string | null;
  ownerName: string | null;
}

export interface MeetingSummaryInput {
  title: string;
  attendees: SummaryAttendee[];
  decisions: SummaryDecision[];
  actions: SummaryAction[];
}

export function composeMeetingSummary(input: MeetingSummaryInput): string {
  const attendeeNames = input.attendees
    .map((a) => a.fullName)
    .filter((name): name is string => Boolean(name))
    .sort((a, b) => a.localeCompare(b));

  return [
    `Meeting summary — ${input.title}`,
    "",
    attendeeNames.length > 0
      ? `Attendees: ${attendeeNames.join(", ")}`
      : "Attendees: none recorded",
    "",
    input.decisions.length > 0
      ? `Decisions:\n${input.decisions.map((d) => `• ${d.title}`).join("\n")}`
      : "Decisions: none recorded",
    "",
    input.actions.length > 0
      ? `Actions:\n${input.actions
          .map(
            (a) =>
              `• ${a.title}${a.ownerName ? ` — ${a.ownerName}` : ""}${a.dueAt ? ` (due ${a.dueAt})` : ""}`,
          )
          .join("\n")}`
      : "Actions: none recorded",
  ].join("\n");
}
