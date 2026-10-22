import type {
  ZeffyBuyer,
  ZeffyCampaign,
  ZeffyCampaignRow,
  ZeffyContact,
  ZeffyKind,
  ZeffyPayment,
  ZeffyPaymentRow,
} from "./types";

/**
 * Turns Zeffy objects into the rows the Hub keeps.
 *
 * What is dropped on purpose (Quebec Law 25, least privilege): the buyer's
 * postal address, answers to checkout and per-ticket questions, payment
 * method details, discount codes, and the names written in tribute ("in
 * memory of") gifts. None of it is needed to know who supports QBBE or how.
 */

function isoFromUnix(seconds: number | null | undefined): string | null {
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) return null;
  return new Date(seconds * 1000).toISOString();
}

function cents(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : null;
}

function httpsOnly(url: string | null | undefined): string | null {
  return typeof url === "string" && url.startsWith("https://") ? url : null;
}

function clean(value: string | null | undefined, max = 300): string | null {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed ? trimmed.slice(0, max) : null;
}

/** Zeffy's campaign category says what kind of thing was bought. */
const KIND_BY_CATEGORY: Record<string, ZeffyKind> = {
  donation: "donor",
  peer_to_peer: "donor",
  event: "ticket",
  membership: "member",
  shop: "shop",
  auction: "auction",
  raffle: "raffle",
  sweepstakes: "raffle",
};

export function paymentKinds(payment: ZeffyPayment): ZeffyKind[] {
  const kinds = new Set<ZeffyKind>();
  const category = payment.campaign_category ?? "";
  const fromCategory = KIND_BY_CATEGORY[category];
  if (fromCategory) kinds.add(fromCategory);
  for (const item of payment.items ?? []) {
    // A donation added on top of a ticket makes the buyer a donor too.
    if (item.type === "donation" || item.type === "additional_donation") kinds.add("donor");
  }
  if (payment.recurring?.is_recurring) kinds.add("recurring");
  if (!kinds.size) kinds.add("other");
  return [...kinds];
}

export function paymentRow(
  organizationId: string,
  payment: ZeffyPayment,
  now: Date,
): ZeffyPaymentRow {
  const refunded = (payment.refunds ?? [])
    .filter((refund) => (refund.status ?? "succeeded") === "succeeded")
    .reduce((sum, refund) => sum + (cents(refund.amount) ?? 0), 0);
  const fundNames = payment.fund?.name
    ? Object.fromEntries(
        Object.entries(payment.fund.name).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].trim() !== "",
        ),
      )
    : null;

  return {
    organization_id: organizationId,
    zeffy_id: payment.id,
    zeffy_contact_id: clean(payment.contact, 200),
    zeffy_campaign_id: clean(payment.campaign_id, 200),
    campaign_title: clean(payment.description),
    campaign_category: clean(payment.campaign_category, 40),
    paid_at: isoFromUnix(payment.created) ?? now.toISOString(),
    amount_cents: cents(payment.amount) ?? 0,
    eligible_amount_cents: cents(payment.eligible_amount),
    refunded_cents: refunded,
    currency: payment.currency.toLowerCase(),
    status: payment.status,
    payment_type: clean(payment.type, 40),
    refund_status: clean(payment.refund_status, 20) ?? "none",
    dispute_status: clean(payment.dispute?.status, 40),
    is_recurring: Boolean(payment.recurring?.is_recurring),
    recurring_interval: clean(payment.recurring?.interval, 40),
    recurring_status: clean(payment.recurring?.status, 40),
    fund_code: clean(payment.fund?.code, 60),
    fund_names: fundNames && Object.keys(fundNames).length ? fundNames : null,
    receipt_url: httpsOnly(payment.receipt_url),
    company_name: payment.buyer?.is_corporate ? clean(payment.buyer.company_name) : null,
    item_kinds: paymentKinds(payment),
    items: (payment.items ?? []).map((item) => ({
      type: clean(item.type, 40),
      amount_cents: cents(item.amount),
      title: clean(item.rate_title) ?? clean(item.parent_rate_title),
    })),
    deleted_at: null,
    synced_at: now.toISOString(),
  };
}

export function campaignRow(
  organizationId: string,
  campaign: ZeffyCampaign,
  now: Date,
): ZeffyCampaignRow {
  return {
    organization_id: organizationId,
    zeffy_id: campaign.id,
    campaign_type: clean(campaign.type, 40),
    category: clean(campaign.category, 40),
    status: clean(campaign.status, 40),
    title: clean(campaign.title) ?? "",
    url: httpsOnly(campaign.url),
    goal_cents: cents(campaign.goal_amount ?? campaign.target),
    raised_cents: cents(campaign.volume),
    currency: clean(campaign.currency, 10)?.toLowerCase() ?? null,
    starts_at: isoFromUnix(campaign.start_date),
    ends_at: isoFromUnix(campaign.end_date),
    is_archived: Boolean(campaign.is_archived),
    deleted_at: isoFromUnix(campaign.deleted_at),
    synced_at: now.toISOString(),
  };
}

function fullName(first: string | null | undefined, last: string | null | undefined): string {
  return [clean(first, 120), clean(last, 120)].filter(Boolean).join(" ");
}

function normalizedEmail(email: string | null | undefined): string | null {
  const value = clean(email, 320);
  return value && value.includes("@") ? value.toLowerCase() : null;
}

/** A name in no particular language, for the rare buyer who gave none. */
function fallbackName(zeffyContactId: string): string {
  return `Zeffy ${zeffyContactId.slice(0, 8)}`;
}

/** The person who paid, or null when the payment names nobody to keep. */
export function buyerFromPayment(payment: ZeffyPayment): ZeffyBuyer | null {
  const zeffyContactId = clean(payment.contact, 200);
  if (!zeffyContactId) return null;
  const email = normalizedEmail(payment.buyer?.email);
  const name = fullName(payment.buyer?.first_name, payment.buyer?.last_name);
  return {
    zeffyContactId,
    fullName: name || email || clean(payment.buyer?.company_name) || fallbackName(zeffyContactId),
    email,
    phone: null,
  };
}

export function buyerFromContact(contact: ZeffyContact): ZeffyBuyer {
  const email = normalizedEmail(contact.email);
  const name = fullName(contact.first_name, contact.last_name);
  return {
    zeffyContactId: contact.id,
    fullName: name || email || fallbackName(contact.id),
    email,
    phone: clean(contact.phone_number, 40),
  };
}
