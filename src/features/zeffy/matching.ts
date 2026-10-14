import type { ZeffyBuyer } from "./types";

/**
 * Which CRM contact a Zeffy buyer is. Pure, so every case is unit-tested:
 *
 *   1. a contact already linked to this Zeffy contact            -> linked
 *   2. exactly one unlinked contact with the same email          -> link it
 *   3. several unlinked contacts with that email                 -> ambiguous,
 *      left for staff to choose ("Needs matching"), never guessed
 *   4. nobody (or no email to go on)                             -> create
 *
 * A contact already linked to a *different* Zeffy contact is not a candidate:
 * it belongs to someone else's giving history.
 */

export interface ContactCandidate {
  id: string;
  email: string | null;
  zeffy_contact_id: string | null;
}

export type MatchDecision =
  | { kind: "linked"; contactId: string }
  | { kind: "link"; contactId: string }
  | { kind: "ambiguous"; candidateIds: string[] }
  | { kind: "create" };

export function decideMatch(
  buyer: ZeffyBuyer,
  linked: ContactCandidate | null,
  byEmail: ContactCandidate[],
): MatchDecision {
  if (linked) return { kind: "linked", contactId: linked.id };
  if (!buyer.email) return { kind: "create" };

  const email = buyer.email.toLowerCase();
  const free = byEmail.filter(
    (contact) => contact.email?.toLowerCase() === email && !contact.zeffy_contact_id,
  );
  if (free.length === 1) return { kind: "link", contactId: free[0].id };
  if (free.length > 1) {
    return { kind: "ambiguous", candidateIds: free.map((contact) => contact.id).sort() };
  }
  return { kind: "create" };
}
