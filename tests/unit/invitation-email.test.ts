import { describe, expect, it } from "vitest";
import { renderInvitationEmail } from "@/features/notifications/services/email-templates";

const input = {
  link: "https://hub.example.org/sign-up?invite=abc_DEF-123",
  email: "new.person@example.org",
  organizationName: "Quebec Board of Black Educators",
  inviterName: "Ada <script>alert(1)</script>",
  role: "volunteer",
  expiresAt: "2026-11-05T15:00:00.000Z",
  timeZone: "America/Toronto",
};

describe("invitation email (SEC-001)", () => {
  it("carries the link in both the button and plain text, in French then English", () => {
    const { subject, text, html } = renderInvitationEmail(input);
    expect(subject).toBe("Invitation à QBBE Hub · You're invited to QBBE Hub");
    expect(html).toContain('href="https://hub.example.org/sign-up?invite=abc_DEF-123"');
    expect(text).toContain("https://hub.example.org/sign-up?invite=abc_DEF-123");
    expect(text.indexOf("Créer")).toBeLessThan(text.indexOf("Create"));
    expect(html).toContain('lang="fr-CA"');
    expect(html).toContain('lang="en"');
  });

  it("names the role and the address the link is for", () => {
    const { text } = renderInvitationEmail(input);
    expect(text).toContain("new.person@example.org");
    expect(text).toMatch(/bénévole|Bénévole/);
    expect(text).toMatch(/[Vv]olunteer/);
  });

  it("names every role in French without a broken 'de' + vowel construction", () => {
    for (const role of ["admin", "leadership_viewer", "staff", "volunteer", "guest"]) {
      const { text } = renderInvitationEmail({ ...input, role });
      expect(text).not.toMatch(/\bde [AEIOUÉÈÊaeiouéèê]/);
      expect(text).toContain("Rôle : ");
      expect(text).toContain("Role: ");
    }
  });

  it("marks the English half of the footer as English", () => {
    const { html } = renderInvitationEmail(input);
    expect(html).toMatch(/<span lang="en">Sent by QBBE Hub on behalf of [^<]+<\/span>/);
  });

  it("escapes what an administrator typed into their own name", () => {
    const { html } = renderInvitationEmail(input);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("does not point someone who is not a member at notification settings", () => {
    const { html } = renderInvitationEmail(input);
    expect(html).not.toContain("/settings/notifications");
  });
});
