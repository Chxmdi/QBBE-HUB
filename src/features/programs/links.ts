export type ImportantLink = { label: string; url: string };

const MAX_LINKS = 20;

/**
 * Parse the "Label|https://example.org" lines the program edit dialog collects.
 *
 * A line with no separator is both its own label and its own URL, which is what
 * someone pasting a bare address expects. Anything that is not http(s) is
 * dropped rather than stored: these render as anchors on the program page, and
 * `javascript:` in an href is a script someone else wrote running in the
 * reader's session.
 *
 * Extracted from the command so it can be tested without a database.
 */
export function parseImportantLinks(input: string | null | undefined): ImportantLink[] {
  if (!input) return [];
  const links: ImportantLink[] = [];
  for (const line of input.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const separator = trimmed.indexOf("|");
    const label = separator === -1 ? trimmed : trimmed.slice(0, separator).trim();
    const url = separator === -1 ? trimmed : trimmed.slice(separator + 1).trim();
    if (!label || !url) continue;
    if (!/^https?:\/\//i.test(url)) continue;
    links.push({ label: label.slice(0, 120), url });
    if (links.length >= MAX_LINKS) break;
  }
  return links;
}
