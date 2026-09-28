/**
 * Outbound email bodies.
 *
 * Plain text and HTML are built from the same data, so the two can never
 * disagree. Every link is absolute — a relative href in an email client goes
 * nowhere — and every interpolated value is escaped, because notification
 * titles carry whatever a person typed into a task.
 *
 * The HTML uses table layout and inline styles on purpose: email clients drop
 * external stylesheets, and several still ignore flexbox and CSS custom
 * properties.
 */

import { absoluteUrl } from "@/lib/env";
import { htmlLang, isLocale, type Locale } from "@/lib/i18n/config";
import { formattersFor } from "@/lib/i18n/format";
import { createTranslator, type MessageKey, type TranslateFn } from "@/lib/i18n/translate";

/**
 * Mail goes out in the recipient's saved language (`user_profile.locale`),
 * never the language of whoever triggered it. Null or unknown means English.
 */
function recipientLocale(value: string | null | undefined): Locale {
  return isLocale(value) ? value : "en";
}

// Email clients ignore CSS custom properties, so these are literals. They
// are the light-theme design tokens from globals.css and a test holds them
// there: these were the pre-rebrand wine and warm greys, so every
// notification email went out in the old brand after #48.
export const EMAIL_COLORS = {
  brand: "#2a3c90", // --color-brand
  ink: "#192240", // --color-ink
  muted: "#5b6e7f", // --color-muted
  line: "#dfe4ef", // --color-line
  canvas: "#f7f8fc", // --color-canvas
  surface: "#ffffff", // --color-surface
} as const;
const BRAND = EMAIL_COLORS.brand;
const INK = EMAIL_COLORS.ink;
const MUTED = EMAIL_COLORS.muted;
const LINE = EMAIL_COLORS.line;
const CANVAS = EMAIL_COLORS.canvas;

export interface EmailBody {
  subject: string;
  text: string;
  html: string;
}

export interface NotificationEmailInput {
  title: string;
  body: string | null;
  category: string;
  link: string | null;
  recipientName: string;
  organizationName: string;
  /** Why the recipient got this: assigned, mentioned, asked to review. */
  action?: string | null;
  context?: string | null;
  ownerLabel?: string | null;
  dueOn?: string | null;
  /** The recipient's `user_profile.locale`; null means English. */
  locale?: string | null;
}

export interface DigestItem {
  title: string;
  body: string | null;
  category: string;
  link: string | null;
  createdAt: string;
  /** When set, the digest groups by this section instead of by category. */
  section?: string;
}

export interface DigestEmailInput {
  recipientName: string;
  organizationName: string;
  groups: { category: string; items: DigestItem[] }[];
  totalCount: number;
  shownCount: number;
  /** The recipient's `user_profile.locale`; null means English. */
  locale?: string | null;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Only in-app paths become links. An absolute or protocol-relative value in
 * `link` would let stored data point our email at someone else's host, so it
 * is dropped in favour of the Hub's home (SEC-003).
 */
export function safeLink(path: string | null | undefined): string {
  if (!path || !path.startsWith("/") || path.startsWith("//")) {
    return absoluteUrl("/");
  }
  return absoluteUrl(path);
}

export const CATEGORY_LABELS: Record<string, string> = {
  assignment: "Assigned to you",
  mention: "Mentions",
  reply: "Replies",
  announcement: "Announcements",
  due_date: "Due dates",
  approval: "Approvals",
  decision: "Decisions",
  security: "Security",
  system: "Updates",
  activity: "General activity",
  upcoming: "Upcoming deadlines",
  overdue: "Overdue work",
  stale: "Stale projects",
  meetings: "Meeting reminders",
};

/**
 * The heading for a category. `CATEGORY_LABELS` keeps the English wording;
 * pass `t` for another language.
 */
export function categoryLabel(category: string, t?: TranslateFn): string {
  if (!t) return CATEGORY_LABELS[category] ?? "Updates";
  return category in CATEGORY_LABELS
    ? t(`notifications.email.categories.${category}` as MessageKey)
    : t("notifications.email.fallbackCategory");
}

function shell(
  heading: string,
  inner: string,
  footerNote: string,
  locale: Locale,
  t: TranslateFn,
): string {
  return `<!doctype html>
<html lang="${htmlLang(locale)}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(heading)}</title></head>
<body style="margin:0;padding:0;background:${CANVAS};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CANVAS};padding:24px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:${EMAIL_COLORS.surface};border:1px solid ${LINE};border-radius:10px;">
<tr><td style="padding:20px 24px;border-bottom:1px solid ${LINE};">
<span style="font:600 14px/1.2 -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:${BRAND};letter-spacing:.04em;text-transform:uppercase;">QBBE Hub</span>
</td></tr>
<tr><td style="padding:24px;font:400 15px/1.55 -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:${INK};">
${inner}
</td></tr>
<tr><td style="padding:16px 24px;border-top:1px solid ${LINE};font:400 12px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:${MUTED};">
${escapeHtml(footerNote)} <a href="${safeLink("/settings/notifications")}" style="color:${BRAND};">${escapeHtml(t("notifications.email.manage"))}</a>.
</td></tr>
</table>
</td></tr></table>
</body></html>`;
}

function button(href: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:20px 0 4px;"><tr><td style="background:${BRAND};border-radius:7px;">
<a href="${href}" style="display:inline-block;padding:10px 18px;font:600 14px/1 -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:${EMAIL_COLORS.surface};text-decoration:none;">${escapeHtml(label)}</a>
</td></tr></table>`;
}

/**
 * A due date as the recipient reads it. English keeps the stored
 * `YYYY-MM-DD`, as it always has; French gets "20 août 2026". The value is a
 * calendar date, so it is read at noon UTC and cannot slip a day.
 */
function dueLabel(dueOn: string | null | undefined, locale: Locale): string | null | undefined {
  if (!dueOn || locale === "en" || !/^\d{4}-\d{2}-\d{2}$/.test(dueOn)) return dueOn;
  return formattersFor(locale).date(`${dueOn}T12:00:00Z`, "UTC");
}

// Why the recipient is told, as jobs store it: a code, or several joined by
// ", " when notifications merge. Known codes read in the recipient's language;
// anything else is shown as stored.
const REASON_KEYS: Record<string, MessageKey> = {
  "assigned": "notifications.email.reasons.assigned",
  "mentioned": "notifications.email.reasons.mentioned",
  "reply": "notifications.email.reasons.reply",
  "approved": "notifications.email.reasons.approved",
  "decision requested": "notifications.email.reasons.decisionRequested",
  "due date changed": "notifications.email.reasons.dueDateChanged",
  "due date": "notifications.email.reasons.dueDate",
  "grant report due": "notifications.email.reasons.grantReportDue",
  "project closed": "notifications.email.reasons.projectClosed",
  "resubmitted": "notifications.email.reasons.resubmitted",
  "review requested": "notifications.email.reasons.reviewRequested",
  "role": "notifications.email.reasons.role",
  "sponsor": "notifications.email.reasons.sponsor",
  "stale project": "notifications.email.reasons.staleProject",
  "work signal": "notifications.email.reasons.workSignal",
  "announcement": "notifications.email.reasons.announcement",
};

function actionLabel(action: string | null | undefined, t: TranslateFn): string | null | undefined {
  if (!action) return action;
  return action
    .split(", ")
    .map((part) => (REASON_KEYS[part] ? t(REASON_KEYS[part]) : part))
    .join(", ");
}

/** A single notification, sent as it happens. */
export function renderNotificationEmail(input: NotificationEmailInput): EmailBody {
  const locale = recipientLocale(input.locale);
  const t = createTranslator(locale);
  const detailLine = (label: MessageKey, value: string | null | undefined): string | null =>
    value ? t("notifications.email.detailLine", { label: t(label), value }) : null;

  const href = safeLink(input.link);
  const subject = input.title;
  const details = [
    detailLine("notifications.email.detail.action", actionLabel(input.action, t)),
    detailLine("notifications.email.detail.context", input.context),
    detailLine("notifications.email.detail.owner", input.ownerLabel),
    detailLine("notifications.email.detail.due", dueLabel(input.dueOn, locale)),
  ].filter((line): line is string => Boolean(line));

  const text = [
    `${input.title}`,
    details.length ? `\n${details.join("\n")}` : "",
    input.body ? `\n${input.body}` : "",
    `\n\n${t("notifications.email.openIt", { url: href })}`,
    `\n\n— ${input.organizationName} · QBBE Hub`,
    `\n${t("notifications.email.manageText", { url: safeLink("/settings/notifications") })}`,
  ].join("");

  const detailHtml = details
    .map(
      (line) =>
        `<p style="margin:8px 0 0;font-size:14px;">${escapeHtml(line)}</p>`,
    )
    .join("");

  const inner = `
<p style="margin:0 0 4px;font:600 18px/1.35 -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">${escapeHtml(input.title)}</p>
<p style="margin:0;font-size:13px;color:${MUTED};">${escapeHtml(categoryLabel(input.category, t))}</p>
${detailHtml}
${input.body ? `<p style="margin:14px 0 0;">${escapeHtml(input.body)}</p>` : ""}
${button(href, t("notifications.email.openInHub"))}`;

  return {
    subject,
    text,
    html: shell(
      subject,
      inner,
      t("notifications.email.sentTo", {
        name: input.recipientName,
        organization: input.organizationName,
      }),
      locale,
      t,
    ),
  };
}

/** The grouped digest of everything still unread. */
export function renderDigestEmail(input: DigestEmailInput): EmailBody {
  const locale = recipientLocale(input.locale);
  const t = createTranslator(locale);
  const count = (value: number) => formattersFor(locale).number(value);
  const subject =
    input.totalCount === 1
      ? t("notifications.email.digestSubjectOne")
      : t("notifications.email.digestSubjectOther", { count: count(input.totalCount) });
  const more = (value: number) => t("notifications.email.more", { count: count(value) });

  const overflow = input.totalCount - input.shownCount;

  const textGroups = input.groups
    .map(
      (group) =>
        `${categoryLabel(group.category, t).toUpperCase()}\n` +
        group.items
          .map((item) => `  · ${item.title}\n    ${safeLink(item.link)}`)
          .join("\n"),
    )
    .join("\n\n");

  const text = [
    t("notifications.email.hello", { name: input.recipientName }),
    ``,
    t("notifications.email.waiting"),
    ``,
    textGroups,
    overflow > 0 ? `\n${more(overflow)}` : "",
    ``,
    t("notifications.email.openInboxText", { url: safeLink("/inbox") }),
    t("notifications.email.manageText", { url: safeLink("/settings/notifications") }),
  ].join("\n");

  const htmlGroups = input.groups
    .map(
      (group) => `
<p style="margin:22px 0 8px;font:600 12px/1 -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;letter-spacing:.06em;text-transform:uppercase;color:${MUTED};">${escapeHtml(categoryLabel(group.category, t))}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
${group.items
  .map(
    (item) => `<tr><td style="padding:7px 0;border-top:1px solid ${LINE};">
<a href="${safeLink(item.link)}" style="font-weight:600;color:${INK};text-decoration:none;">${escapeHtml(item.title)}</a>
${item.body ? `<br><span style="font-size:13px;color:${MUTED};">${escapeHtml(item.body)}</span>` : ""}
</td></tr>`,
  )
  .join("")}
</table>`,
    )
    .join("");

  const inner = `
<p style="margin:0 0 4px;font:600 18px/1.35 -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">${escapeHtml(t("notifications.email.hello", { name: input.recipientName }))}</p>
<p style="margin:0;color:${MUTED};font-size:14px;">${escapeHtml(t("notifications.email.waiting"))}</p>
${htmlGroups}
${overflow > 0 ? `<p style="margin:18px 0 0;font-size:13px;color:${MUTED};">${escapeHtml(more(overflow))}</p>` : ""}
${button(safeLink("/inbox"), t("notifications.email.openInbox"))}`;

  return {
    subject,
    text,
    html: shell(
      subject,
      inner,
      t("notifications.email.digestFooter", {
        name: input.recipientName,
        organization: input.organizationName,
      }),
      locale,
      t,
    ),
  };
}

export interface TeamDigestEmailInput {
  /** The recipient's `user_profile.locale`; null means English. */
  locale?: string | null;
  recipientName: string;
  organizationName: string;
  /** Only people with open signals; each reason already in the recipient's language. */
  people: { name: string; link: string; reasons: string[] }[];
}

/**
 * The weekly team digest for owners and admins (#136, phase 3). Lists only
 * people with open work signals, each with the facts behind it and a link to
 * their work summary. Nothing about sign-ins or time online.
 */
export function renderTeamDigestEmail(input: TeamDigestEmailInput): EmailBody {
  const locale = recipientLocale(input.locale);
  const t = createTranslator(locale);
  const count = formattersFor(locale).number(input.people.length);
  const subject =
    input.people.length === 1
      ? t("jobs.teamDigest.subjectOne")
      : t("jobs.teamDigest.subjectOther", { count });
  const hello = t("notifications.email.hello", { name: input.recipientName });
  const intro = t("jobs.teamDigest.intro");

  const text = [
    hello,
    ``,
    intro,
    ``,
    ...input.people.map(
      (person) =>
        `${person.name}\n${person.reasons.map((reason) => `  · ${reason}`).join("\n")}\n  ${safeLink(person.link)}`,
    ),
    ``,
    `${t("jobs.teamDigest.openOverview")}: ${safeLink("/people/overview")}`,
  ].join("\n");

  const rows = input.people
    .map(
      (person) => `<tr><td style="padding:9px 0;border-top:1px solid ${LINE};">
<a href="${safeLink(person.link)}" style="font-weight:600;color:${INK};text-decoration:none;">${escapeHtml(person.name)}</a>
<ul style="margin:4px 0 0;padding-left:18px;font-size:13px;color:${MUTED};">${person.reasons
        .map((reason) => `<li>${escapeHtml(reason)}</li>`)
        .join("")}</ul>
</td></tr>`,
    )
    .join("");

  const inner = `
<p style="margin:0 0 4px;font:600 18px/1.35 -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">${escapeHtml(hello)}</p>
<p style="margin:0 0 14px;color:${MUTED};font-size:14px;">${escapeHtml(intro)}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>
${button(safeLink("/people/overview"), t("jobs.teamDigest.openOverview"))}`;

  return {
    subject,
    text,
    html: shell(
      subject,
      inner,
      t("jobs.teamDigest.footer", { organization: input.organizationName }),
      locale,
      t,
    ),
  };
}
