import { describe, expect, it } from "vitest";
import {
  DISCLAIMER_EN,
  DISCLAIMER_FR,
  LANGUAGES,
  TAX_RECEIPT_MARKERS,
  letterBodyHtml,
  letterDocument,
  renderAnnualStatement,
  renderGiftAcknowledgement,
  textOutsideDisclaimer,
  type AckGift,
} from "../acknowledgement";

const ORG = "Quebec Board of Black Educators";

const donation: AckGift = {
  number: 12,
  type: "donation",
  receivedOn: "2026-10-15",
  amountCents: 25000,
  inKindDescription: null,
  valueSuppliedByDonor: false,
  fundName: "General fund",
  fundRestriction: "unrestricted",
  programName: null,
  donorRestriction: null,
  grantTitle: null,
};
const inKindNoValue: AckGift = {
  ...donation,
  number: 13,
  type: "in_kind",
  amountCents: null,
  inKindDescription: "Twenty boxes of books",
};
const inKindValued: AckGift = {
  ...inKindNoValue,
  number: 14,
  amountCents: 4000,
  valueSuppliedByDonor: true,
  inKindDescription: "Printer paper",
};
const grantPayment: AckGift = {
  ...donation,
  number: 15,
  type: "grant_payment",
  amountCents: 1500000,
  fundName: "Foundation literacy grant",
  fundRestriction: "externally_restricted",
  programName: "Literacy",
  grantTitle: "Literacy 2026",
};

const ALL = [donation, inKindNoValue, inKindValued, grantPayment];

function letters() {
  return LANGUAGES.flatMap((language) => [
    ...ALL.map((gift) =>
      renderGiftAcknowledgement({ language, organizationName: ORG, donorName: "Ada Lovelace", issuedOn: "2026-10-20", gift }),
    ),
    renderAnnualStatement({ language, organizationName: ORG, donorName: "Ada Lovelace", issuedOn: "2027-01-10", year: 2026, gifts: ALL }),
    renderAnnualStatement({ language, organizationName: ORG, donorName: "Ada Lovelace", issuedOn: "2027-01-10", year: 2026, gifts: [] }),
  ]);
}

describe("gift acknowledgements are never tax receipts", () => {
  it("every letter, in either language, carries the disclaimer in English and French", () => {
    for (const letter of letters()) {
      expect(letter.text).toContain(DISCLAIMER_EN);
      expect(letter.text).toContain(DISCLAIMER_FR);
      expect(letter.text).toContain("not a registered charity");
      expect(letter.text).toContain("non un organisme de bienfaisance enregistré");
    }
  });

  it("uses the exact sentences the database check constraint looks for", () => {
    expect(DISCLAIMER_EN).toBe("This is not an official donation receipt for income tax purposes.");
    expect(DISCLAIMER_FR).toBe("Ceci n'est pas un reçu officiel de don aux fins de l'impôt.");
  });

  it("nothing outside the disclaimer reads like a tax receipt", () => {
    for (const letter of letters()) {
      const body = textOutsideDisclaimer(letter.text);
      for (const marker of TAX_RECEIPT_MARKERS) {
        expect(body, `${marker} in: ${body}`).not.toMatch(marker);
        expect(letter.subject).not.toMatch(marker);
      }
    }
  });

  it("subjects pass the database rule against the word receipt", () => {
    for (const letter of letters()) expect(letter.subject).not.toMatch(/(receipt|re[çc]u)/i);
  });
});

describe("gift acknowledgement content", () => {
  it("states the amount in the letter's language", () => {
    const en = renderGiftAcknowledgement({ language: "en", organizationName: ORG, donorName: "Ada", issuedOn: "2026-10-20", gift: donation });
    const fr = renderGiftAcknowledgement({ language: "fr", organizationName: ORG, donorName: "Ada", issuedOn: "2026-10-20", gift: donation });
    expect(en.text).toContain("$250.00");
    expect(en.text).toContain("October 15, 2026");
    expect(en.text).toContain("unrestricted");
    expect(fr.text).toMatch(/250,00\s\$/);
    expect(fr.text).toContain("15 octobre 2026");
    expect(fr.subject).toBe(`Merci pour votre don à ${ORG}`);
  });

  it("gives an in-kind gift no dollar value unless the donor supplied one", () => {
    const none = renderGiftAcknowledgement({ language: "en", organizationName: ORG, donorName: "Ada", issuedOn: "2026-10-20", gift: inKindNoValue });
    expect(textOutsideDisclaimer(none.text)).not.toMatch(/\$/);
    expect(none.text).toContain("Twenty boxes of books");
    const valued = renderGiftAcknowledgement({ language: "en", organizationName: ORG, donorName: "Ada", issuedOn: "2026-10-20", gift: inKindValued });
    expect(valued.text).toContain("value stated by the donor: $40.00");
  });

  it("names the restriction on a restricted gift", () => {
    const letter = renderGiftAcknowledgement({ language: "en", organizationName: ORG, donorName: "Ada", issuedOn: "2026-10-20", gift: grantPayment });
    expect(letter.text).toContain("the Literacy program");
    expect(letter.text).toContain("“Literacy 2026”");
  });

  it("totals only money on the annual statement, not donor-stated in-kind values", () => {
    const statement = renderAnnualStatement({ language: "en", organizationName: ORG, donorName: "Ada", issuedOn: "2027-01-10", year: 2026, gifts: ALL });
    expect(statement.text).toContain("Total of the gifts with a dollar amount: $15,250.00.");
    expect(statement.text).toContain("(gift 13)");
  });
});

describe("letter HTML", () => {
  it("escapes donor-supplied text", () => {
    const html = letterBodyHtml(`Dear <script>alert(1)</script>,\n\n${DISCLAIMER_EN}\n${DISCLAIMER_FR}`);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("sets the disclaimer apart and keeps it in the printable document", () => {
    const letter = renderGiftAcknowledgement({ language: "fr", organizationName: ORG, donorName: "Ada", issuedOn: "2026-10-20", gift: donation });
    const doc = letterDocument({ ...letter, language: "fr" });
    expect(doc).toContain('class="disclaimer"');
    expect(doc).toContain("Ceci n&#39;est pas un reçu officiel de don aux fins de l&#39;impôt.");
    expect(doc).toContain("This is not an official donation receipt for income tax purposes.");
    expect(doc).not.toMatch(/<script/i);
    expect(doc).toContain('lang="fr-CA"');
  });
});
