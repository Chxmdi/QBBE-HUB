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
 *
 * The summary is written once, in the language of the person completing the
 * meeting; `t` defaults to English so tests and callers without a request
 * keep the wording they always had.
 */

import { createTranslator, type TranslateFn } from "@/lib/i18n/translate";

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

export function composeMeetingSummary(
  input: MeetingSummaryInput,
  t: TranslateFn = createTranslator("en"),
): string {
  const attendeeNames = input.attendees
    .map((a) => a.fullName)
    .filter((name): name is string => Boolean(name))
    .sort((a, b) => a.localeCompare(b));

  return [
    t("meetings.summary.heading", { title: input.title }),
    "",
    attendeeNames.length > 0
      ? t("meetings.summary.attendees", { names: attendeeNames.join(", ") })
      : t("meetings.summary.attendeesNone"),
    "",
    input.decisions.length > 0
      ? `${t("meetings.summary.decisions")}\n${input.decisions.map((d) => `• ${d.title}`).join("\n")}`
      : t("meetings.summary.decisionsNone"),
    "",
    input.actions.length > 0
      ? `${t("meetings.summary.actions")}\n${input.actions
          .map(
            (a) =>
              `• ${a.title}${a.ownerName ? ` — ${a.ownerName}` : ""}${a.dueAt ? t("meetings.summary.due", { date: a.dueAt }) : ""}`,
          )
          .join("\n")}`
      : t("meetings.summary.actionsNone"),
  ].join("\n");
}
