import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import fixture from "./zeffy-api.fixture.json";
import {
  buyerFromContact,
  buyerFromPayment,
  campaignRow,
  paymentKinds,
  paymentRow,
} from "../mapping";
import { decideMatch } from "../matching";
import { parseZeffyEvent, zeffySignatureIsValid } from "../signature";
import {
  zeffyCampaignSchema,
  zeffyContactSchema,
  zeffyPaymentSchema,
  type ZeffyPayment,
} from "../types";

const ORG = "org-1";
const NOW = new Date("2026-10-14T12:00:00Z");

function payment(overrides: Partial<ZeffyPayment> = {}): ZeffyPayment {
  return zeffyPaymentSchema.parse({ ...fixture.payment, ...overrides });
}

describe("Zeffy's documented shapes", () => {
  it("reads the payment, contact and campaign examples from Zeffy's API description", () => {
    expect(zeffyPaymentSchema.safeParse(fixture.payment).success).toBe(true);
    expect(zeffyContactSchema.safeParse(fixture.contact).success).toBe(true);
    expect(zeffyCampaignSchema.safeParse(fixture.campaign).success).toBe(true);
  });

  it("tolerates fields Zeffy may leave out or add", () => {
    const minimal = { id: "p-1", created: 1, amount: 100, currency: "cad", status: "succeeded" };
    expect(zeffyPaymentSchema.safeParse(minimal).success).toBe(true);
    expect(zeffyPaymentSchema.safeParse({ ...minimal, brand_new_field: { x: 1 } }).success).toBe(true);
  });

  it("refuses a payment without an id or amount", () => {
    expect(zeffyPaymentSchema.safeParse({ ...fixture.payment, id: "" }).success).toBe(false);
    expect(zeffyPaymentSchema.safeParse({ ...fixture.payment, amount: "50" }).success).toBe(false);
  });
});

describe("payment rows", () => {
  it("keeps who paid, for what, when and how much, in cents", () => {
    const row = paymentRow(ORG, payment(), NOW);
    expect(row).toMatchObject({
      organization_id: ORG,
      zeffy_id: fixture.payment.id,
      zeffy_contact_id: fixture.payment.contact,
      zeffy_campaign_id: fixture.payment.campaign_id,
      campaign_title: "Annual Gala 2025",
      campaign_category: "event",
      paid_at: new Date(1_700_000_000 * 1000).toISOString(),
      amount_cents: 5000,
      eligible_amount_cents: 5000,
      refunded_cents: 2500,
      currency: "cad",
      status: "succeeded",
      payment_type: "online",
      refund_status: "none",
      receipt_url: "https://zeffy.com/receipts/abc123",
    });
    expect(row.items).toEqual([{ type: "donation", amount_cents: 5000, title: "VIP Ticket" }]);
  });

  it("drops what the Hub must not keep: address, answers, card, discount, tribute names", () => {
    const row = paymentRow(
      ORG,
      payment({
        items: [
          {
            type: "donation",
            amount: 2000,
            rate_title: "Gift",
            parent_rate_title: null,
          },
        ],
      }),
      NOW,
    );
    const stored = JSON.stringify(row);
    expect(stored).not.toContain("A friend told me");
    expect(stored).not.toContain("4242");
    expect(stored).not.toContain("visa");
    expect(stored).not.toContain("jane@example.com");
    expect(Object.keys(row)).not.toContain("buyer_questions");
    expect(Object.keys(row)).not.toContain("payment_method");
  });

  it("keeps the company name only when the buyer gave as an organization", () => {
    expect(paymentRow(ORG, payment(), NOW).company_name).toBeNull();
    const corporate = payment({
      buyer: { ...fixture.payment.buyer, is_corporate: true, company_name: "Acme Corp" },
    });
    expect(paymentRow(ORG, corporate, NOW).company_name).toBe("Acme Corp");
  });

  it("counts only refunds that went through", () => {
    const row = paymentRow(
      ORG,
      payment({
        refunds: [
          { amount: 1000, status: "succeeded" },
          { amount: 500, status: "failed" },
          { amount: 250, status: "pending" },
        ],
      }),
      NOW,
    );
    expect(row.refunded_cents).toBe(1000);
  });

  it("keeps fund names by language and only https receipt links", () => {
    const row = paymentRow(
      ORG,
      payment({
        fund: { code: "GEN", name: { EN: "General Fund", FR: "Fonds général", ES: "" } },
        receipt_url: "http://zeffy.com/receipt",
      }),
      NOW,
    );
    expect(row.fund_code).toBe("GEN");
    expect(row.fund_names).toEqual({ EN: "General Fund", FR: "Fonds général" });
    expect(row.receipt_url).toBeNull();
  });

  it.each([
    ["donation", [], ["donor"]],
    ["event", [{ type: "ticket" }], ["ticket"]],
    ["event", [{ type: "ticket" }, { type: "additional_donation" }], ["ticket", "donor"]],
    ["membership", [{ type: "ticket" }], ["member"]],
    ["shop", [{ type: "ticket" }], ["shop"]],
    ["raffle", [], ["raffle"]],
    ["custom", [], ["other"]],
  ])("a %s payment makes the buyer %j", (category, items, kinds) => {
    expect(
      paymentKinds(payment({ campaign_category: category, items: items as ZeffyPayment["items"] })).sort(),
    ).toEqual([...kinds].sort());
  });

  it("marks a recurring donation", () => {
    const kinds = paymentKinds(
      payment({ campaign_category: "donation", recurring: { is_recurring: true, status: "active", interval: "monthly" } }),
    );
    expect(kinds.sort()).toEqual(["donor", "recurring"]);
  });
});

describe("campaign rows", () => {
  it("keeps the public facts of a campaign", () => {
    const row = campaignRow(ORG, zeffyCampaignSchema.parse(fixture.campaign), NOW);
    expect(row).toMatchObject({
      zeffy_id: fixture.campaign.id,
      title: "Annual Gala",
      url: "https://zeffy.com/en-CA/event/annual-gala-2025",
      goal_cents: 100000,
      raised_cents: 42000,
      currency: "cad",
      is_archived: false,
      deleted_at: null,
    });
  });
});

describe("buyers", () => {
  it("reads the buyer of a payment, with a lower-case email", () => {
    expect(buyerFromPayment(payment({ buyer: { ...fixture.payment.buyer, email: "Jane@Example.COM" } }))).toEqual({
      zeffyContactId: fixture.payment.contact,
      fullName: "Jane Doe",
      email: "jane@example.com",
      phone: null,
    });
  });

  it("has nobody to keep when the payment names no contact", () => {
    expect(buyerFromPayment(payment({ contact: null }))).toBeNull();
  });

  it("names a buyer who gave no name in no particular language", () => {
    const buyer = buyerFromPayment(payment({ buyer: { email: null, first_name: null, last_name: null } }));
    expect(buyer?.fullName).toBe(`Zeffy ${String(fixture.payment.contact).slice(0, 8)}`);
  });

  it("reads a Zeffy contact with its phone number", () => {
    expect(buyerFromContact(zeffyContactSchema.parse(fixture.contact))).toEqual({
      zeffyContactId: fixture.contact.id,
      fullName: "Jane Doe",
      email: "jane@example.com",
      phone: "+15141234567",
    });
  });
});

describe("matching a buyer to a CRM contact", () => {
  const buyer = { zeffyContactId: "z-1", fullName: "Jane Doe", email: "jane@example.com", phone: null };

  it("keeps a contact already linked to this Zeffy contact", () => {
    expect(decideMatch(buyer, { id: "c-1", email: "other@example.com", zeffy_contact_id: "z-1" }, [])).toEqual({
      kind: "linked",
      contactId: "c-1",
    });
  });

  it("links the one unlinked contact with the same email, ignoring case", () => {
    expect(
      decideMatch(buyer, null, [{ id: "c-2", email: "Jane@Example.com", zeffy_contact_id: null }]),
    ).toEqual({ kind: "link", contactId: "c-2" });
  });

  it("leaves it for staff when several contacts share the email", () => {
    expect(
      decideMatch(buyer, null, [
        { id: "c-3", email: "jane@example.com", zeffy_contact_id: null },
        { id: "c-2", email: "JANE@example.com", zeffy_contact_id: null },
      ]),
    ).toEqual({ kind: "ambiguous", candidateIds: ["c-2", "c-3"] });
  });

  it("never takes over a contact linked to someone else's Zeffy record", () => {
    expect(
      decideMatch(buyer, null, [{ id: "c-4", email: "jane@example.com", zeffy_contact_id: "z-other" }]),
    ).toEqual({ kind: "create" });
  });

  it("creates a supporter when nobody matches, or when there is no email to go on", () => {
    expect(decideMatch(buyer, null, [])).toEqual({ kind: "create" });
    expect(
      decideMatch({ ...buyer, email: null }, null, [{ id: "c-5", email: null, zeffy_contact_id: null }]),
    ).toEqual({ kind: "create" });
  });
});

describe("webhook signatures", () => {
  const SECRET = "whsec_test_secret_for_zeffy";
  const NOW_S = 1_760_000_000;
  const sign = (body: string, t = NOW_S, secret = SECRET) =>
    `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;

  it("accepts a correctly signed, fresh delivery", () => {
    expect(zeffySignatureIsValid("{}", sign("{}"), SECRET, NOW_S)).toBe(true);
  });

  it("accepts the right signature among several", () => {
    const good = sign("{}").split(",v1=")[1];
    expect(zeffySignatureIsValid("{}", `t=${NOW_S},v1=${"0".repeat(64)},v1=${good}`, SECRET, NOW_S)).toBe(true);
  });

  it.each([
    ["a changed body", () => zeffySignatureIsValid('{"a":1}', sign("{}"), SECRET, NOW_S)],
    ["another secret", () => zeffySignatureIsValid("{}", sign("{}", NOW_S, "whsec_other"), SECRET, NOW_S)],
    ["a delivery older than five minutes", () => zeffySignatureIsValid("{}", sign("{}", NOW_S - 301), SECRET, NOW_S)],
    ["a timestamp from the future", () => zeffySignatureIsValid("{}", sign("{}", NOW_S + 301), SECRET, NOW_S)],
    ["no header", () => zeffySignatureIsValid("{}", null, SECRET, NOW_S)],
    ["no secret configured", () => zeffySignatureIsValid("{}", sign("{}"), undefined, NOW_S)],
    ["a header without v1", () => zeffySignatureIsValid("{}", `t=${NOW_S}`, SECRET, NOW_S)],
    ["a malformed timestamp", () => zeffySignatureIsValid("{}", sign("{}").replace(`t=${NOW_S}`, "t=soon"), SECRET, NOW_S)],
    ["a signature that is not hex", () => zeffySignatureIsValid("{}", `t=${NOW_S},v1=zz`, SECRET, NOW_S)],
  ])("refuses %s", (_label, check) => {
    expect(check()).toBe(false);
  });
});

describe("webhook events", () => {
  it("reads a completed payment with its whole payment", () => {
    const event = parseZeffyEvent({
      id: "evt-1",
      type: "payment.completed",
      version: 1,
      dispatchedAt: "2026-10-14T12:00:00Z",
      data: fixture.payment,
    });
    expect(event?.type).toBe("payment.completed");
    expect(event?.resourceId).toBe(fixture.payment.id);
    expect(event?.payment?.amount).toBe(5000);
  });

  it("reads an id-only update and deletion", () => {
    expect(parseZeffyEvent({ id: "evt-2", type: "payment.updated", data: { id: "p-9", object: "payment" } })).toEqual({
      id: "evt-2",
      type: "payment.updated",
      resourceId: "p-9",
      payment: null,
    });
    expect(parseZeffyEvent({ id: "evt-3", type: "contact.deleted", data: { id: "c-9" } })?.resourceId).toBe("c-9");
  });

  it("ignores events the Hub does not handle and malformed ones", () => {
    expect(parseZeffyEvent({ id: "evt-4", type: "campaign.created", data: { id: "x" } })).toBeNull();
    expect(parseZeffyEvent({ type: "payment.updated", data: { id: "x" } })).toBeNull();
    expect(parseZeffyEvent({ id: "evt-5", type: "payment.updated", data: {} })).toBeNull();
    expect(parseZeffyEvent("nonsense")).toBeNull();
  });
});
