/**
 * Thank-you acknowledgements and annual donor statements (#156).
 *
 * QBBE is a registered nonprofit, NOT a registered charity: it must never
 * issue an official donation receipt for income tax purposes. So every letter
 * built here ends with the two sentences below, in English and in French
 * whatever the letter's language, and nothing here produces a receipt number,
 * a charity registration number, an "eligible amount" or the word "receipt"
 * anywhere but inside that disclaimer. The database refuses to store a letter
 * without both sentences (check constraint gift_ack_not_a_tax_receipt).
 *
 * The wording is pending review by QBBE's accountant and counsel.
 */

export const DISCLAIMER_EN = "This is not an official donation receipt for income tax purposes.";
export const DISCLAIMER_FR = "Ceci n'est pas un reçu officiel de don aux fins de l'impôt.";

export const LANGUAGES = ["en", "fr"] as const;
export type AckLanguage = (typeof LANGUAGES)[number];

export type GiftType = "donation" | "grant_payment" | "in_kind";

export interface AckGift {
  number: number;
  type: GiftType;
  receivedOn: string;
  amountCents: number | null;
  inKindDescription: string | null;
  valueSuppliedByDonor: boolean;
  fundName: string;
  fundRestriction: "unrestricted" | "internally_restricted" | "externally_restricted";
  programName: string | null;
  donorRestriction: string | null;
  grantTitle: string | null;
}

export interface RenderedLetter {
  subject: string;
  text: string;
}

function legalStatus(organizationName: string): string[] {
  return [
    `${organizationName} is a non-profit organization, not a registered charity.`,
    `${organizationName} est un organisme sans but lucratif et non un organisme de bienfaisance enregistré.`,
  ];
}

/** The closing block every letter ends with. Always bilingual. */
export function disclaimerBlock(organizationName: string): string {
  return [DISCLAIMER_EN, DISCLAIMER_FR, ...legalStatus(organizationName)].join("\n");
}

export function formatMoney(cents: number, language: AckLanguage): string {
  return new Intl.NumberFormat(language === "fr" ? "fr-CA" : "en-CA", {
    style: "currency",
    currency: "CAD",
  }).format(cents / 100);
}

export function formatLongDate(isoDate: string, language: AckLanguage): string {
  const date = new Date(`${isoDate}T12:00:00Z`);
  return new Intl.DateTimeFormat(language === "fr" ? "fr-CA" : "en-CA", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(date);
}

const T = {
  en: {
    giftSubject: (org: string) => `Thank you for your gift to ${org}`,
    statementSubject: (year: number, org: string) => `Your ${year} gifts to ${org}: thank you`,
    dear: (name: string) => `Dear ${name},`,
    thanks: (org: string, date: string) =>
      `Thank you for your generous gift to ${org}, received on ${date}.`,
    donation: (amount: string) => `Gift: a donation of ${amount}.`,
    grantPayment: (amount: string, title: string | null) =>
      title ? `Gift: a grant payment of ${amount} toward “${title}”.` : `Gift: a grant payment of ${amount}.`,
    inKindValued: (what: string, amount: string) =>
      `Gift: ${what} (value stated by the donor: ${amount}).`,
    inKind: (what: string) => `Gift: ${what}.`,
    unrestricted: "Use: where it is needed most (unrestricted).",
    restricted: (where: string) => `Use: ${where}.`,
    reference: (n: number) => `Our reference: gift ${n}.`,
    impact: "Your support helps us serve Black students, educators and families across Quebec.",
    closing: "With gratitude,",
    statementIntro: (org: string, year: number) =>
      `Thank you for supporting ${org}. Here is a summary of the gifts we received from you in ${year}.`,
    statementNone: (year: number) => `We have no gifts recorded from you in ${year}.`,
    statementTotal: (amount: string) => `Total of the gifts with a dollar amount: ${amount}.`,
    statementLine: (date: string, label: string, amount: string | null, n: number) =>
      `• ${date}: ${label}${amount ? `, ${amount}` : ""} (gift ${n})`,
    typeLabel: { donation: "donation", grant_payment: "grant payment", in_kind: "in-kind gift" },
    valueByDonor: "value stated by the donor",
    program: (name: string) => `the ${name} program`,
    fund: (name: string) => `the ${name} fund`,
  },
  fr: {
    giftSubject: (org: string) => `Merci pour votre don à ${org}`,
    statementSubject: (year: number, org: string) => `Vos dons de ${year} à ${org} : merci`,
    dear: (name: string) => `Bonjour ${name},`,
    thanks: (org: string, date: string) =>
      `Merci pour le généreux don que vous avez fait à ${org} le ${date}.`,
    donation: (amount: string) => `Don : un don de ${amount}.`,
    grantPayment: (amount: string, title: string | null) =>
      title
        ? `Don : un versement de subvention de ${amount} pour « ${title} ».`
        : `Don : un versement de subvention de ${amount}.`,
    inKindValued: (what: string, amount: string) =>
      `Don : ${what} (valeur indiquée par le donateur : ${amount}).`,
    inKind: (what: string) => `Don : ${what}.`,
    unrestricted: "Utilisation : là où le besoin est le plus grand (sans restriction).",
    restricted: (where: string) => `Utilisation : ${where}.`,
    reference: (n: number) => `Notre référence : don ${n}.`,
    impact:
      "Votre soutien nous aide à servir les élèves, les éducateurs et les familles noires partout au Québec.",
    closing: "Avec toute notre reconnaissance,",
    statementIntro: (org: string, year: number) =>
      `Merci de soutenir ${org}. Voici le sommaire des dons que vous nous avez faits en ${year}.`,
    statementNone: (year: number) => `Aucun don de votre part n'est inscrit pour ${year}.`,
    statementTotal: (amount: string) => `Total des dons en argent : ${amount}.`,
    statementLine: (date: string, label: string, amount: string | null, n: number) =>
      `• ${date} : ${label}${amount ? `, ${amount}` : ""} (don ${n})`,
    typeLabel: { donation: "don", grant_payment: "versement de subvention", in_kind: "don en nature" },
    valueByDonor: "valeur indiquée par le donateur",
    program: (name: string) => `le programme ${name}`,
    fund: (name: string) => `le fonds ${name}`,
  },
} as const;

function giftLine(gift: AckGift, language: AckLanguage): string {
  const t = T[language];
  if (gift.type === "in_kind") {
    const what = gift.inKindDescription ?? "";
    // A dollar value appears only when the donor supplied it.
    return gift.amountCents !== null && gift.valueSuppliedByDonor
      ? t.inKindValued(what, formatMoney(gift.amountCents, language))
      : t.inKind(what);
  }
  const amount = formatMoney(gift.amountCents ?? 0, language);
  return gift.type === "grant_payment" ? t.grantPayment(amount, gift.grantTitle) : t.donation(amount);
}

function restrictionLine(gift: AckGift, language: AckLanguage): string {
  const t = T[language];
  if (gift.fundRestriction === "unrestricted" && !gift.programName && !gift.donorRestriction) {
    return t.unrestricted;
  }
  const where =
    gift.donorRestriction?.trim() ||
    (gift.programName ? t.program(gift.programName) : t.fund(gift.fundName));
  return t.restricted(where);
}

export function renderGiftAcknowledgement(input: {
  language: AckLanguage;
  organizationName: string;
  donorName: string;
  issuedOn: string;
  gift: AckGift;
}): RenderedLetter {
  const { language, organizationName, donorName, issuedOn, gift } = input;
  const t = T[language];
  const text = [
    organizationName,
    formatLongDate(issuedOn, language),
    "",
    t.dear(donorName),
    "",
    t.thanks(organizationName, formatLongDate(gift.receivedOn, language)),
    "",
    giftLine(gift, language),
    restrictionLine(gift, language),
    t.reference(gift.number),
    "",
    t.impact,
    "",
    t.closing,
    organizationName,
    "",
    disclaimerBlock(organizationName),
  ].join("\n");
  return { subject: t.giftSubject(organizationName), text };
}

export function renderAnnualStatement(input: {
  language: AckLanguage;
  organizationName: string;
  donorName: string;
  issuedOn: string;
  year: number;
  gifts: AckGift[];
}): RenderedLetter {
  const { language, organizationName, donorName, issuedOn, year, gifts } = input;
  const t = T[language];
  const lines = gifts.map((g) => {
    const label =
      g.type === "in_kind"
        ? `${t.typeLabel.in_kind}: ${g.inKindDescription ?? ""}`
        : g.type === "grant_payment" && g.grantTitle
          ? `${t.typeLabel.grant_payment} (${g.grantTitle})`
          : t.typeLabel[g.type];
    const amount =
      g.amountCents === null
        ? null
        : g.type === "in_kind"
          ? `${formatMoney(g.amountCents, language)} (${t.valueByDonor})`
          : formatMoney(g.amountCents, language);
    return t.statementLine(formatLongDate(g.receivedOn, language), label, amount, g.number);
  });
  // The total counts money received; in-kind values stated by donors are not money.
  const total = gifts
    .filter((g) => g.type !== "in_kind")
    .reduce((sum, g) => sum + (g.amountCents ?? 0), 0);
  const text = [
    organizationName,
    formatLongDate(issuedOn, language),
    "",
    t.dear(donorName),
    "",
    gifts.length ? t.statementIntro(organizationName, year) : t.statementNone(year),
    "",
    ...lines,
    ...(gifts.length ? ["", t.statementTotal(formatMoney(total, language))] : []),
    "",
    t.impact,
    "",
    t.closing,
    organizationName,
    "",
    disclaimerBlock(organizationName),
  ].join("\n");
  return { subject: t.statementSubject(year, organizationName), text };
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
 * The body of a stored letter as HTML: paragraphs from blank lines, the
 * bilingual disclaimer set apart in a box. Used for the email and the
 * printable page, so both show exactly the text that was issued.
 */
export function letterBodyHtml(text: string): string {
  const cut = text.indexOf(DISCLAIMER_EN);
  const main = cut >= 0 ? text.slice(0, cut) : text;
  const disclaimer = cut >= 0 ? text.slice(cut) : "";
  const paragraphs = main
    .trim()
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 14px">${p.split("\n").map(escapeHtml).join("<br>")}</p>`)
    .join("\n");
  const box = disclaimer
    ? `<div class="disclaimer" style="margin-top:24px;padding:12px 14px;border:1px solid gray;font-size:13px;line-height:1.5">${disclaimer
        .trim()
        .split("\n")
        .map((line, i) => (i < 2 ? `<strong>${escapeHtml(line)}</strong>` : escapeHtml(line)))
        .join("<br>")}</div>`
    : "";
  return `${paragraphs}\n${box}`;
}

/** A complete, self-contained HTML document for printing or saving. No scripts. */
export function letterDocument(input: { subject: string; text: string; language: AckLanguage }): string {
  return `<!doctype html>
<html lang="${input.language === "fr" ? "fr-CA" : "en-CA"}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(input.subject)}</title>
<style>
  body { font: 15px/1.55 Georgia, "Times New Roman", serif; color: black; background: white; margin: 0; }
  main { max-width: 42rem; margin: 2.5rem auto; padding: 0 1.25rem; }
  .hint { font: 13px/1.4 system-ui, sans-serif; color: dimgray; border-bottom: 1px solid lightgray; padding-bottom: .75rem; margin-bottom: 2rem; }
  @media print { .hint { display: none; } main { margin: 0 auto; } }
</style>
</head>
<body>
<main>
<p class="hint">${
    input.language === "fr"
      ? "Pour imprimer ou enregistrer cette lettre, utilisez la commande Imprimer de votre navigateur (Ctrl+P ou Cmd+P)."
      : "To print or save this letter, use your browser's Print command (Ctrl+P or Cmd+P)."
  }</p>
${letterBodyHtml(input.text)}
</main>
</body>
</html>
`;
}

/**
 * Words that would make a letter look like a tax receipt. Outside the
 * disclaimer none of them may appear; the tests hold every template to this.
 */
export const TAX_RECEIPT_MARKERS = [
  /receipt/i,
  /re[çc]u/i,
  /registration number/i,
  /num[ée]ro d.enregistrement/i,
  /eligible amount/i,
  /montant admissible/i,
  /charitable/i,
  /income tax/i,
  /imp[ôo]t/i,
  /canada revenue agency/i,
  /agence du revenu/i,
];

export function textOutsideDisclaimer(text: string): string {
  const cut = text.indexOf(DISCLAIMER_EN);
  return cut >= 0 ? text.slice(0, cut) : text;
}
