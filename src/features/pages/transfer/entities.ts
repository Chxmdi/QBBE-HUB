/** HTML character references, for the Markdown and HTML importers (wave 2 unit X1). */

const NAMED: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  laquo: "«",
  raquo: "»",
  copy: "©",
  reg: "®",
  trade: "™",
  eacute: "é",
  egrave: "è",
  ecirc: "ê",
  agrave: "à",
  acirc: "â",
  ccedil: "ç",
  ocirc: "ô",
  icirc: "î",
  ucirc: "û",
  ugrave: "ù",
  Eacute: "É",
  Egrave: "È",
  Agrave: "À",
  Ccedil: "Ç",
};

/** One reference at the start of `source` (which begins with "&"), or null when it is not one. */
export function matchEntity(source: string): { text: string; length: number } | null {
  const match = /^&(#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|[A-Za-z][A-Za-z0-9]{1,31});/.exec(source);
  if (!match) return null;
  const body = match[1];
  if (body.startsWith("#")) {
    const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
    // Nothing invisible or out of range comes back from a reference.
    const valid = code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) && (code >= 0x20 || code === 0x0a || code === 0x09);
    return { text: valid ? String.fromCodePoint(code) : "�", length: match[0].length };
  }
  const named = NAMED[body];
  return named === undefined ? null : { text: named, length: match[0].length };
}

export function decodeEntities(source: string): string {
  let out = "";
  let i = 0;
  while (i < source.length) {
    const at = source.indexOf("&", i);
    if (at < 0) {
      out += source.slice(i);
      break;
    }
    out += source.slice(i, at);
    const entity = matchEntity(source.slice(at, at + 40));
    if (entity) {
      out += entity.text;
      i = at + entity.length;
    } else {
      out += "&";
      i = at + 1;
    }
  }
  return out;
}
