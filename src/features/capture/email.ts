/**
 * Reads a forwarded email pasted into the capture box (M18). Mail clients
 * mark a forward with header lines; this looks for the first From and
 * Subject lines (English or French headers, as Gmail, Outlook and Apple Mail
 * write them) and keeps everything after the headers as the body.
 * Deterministic: no guessing beyond the header names below.
 */

export interface ForwardedEmail {
  from: string | null;
  /** The sender's address, lower case, when the From line has one. */
  fromAddress: string | null;
  subject: string | null;
  body: string;
}

const FROM = /^\s*(?:from|de|expéditeur|expediteur)\s*:\s*(.+)$/i;
const SUBJECT = /^\s*(?:subject|objet|sujet)\s*:\s*(.*)$/i;
const OTHER_HEADER = /^\s*(?:to|à|a|cc|date|sent|envoyé|envoye|reply-to|répondre à)\s*:/i;
const MARKER = /^\s*-{2,}.*(?:forwarded message|message transféré|message transfere|original message|message d'origine).*-{0,}\s*$/i;
const ADDRESS = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

export function parseForwardedEmail(text: string): ForwardedEmail {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  let from: string | null = null;
  let subject: string | null = null;
  let lastHeader = -1;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (MARKER.test(line)) {
      lastHeader = index;
      continue;
    }
    const fromMatch = line.match(FROM);
    const subjectMatch = line.match(SUBJECT);
    if (fromMatch && from === null) {
      from = fromMatch[1].trim();
      lastHeader = index;
    } else if (subjectMatch && subject === null) {
      subject = subjectMatch[1].trim() || null;
      lastHeader = index;
    } else if (OTHER_HEADER.test(line) && lastHeader >= 0 && index - lastHeader <= 2) {
      lastHeader = index;
    }
  }
  const body = lines.slice(lastHeader + 1).join("\n").trim();
  const fromAddress = from?.match(ADDRESS)?.[0].toLowerCase() ?? null;
  return { from, fromAddress, subject, body };
}
