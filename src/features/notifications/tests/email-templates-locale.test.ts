import { describe, expect, it } from "vitest";
import {
  categoryLabel,
  renderDigestEmail,
  renderNotificationEmail,
} from "@/features/notifications/services/email-templates";
import { encodeHeader } from "@/lib/smtp";

process.env.NEXT_PUBLIC_APP_URL = "https://hub.example.org";

describe("email in the recipient's language (#141)", () => {
  it("keeps English when the profile has no language", () => {
    const email = renderNotificationEmail({
      title: "Review the brief",
      body: null,
      category: "assignment",
      link: "/my-work",
      recipientName: "Amara",
      organizationName: "QBBE",
      dueOn: "2026-08-20",
      locale: null,
    });
    expect(email.html).toContain('<html lang="en">');
    expect(email.text).toContain("Due: 2026-08-20");
    expect(email.text).toContain("Manage email preferences:");
  });

  it("writes a notification in Quebec French", () => {
    const email = renderNotificationEmail({
      title: "Réviser le mémoire",
      body: null,
      category: "assignment",
      link: "/my-work",
      recipientName: "Amara",
      organizationName: "QBBE",
      dueOn: "2026-08-20",
      locale: "fr-CA",
    });
    expect(email.html).toContain('<html lang="fr-CA">');
    expect(email.html).toContain("Ouvrir dans QBBE Hub");
    expect(email.html).toContain("Qui vous est confié");
    expect(email.text).toContain("Échéance : 20 août 2026");
    expect(email.text).toContain("Gérer les préférences de courriel");
  });

  it("writes a digest in Quebec French", () => {
    const digest = renderDigestEmail({
      recipientName: "Amara",
      organizationName: "QBBE",
      groups: [],
      totalCount: 23,
      shownCount: 20,
      locale: "fr-CA",
    });
    expect(digest.subject).toBe("23 mises à jour en attente dans QBBE Hub");
    expect(digest.text).toContain("Bonjour Amara,");
    expect(digest.text).toContain("…et 3 de plus.");
  });

  it("keeps the English category label when no translator is given", () => {
    expect(categoryLabel("overdue")).toBe("Overdue work");
    expect(categoryLabel("something-new")).toBe("Updates");
  });
});

describe("SMTP subject header", () => {
  it("leaves ASCII alone and encodes accented subjects", () => {
    expect(encodeHeader("1 update waiting in QBBE Hub")).toBe("1 update waiting in QBBE Hub");
    const encoded = encodeHeader("1 mise à jour");
    expect(encoded).toMatch(/^=\?UTF-8\?B\?.+\?=$/);
    expect(Buffer.from(encoded.slice(10, -2), "base64").toString("utf8")).toBe("1 mise à jour");
  });
});
