import { describe, expect, it } from "vitest";
import {
  escapeHtml,
  renderDigestEmail,
  renderNotificationEmail,
  safeLink,
} from "@/features/notifications/services/email-templates";

/**
 * Email bodies carry whatever people typed into a task title, and land in
 * clients that render HTML with no CSP behind them. Escaping and link safety
 * are therefore behaviour worth pinning down, not incidental detail.
 */

// Set before the describe bodies run, because several of them render a
// template at collection time.
process.env.NEXT_PUBLIC_APP_URL = "https://hub.example.org";

describe("escaping", () => {
  it("neutralises markup in interpolated text", () => {
    expect(escapeHtml(`<script>alert("x")</script>`)).toBe(
      "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;",
    );
  });

  it("escapes ampersands before anything else", () => {
    expect(escapeHtml("Tom & Jerry <b>")).toBe("Tom &amp; Jerry &lt;b&gt;");
  });
});

describe("safeLink", () => {
  it("makes an in-app path absolute", () => {
    expect(safeLink("/my-work?task=abc")).toBe(
      "https://hub.example.org/my-work?task=abc",
    );
  });

  it("refuses an external destination", () => {
    expect(safeLink("https://evil.example/steal")).toBe("https://hub.example.org/");
    expect(safeLink("//evil.example/steal")).toBe("https://hub.example.org/");
  });

  it("falls back to home for a missing link", () => {
    expect(safeLink(null)).toBe("https://hub.example.org/");
  });
});

describe("renderNotificationEmail", () => {
  const email = renderNotificationEmail({
    title: `Review "Q3 <report>"`,
    body: "Due Friday & needs sign-off",
    category: "assignment",
    link: "/my-work?task=t1",
    recipientName: "Amara",
    organizationName: "QBBE",
  });

  it("uses the notification title as the subject, unescaped", () => {
    expect(email.subject).toBe(`Review "Q3 <report>"`);
  });

  it("escapes the same text in the HTML body", () => {
    expect(email.html).toContain("Review &quot;Q3 &lt;report&gt;&quot;");
    expect(email.html).not.toContain("<report>");
  });

  it("gives both bodies a working absolute deep link", () => {
    const href = "https://hub.example.org/my-work?task=t1";
    expect(email.text).toContain(href);
    expect(email.html).toContain(href);
  });

  it("offers a way out in every message", () => {
    expect(email.text).toContain("https://hub.example.org/settings/notifications");
    expect(email.html).toContain("https://hub.example.org/settings/notifications");
  });

  it("omits the body block when there is no body", () => {
    const bodyless = renderNotificationEmail({
      title: "Assigned to you",
      body: null,
      category: "assignment",
      link: "/my-work",
      recipientName: "Amara",
      organizationName: "QBBE",
    });
    expect(bodyless.html).toContain("Assigned to you");
  });
});

describe("renderDigestEmail", () => {
  const digest = renderDigestEmail({
    recipientName: "Amara",
    organizationName: "QBBE",
    groups: [
      {
        category: "assignment",
        items: [
          {
            title: "Draft the funding letter",
            body: null,
            category: "assignment",
            link: "/my-work?task=t1",
            createdAt: "2026-08-19T12:00:00Z",
          },
        ],
      },
    ],
    totalCount: 23,
    shownCount: 20,
  });

  it("counts the whole backlog in the subject", () => {
    expect(digest.subject).toBe("23 updates waiting in QBBE Hub");
  });

  it("says how many were left out", () => {
    expect(digest.text).toContain("and 3 more");
    expect(digest.html).toContain("and 3 more");
  });

  it("uses a singular subject for a single item", () => {
    const one = renderDigestEmail({
      recipientName: "Amara",
      organizationName: "QBBE",
      groups: [],
      totalCount: 1,
      shownCount: 1,
    });
    expect(one.subject).toBe("1 update waiting in QBBE Hub");
  });

  it("links each item and the inbox", () => {
    expect(digest.html).toContain("https://hub.example.org/my-work?task=t1");
    expect(digest.html).toContain("https://hub.example.org/inbox");
  });
});
