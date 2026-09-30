import { describe, expect, it } from "vitest";
import { catalogKeys } from "@/features/universal-tasks/i18n/module-i18n";
import { filingChoices } from "../choices";
import { parseForwardedEmail } from "../email";
import { captureCatalogs, captureT } from "../i18n";
import { senderAddress, suggestContact, suggestFiling, suggestProjects, type CaptureText } from "../suggest";

const GALA = "3f1c2b8e-1111-4a1a-9a1a-111111111111";
const projects = [
  { id: GALA, name: "Spring Gala 2027" },
  { id: "3f1c2b8e-2222-4a1a-9a1a-222222222222", name: "Tutoring & Mentorship" },
  { id: "3f1c2b8e-3333-4a1a-9a1a-333333333333", name: "Éducation des parents" },
];
const contacts = [
  { id: "c1", full_name: "Marie Tremblay", email: "Marie@Example.org", crm_organization_id: "o1", organization_name: "Fondation" },
  { id: "c2", full_name: "Duplicate A", email: "same@example.org", crm_organization_id: "o2", organization_name: null },
  { id: "c3", full_name: "Duplicate B", email: "same@example.org", crm_organization_id: "o3", organization_name: null },
];

function capture(overrides: Partial<CaptureText> = {}): CaptureText {
  return { kind: "text", title: "", body: null, url: null, email_from: null, ...overrides };
}

describe("forwarded emails", () => {
  it("reads From, Subject and the body of an English forward", () => {
    const email = parseForwardedEmail(
      [
        "FYI",
        "---------- Forwarded message ---------",
        "From: Marie Tremblay <marie@example.org>",
        "Date: Tue, Sep 29, 2026 at 10:00 AM",
        "Subject: Venue for the Spring Gala 2027",
        "To: QBBE <info@qbbe.org>",
        "",
        "Hello, the hall is free on May 8.",
      ].join("\n"),
    );
    expect(email).toEqual({
      from: "Marie Tremblay <marie@example.org>",
      fromAddress: "marie@example.org",
      subject: "Venue for the Spring Gala 2027",
      body: "Hello, the hall is free on May 8.",
    });
  });

  it("reads French headers", () => {
    const email = parseForwardedEmail("De : Marie <marie@example.org>\nObjet : Salle\nÀ : QBBE\n\nBonjour,\nla salle est libre.");
    expect(email).toMatchObject({ fromAddress: "marie@example.org", subject: "Salle", body: "Bonjour,\nla salle est libre." });
  });

  it("keeps plain text as the body when there are no headers", () => {
    expect(parseForwardedEmail("Just a note")).toEqual({ from: null, fromAddress: null, subject: null, body: "Just a note" });
  });
});

describe("project suggestions", () => {
  it("prefers a link to the project, then its name, then its words", () => {
    expect(suggestProjects(capture({ body: `see https://hub.qbbe.org/projects/${GALA}` }), projects)).toEqual([
      { id: GALA, name: "Spring Gala 2027", score: 100, reason: "link" },
    ]);
    expect(suggestProjects(capture({ title: "Call about the spring gala 2027 venue" }), projects)[0]).toMatchObject({
      id: GALA,
      reason: "mention",
      score: 80,
    });
    // Two of the name's three distinctive words ("spring", "gala", "2027").
    expect(suggestProjects(capture({ title: "Spring gala budget" }), projects)[0]).toMatchObject({
      id: GALA,
      reason: "keyword",
      score: 33,
    });
    // One of three is not enough.
    expect(suggestProjects(capture({ title: "Gala budget" }), projects)).toEqual([]);
  });

  it("ignores accents and capitals, and never matches on common words", () => {
    expect(suggestProjects(capture({ title: "EDUCATION des PARENTS: réunion" }), projects)[0]).toMatchObject({
      name: "Éducation des parents",
      reason: "mention",
    });
    expect(suggestProjects(capture({ title: "Mentorship check-in" }), projects)).toMatchObject([
      { name: "Tutoring & Mentorship", reason: "keyword" },
    ]);
    expect(suggestProjects(capture({ title: "the project for the team" }), projects)).toEqual([]);
  });
});

describe("contact suggestions", () => {
  it("matches a forwarded email's sender to exactly one contact", () => {
    expect(senderAddress("Marie <MARIE@example.org>")).toBe("marie@example.org");
    expect(suggestContact(capture({ kind: "email", email_from: "Marie <marie@example.org>" }), contacts)?.id).toBe("c1");
    expect(suggestContact(capture({ kind: "email", email_from: "same@example.org" }), contacts)).toBeNull();
    expect(suggestContact(capture({ kind: "text", email_from: "marie@example.org" }), contacts)).toBeNull();
    expect(suggestContact(capture({ kind: "email", email_from: "Nobody" }), contacts)).toBeNull();
  });
});

describe("filing choices", () => {
  const t = captureT("en");

  it("lead with the suggested action in the best project, then fall back to no project", () => {
    const link = capture({ kind: "link", title: "Spring Gala 2027 venue", url: "https://example.org" });
    const choices = filingChoices("link", suggestFiling(link, { projects, contacts }), t);
    expect(choices.map((choice) => [choice.label, choice.primary])).toEqual([
      ["Document in Spring Gala 2027", true],
      ["Task in Spring Gala 2027", false],
      ["Document, no project", false],
      ["Task, no project", false],
    ]);
    expect(choices[0].because).toBe("names it");
  });

  it("offer to log an email to its sender first", () => {
    const email = capture({ kind: "email", title: "Venue", email_from: "Marie <marie@example.org>" });
    const choices = filingChoices("email", suggestFiling(email, { projects, contacts }), t);
    expect(choices[0]).toMatchObject({ label: "Log email to Marie Tremblay", primary: true, input: { as: "interaction", contactId: "c1" } });
    expect(choices.map((choice) => choice.input.as)).not.toContain("document");
  });

  it("offer only a task for a plain note with no match", () => {
    const choices = filingChoices("text", suggestFiling(capture({ title: "Buy stamps" }), { projects, contacts }), t);
    expect(choices).toEqual([{ key: "task:none", label: "Task, no project", because: null, input: { as: "task" }, primary: true }]);
  });

  it("have French labels", () => {
    const choices = filingChoices("text", suggestFiling(capture({ title: "Gala 2027 spring" }), { projects, contacts }), captureT("fr-CA"));
    expect(choices[0].label).toBe("Tâche dans Spring Gala 2027");
  });
});

describe("capture catalogue", () => {
  it("has every English key in French", () => {
    expect(catalogKeys(captureCatalogs["fr-CA"])).toEqual(catalogKeys(captureCatalogs.en));
  });
});
