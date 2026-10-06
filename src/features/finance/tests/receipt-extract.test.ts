import { describe, expect, it } from "vitest";
import tesseractPackage from "tesseract.js/package.json";
import { amountsIn, extractReceiptFields, taxConsistency } from "../receipt-ocr/extract";
import { OCR_VERSION } from "../receipt-ocr/read-receipt";

// Every receipt below is invented for these tests. Store names, addresses and
// numbers are fictitious; no real receipt is reproduced (the repository is
// public).
const TODAY = "2026-09-27";

describe("extractReceiptFields", () => {
  it("reads a plain English receipt", () => {
    const text = `
      MAPLE LEAF HARDWARE
      123 Fictional Ave, Montreal QC H0H 0H0
      Tel: 514-555-0100
      Sep 26 2026   14:32
      Paint roller        12.99
      Tape 2 x 4.50        9.00
      SUBTOTAL            21.99
      GST 5%               1.10
      QST 9.975%           2.19
      TOTAL               25.28
      VISA                25.28
    `;
    expect(extractReceiptFields(text, TODAY)).toEqual({
      documentDate: "2026-09-26",
      vendor: "MAPLE LEAF HARDWARE",
      totalCents: 2528,
      gstCents: 110,
      qstCents: 219,
    });
  });

  it("reads a French receipt with comma decimals and a space thousands separator", () => {
    const text = `
      Librairie du Quartier Imaginaire
      4321, rue Inventée
      Montréal (Québec)
      Date : 26/09/2026
      Manuels scolaires           1 050,00
      Sous-total                  1 050,00
      TPS (5 %)                      52,50
      TVQ (9,975 %)                 104,74
      TOTAL À PAYER             1 207,24 $
    `;
    expect(extractReceiptFields(text, TODAY)).toEqual({
      documentDate: "2026-09-26",
      vendor: "Librairie du Quartier Imaginaire",
      totalCents: 120724,
      gstCents: 5250,
      qstCents: 10474,
    });
  });

  it("reads French month abbreviations and TOTAL A PAYER without accents (OCR drops them)", () => {
    const text = `
      CAFE FICTIF
      26 sept. 2026
      Sous-total 40,00
      TPS 2,00
      TVQ 3,99
      TOTAL A PAYER 45,99
    `;
    expect(extractReceiptFields(text, TODAY)).toMatchObject({
      documentDate: "2026-09-26",
      totalCents: 4599,
      gstCents: 200,
      qstCents: 399,
    });
  });

  it("takes the total, not the subtotal", () => {
    const text = `
      DEPANNEUR EXEMPLE
      SOUS-TOTAL 100,00
      TOTAL 114,98
    `;
    expect(extractReceiptFields(text, TODAY).totalCents).toBe(11498);
  });

  it("takes the grand total after a tip, which is the amount paid", () => {
    const text = `
      RESTAURANT IMAGINAIRE
      Subtotal        40.00
      GST              2.00
      QST              3.99
      Total           45.99
      Tip              7.00
      Grand Total     52.99
    `;
    const out = extractReceiptFields(text, TODAY);
    expect(out.totalCents).toBe(5299);
    expect(out.gstCents).toBe(200);
    expect(out.qstCents).toBe(399);
  });

  it("does not take cash tendered or change as the total", () => {
    const text = `
      EPICERIE FICTIVE
      TOTAL 18.37
      MONTANT RECU 20.00
      COMPTANT 20.00
      MONNAIE 1.63
    `;
    expect(extractReceiptFields(text, TODAY).totalCents).toBe(1837);
  });

  it("does not read the tax total or item count as the total", () => {
    const text = `
      QUINCAILLERIE TEST
      TOTAL ARTICLES 3
      TOTAL TAXES 1.50
      TOTAL 11.50
    `;
    expect(extractReceiptFields(text, TODAY).totalCents).toBe(1150);
  });

  it("finds an amount OCR put on the line after its label", () => {
    const text = `
      KIOSQUE TEST
      MONTANT
      $ 32.10
    `;
    expect(extractReceiptFields(text, TODAY).totalCents).toBe(3210);
  });

  it("leaves taxes empty when the receipt shows none", () => {
    const text = `
      MARCHE FERMIER FICTIF
      Pommes 5.00
      TOTAL 5.00
    `;
    const out = extractReceiptFields(text, TODAY);
    expect(out.totalCents).toBe(500);
    expect(out.gstCents).toBeUndefined();
    expect(out.qstCents).toBeUndefined();
  });

  it("ignores a line naming both taxes and a registration number line", () => {
    const text = `
      ATELIER FICTIF
      TPS/TVQ incluses 11.50
      TPS # 123456789 RT0001
      TOTAL 11.50
    `;
    const out = extractReceiptFields(text, TODAY);
    expect(out.gstCents).toBeUndefined();
    expect(out.qstCents).toBeUndefined();
  });

  it("picks the tax, not its base, when both are on one line", () => {
    const text = `
      TRAITEUR FICTIF
      TPS sur 40,00 : 2,00
      TVQ sur 40,00 : 3,99
      TOTAL 45,99
    `;
    const out = extractReceiptFields(text, TODAY);
    expect(out.gstCents).toBe(200);
    expect(out.qstCents).toBe(399);
  });

  it("does not read the tax rate as an amount", () => {
    expect(amountsIn("TPS 5,00 % 2,50")).toEqual([250]);
    expect(amountsIn("TVQ 9.975% 4.99")).toEqual([499]);
  });

  it("leaves a tax empty when two different amounts cannot be settled", () => {
    const text = `
      COMMERCE FICTIF
      GST 1.00
      GST 3.00
      TOTAL 50.00
    `;
    expect(extractReceiptFields(text, TODAY).gstCents).toBeUndefined();
  });

  it("settles two tax amounts by the rate on the subtotal", () => {
    const text = `
      COMMERCE FICTIF
      SUBTOTAL 60.00
      GST 60.00 3.00
      GST registration 3.33
      TOTAL 69.00
    `;
    expect(extractReceiptFields(text, TODAY).gstCents).toBe(300);
  });

  it("skips an HST line and a tax whose printed rate is not Quebec's", () => {
    const text = `
      BOUTIQUE ONTARIO FICTIVE
      HST 13% 6.50
      GST 13% 6.50
      TOTAL 56.50
    `;
    const out = extractReceiptFields(text, TODAY);
    expect(out.gstCents).toBeUndefined();
    expect(out.qstCents).toBeUndefined();
  });

  it("ignores discounts and quantities", () => {
    expect(amountsIn("RABAIS -2.00")).toEqual([]);
    expect(amountsIn("2 12.50")).toEqual([1250]);
    expect(amountsIn("1 234,56 $")).toEqual([123456]);
    expect(amountsIn("$1,234.56")).toEqual([123456]);
    expect(amountsIn("Tel 514-555-0100")).toEqual([]);
  });

  it("returns nothing it cannot read (blank or noise)", () => {
    expect(extractReceiptFields("", TODAY)).toEqual({});
    expect(extractReceiptFields("~~ ;; ||\n..", TODAY)).toEqual({});
  });

  it("leaves the total empty when it would be smaller than its own taxes", () => {
    const text = `
      COMMERCE FICTIF
      GST 5.00
      QST 9.98
      TOTAL 1.00
    `;
    expect(extractReceiptFields(text, TODAY).totalCents).toBeUndefined();
  });
});

describe("dates", () => {
  const dateOf = (line: string) => extractReceiptFields(`MAGASIN FICTIF\n${line}`, TODAY).documentDate;

  it.each([
    ["2026-09-26", "2026-09-26"],
    ["2026/09/26 10:14", "2026-09-26"],
    ["26/09/2026", "2026-09-26"],
    ["09/26/2026", "2026-09-26"],
    ["26 sept. 2026", "2026-09-26"],
    ["26 septembre 2026", "2026-09-26"],
    ["1er août 2026", "2026-08-01"],
    ["1ER AOUT 2026", "2026-08-01"],
    ["Sep 26 2026", "2026-09-26"],
    ["September 26, 2026", "2026-09-26"],
    ["26 Sep 2026", "2026-09-26"],
    ["12 déc. 2025", "2025-12-12"],
  ])("reads %s", (line, iso) => {
    expect(dateOf(line)).toBe(iso);
  });

  it.each([
    ["05/09/2026", "day and month could be swapped"],
    ["2026-09-31", "not a real day"],
    ["2026-10-02", "after today"],
    ["26/09/26", "two-digit year"],
  ])("leaves %s empty (%s)", (line) => {
    expect(dateOf(line)).toBeUndefined();
  });

  it("leaves the date empty when the receipt shows two different dates", () => {
    expect(dateOf("Date: 2026-09-20\nRetour avant le 2026-09-27")).toBeUndefined();
  });

  it("accepts the same date printed twice", () => {
    expect(dateOf("26/09/2026\nSep 26 2026")).toBe("2026-09-26");
  });
});

describe("vendor", () => {
  const vendorOf = (text: string) => extractReceiptFields(text, TODAY).vendor;

  it("skips greetings, receipt titles, addresses and phone lines", () => {
    expect(
      vendorOf(`
        *** BIENVENUE ***
        REÇU
        1234 rue Imaginaire
        Tel 514-555-0199
        Papeterie Exemple Inc.
      `),
    ).toBe("Papeterie Exemple Inc.");
  });

  it("strips OCR noise around the name", () => {
    expect(vendorOf("|| ~Boulangerie Fictive~ ::")).toBe("Boulangerie Fictive");
  });

  it("does not take a line that is mostly digits or symbols", () => {
    expect(vendorOf("#### 00123 4567 ####\nTOTAL 5.00")).toBeUndefined();
  });
});

describe("taxConsistency", () => {
  it("agrees within two cents", () => {
    // 1073.77 before tax: 53.69 GST, 107.11 QST (107.10 is one cent off)
    expect(taxConsistency(123456, 5369, 10710)?.consistent).toBe(true);
  });

  it("flags taxes that do not match the rates", () => {
    const result = taxConsistency(5000, 500, 100);
    expect(result?.consistent).toBe(false);
    expect(result?.beforeTaxCents).toBe(4400);
    expect(result?.expectedGstCents).toBe(220);
    expect(result?.expectedQstCents).toBe(439);
  });

  it("checks a lone GST against the amount before it", () => {
    expect(taxConsistency(2100, 100, null)?.consistent).toBe(true);
    expect(taxConsistency(2100, 150, null)?.consistent).toBe(false);
  });

  it("has nothing to say without a total or without taxes", () => {
    expect(taxConsistency(null, 100, 200)).toBeNull();
    expect(taxConsistency(5000, null, null)).toBeNull();
    expect(taxConsistency(5000, 0, 0)).toBeNull();
  });
});

describe("OCR assets", () => {
  it("are served from the folder named for the installed tesseract.js version", () => {
    // scripts/copy-ocr-assets.mjs copies into public/ocr/<version>; the
    // browser loads from OCR_VERSION. Upgrading one without the other would
    // load a worker that does not match the library.
    expect(OCR_VERSION).toBe(tesseractPackage.version);
  });
});
