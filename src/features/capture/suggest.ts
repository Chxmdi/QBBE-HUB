import { fold } from "@/features/commands/grammar";

/**
 * Where a captured item probably belongs (M18), by fixed rules:
 *
 *   link     the text or link points at a project's page (/projects/<id>)  100
 *   mention  the project's full name appears in the text                    80
 *   keyword  most of the distinctive words of its name appear              up to 50
 *   sender   a forwarded email's sender is a CRM contact (exact address)
 *
 * Suggestions are offered, never applied: filing is always the person's tap.
 */

export interface CaptureText {
  kind: "text" | "link" | "file" | "photo" | "email";
  title: string;
  body: string | null;
  url: string | null;
  email_from: string | null;
}

export interface ProjectRef {
  id: string;
  name: string;
}

export interface ContactRef {
  id: string;
  full_name: string;
  email: string | null;
  crm_organization_id: string;
  organization_name: string | null;
}

export interface ProjectSuggestion {
  id: string;
  name: string;
  score: number;
  reason: "link" | "mention" | "keyword";
}

export interface CaptureSuggestions {
  projects: ProjectSuggestion[];
  contact: ContactRef | null;
  /** The first filing button: what this kind of item usually becomes. */
  action: "task" | "document" | "interaction";
}

/** Words too common to identify a project, in English and French. */
const STOPWORDS = new Set([
  "the", "and", "for", "with", "from", "into", "that", "this", "project", "program", "series", "team",
  "les", "des", "pour", "avec", "dans", "une", "sur", "projet", "programme", "serie", "equipe",
]);

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const MAX_PROJECTS = 3;

function words(text: string): string[] {
  return fold(text).split(/[^a-z0-9]+/).filter(Boolean);
}

function significant(name: string): string[] {
  return [...new Set(words(name).filter((word) => word.length >= 4 && !STOPWORDS.has(word)))];
}

/** The folded name as a whole phrase in the folded text. */
function mentions(text: string, name: string): boolean {
  const phrase = words(name).join(" ");
  if (!phrase) return false;
  return ` ${words(text).join(" ")} `.includes(` ${phrase} `);
}

export function suggestProjects(capture: CaptureText, projects: ProjectRef[]): ProjectSuggestion[] {
  const text = [capture.title, capture.body, capture.url].filter(Boolean).join("\n");
  const linked = new Set([...text.matchAll(new RegExp(`/projects/(${UUID})`, "gi"))].map((match) => match[1].toLowerCase()));
  const textWords = new Set(words(text));

  const scored: ProjectSuggestion[] = [];
  for (const project of projects) {
    if (linked.has(project.id.toLowerCase())) {
      scored.push({ id: project.id, name: project.name, score: 100, reason: "link" });
      continue;
    }
    if (mentions(text, project.name)) {
      scored.push({ id: project.id, name: project.name, score: 80, reason: "mention" });
      continue;
    }
    const keys = significant(project.name);
    const hits = keys.filter((word) => textWords.has(word)).length;
    if (keys.length && hits > 0 && hits / keys.length >= 0.5) {
      scored.push({ id: project.id, name: project.name, score: Math.round((50 * hits) / keys.length), reason: "keyword" });
    }
  }
  return scored
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
    .slice(0, MAX_PROJECTS);
}

export function senderAddress(emailFrom: string | null): string | null {
  return emailFrom?.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0].toLowerCase() ?? null;
}

export function suggestContact(capture: CaptureText, contacts: ContactRef[]): ContactRef | null {
  const address = capture.kind === "email" ? senderAddress(capture.email_from) : null;
  if (!address) return null;
  const matches = contacts.filter((contact) => contact.email?.trim().toLowerCase() === address);
  // Two contacts with one address is a data problem, not a choice to guess.
  return matches.length === 1 ? matches[0] : null;
}

export function suggestFiling(
  capture: CaptureText,
  context: { projects: ProjectRef[]; contacts: ContactRef[] },
): CaptureSuggestions {
  const contact = suggestContact(capture, context.contacts);
  const action =
    capture.kind === "email" && contact
      ? "interaction"
      : capture.kind === "link" || capture.kind === "file" || capture.kind === "photo"
        ? "document"
        : "task";
  return { projects: suggestProjects(capture, context.projects), contact, action };
}
