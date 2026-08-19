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

const BRAND = "#8f1538";
const INK = "#1c1917";
const MUTED = "#57534e";
const LINE = "#e7e2df";
const CANVAS = "#faf8f7";

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
}

export interface DigestItem {
  title: string;
  body: string | null;
  category: string;
  link: string | null;
  createdAt: string;
}

export interface DigestEmailInput {
  recipientName: string;
  organizationName: string;
  groups: { category: string; items: DigestItem[] }[];
  totalCount: number;
  shownCount: number;
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
  security: "Security",
  system: "Updates",
};

export function categoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? "Updates";
}

function shell(heading: string, inner: string, footerNote: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(heading)}</title></head>
<body style="margin:0;padding:0;background:${CANVAS};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CANVAS};padding:24px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid ${LINE};border-radius:10px;">
<tr><td style="padding:20px 24px;border-bottom:1px solid ${LINE};">
<span style="font:600 14px/1.2 -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:${BRAND};letter-spacing:.04em;text-transform:uppercase;">QBBE Hub</span>
</td></tr>
<tr><td style="padding:24px;font:400 15px/1.55 -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:${INK};">
${inner}
</td></tr>
<tr><td style="padding:16px 24px;border-top:1px solid ${LINE};font:400 12px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:${MUTED};">
${escapeHtml(footerNote)} <a href="${safeLink("/settings/notifications")}" style="color:${BRAND};">Manage email preferences</a>.
</td></tr>
</table>
</td></tr></table>
</body></html>`;
}

function button(href: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:20px 0 4px;"><tr><td style="background:${BRAND};border-radius:7px;">
<a href="${href}" style="display:inline-block;padding:10px 18px;font:600 14px/1 -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#ffffff;text-decoration:none;">${escapeHtml(label)}</a>
</td></tr></table>`;
}

/** A single notification, sent as it happens. */
export function renderNotificationEmail(input: NotificationEmailInput): EmailBody {
  const href = safeLink(input.link);
  const subject = input.title;

  const text = [
    `${input.title}`,
    input.body ? `\n${input.body}` : "",
    `\n\nOpen it: ${href}`,
    `\n\n— ${input.organizationName} · QBBE Hub`,
    `\nManage email preferences: ${safeLink("/settings/notifications")}`,
  ].join("");

  const inner = `
<p style="margin:0 0 4px;font:600 18px/1.35 -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">${escapeHtml(input.title)}</p>
<p style="margin:0;font-size:13px;color:${MUTED};">${escapeHtml(categoryLabel(input.category))}</p>
${input.body ? `<p style="margin:14px 0 0;">${escapeHtml(input.body)}</p>` : ""}
${button(href, "Open in QBBE Hub")}`;

  return {
    subject,
    text,
    html: shell(subject, inner, `Sent to ${input.recipientName} by ${input.organizationName}.`),
  };
}

/** The grouped digest of everything still unread. */
export function renderDigestEmail(input: DigestEmailInput): EmailBody {
  const subject =
    input.totalCount === 1
      ? "1 update waiting in QBBE Hub"
      : `${input.totalCount} updates waiting in QBBE Hub`;

  const overflow = input.totalCount - input.shownCount;

  const textGroups = input.groups
    .map(
      (group) =>
        `${categoryLabel(group.category).toUpperCase()}\n` +
        group.items
          .map((item) => `  · ${item.title}\n    ${safeLink(item.link)}`)
          .join("\n"),
    )
    .join("\n\n");

  const text = [
    `Hello ${input.recipientName},`,
    ``,
    `Here is what is waiting for you.`,
    ``,
    textGroups,
    overflow > 0 ? `\n…and ${overflow} more.` : "",
    ``,
    `Open your inbox: ${safeLink("/inbox")}`,
    `Manage email preferences: ${safeLink("/settings/notifications")}`,
  ].join("\n");

  const htmlGroups = input.groups
    .map(
      (group) => `
<p style="margin:22px 0 8px;font:600 12px/1 -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;letter-spacing:.06em;text-transform:uppercase;color:${MUTED};">${escapeHtml(categoryLabel(group.category))}</p>
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
<p style="margin:0 0 4px;font:600 18px/1.35 -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">Hello ${escapeHtml(input.recipientName)},</p>
<p style="margin:0;color:${MUTED};font-size:14px;">Here is what is waiting for you.</p>
${htmlGroups}
${overflow > 0 ? `<p style="margin:18px 0 0;font-size:13px;color:${MUTED};">…and ${overflow} more.</p>` : ""}
${button(safeLink("/inbox"), "Open your inbox")}`;

  return {
    subject,
    text,
    html: shell(subject, inner, `Daily digest for ${input.recipientName}, ${input.organizationName}.`),
  };
}
