import { describe, expect, it } from "vitest";
import { createTranslator } from "@/lib/i18n/translate";
import { categoryLabel, crmMessage, stageLabel } from "@/features/crm/labels";
import { createOpportunitySchema, formatMoney } from "@/features/crm/opportunity-schemas";

const en = createTranslator("en");
const fr = createTranslator("fr-CA");

describe("CRM labels (#141)", () => {
  it("keeps English exactly as the screens always showed it", () => {
    expect(categoryLabel("funder", en)).toBe("funder");
    expect(stageLabel("in_kind", en)).toBe("in_kind");
    expect(stageLabel("awarded", en)).toBe("Awarded");
  });

  it("translates codes into French and passes unknown codes through", () => {
    expect(categoryLabel("funder", fr)).toBe("bailleur de fonds");
    expect(stageLabel("declined", fr)).toBe("Refusée");
    expect(categoryLabel("unheard_of", fr)).toBe("unheard_of");
  });

  it("translates a schema's English message back through the catalogue", () => {
    const result = createOpportunitySchema.safeParse({
      crmOrganizationId: "11111111-1111-4111-8111-111111111111",
      ownerId: "22222222-2222-4222-8222-222222222222",
      title: "Bid",
      stage: "awarded",
      decidedAt: "2026-09-01",
    });
    expect(result.success).toBe(false);
    const message = result.success ? undefined : result.error.issues[0].message;
    expect(crmMessage(en, message)).toBe("Record what was awarded.");
    expect(crmMessage(fr, message)).toBe("Indiquez le montant accordé.");
    expect(crmMessage(fr, "Something else")).toBe("Something else");
  });

  it("formats money in Quebec French", () => {
    expect(formatMoney(25000, "CAD", "fr-CA")).toBe("25 000 $");
    expect(formatMoney(25000, "GBP")).toBe("£25,000");
  });
});
