// A stand-in for Zeffy's API, for trying the Zeffy integration locally
// without a Zeffy account. Never used by a deployed site.
//
//   node scripts/qa/zeffy-mock.mjs serve              # http://127.0.0.1:4010
//   ZEFFY_API_KEY=mock-key ZEFFY_API_BASE_URL=http://127.0.0.1:4010 npm run dev
//
//   # Send a signed webhook to the running Hub, as Zeffy would:
//   ZEFFY_WEBHOOK_SECRET=whsec_local node scripts/qa/zeffy-mock.mjs send payment.completed pay-new
//   ZEFFY_WEBHOOK_SECRET=whsec_local node scripts/qa/zeffy-mock.mjs send payment.updated pay-001
//
// The server answers the read endpoints the Hub uses with a small, fixed set
// of supporters, payments and campaigns, in pages of `limit`, honouring
// `starting_after` and `created[gte]` / `updated[gte]`. It checks the bearer
// key (ZEFFY_API_KEY, default "mock-key"). `POST /__refund/<id>` fully
// refunds a payment, to try the refund path. Shapes follow
// https://www.zeffy.com/api/docs/openapi.json.

import { createHmac, randomUUID } from "node:crypto";
import { createServer } from "node:http";

const KEY = process.env.ZEFFY_API_KEY || "mock-key";
const PORT = Number(process.env.ZEFFY_MOCK_PORT || 4010);
const BASE = 1_760_000_000; // 2025-10-09, Unix seconds

const contacts = [
  { id: "zc-ana", first_name: "Ana", last_name: "Tremblay", email: "ana.tremblay@example.org", phone_number: "+15145550101" },
  { id: "zc-ben", first_name: "Ben", last_name: "Okafor", email: "ben.okafor@example.org", phone_number: null },
  { id: "zc-chloe", first_name: "Chloé", last_name: "Gagnon", email: "chloe.gagnon@example.org", phone_number: "+14185550123" },
  { id: "zc-dev", first_name: "Dev", last_name: "Patel", email: "dev.patel@example.org", phone_number: null },
].map((contact, index) => ({ object: "contact", created: BASE + index * 3600, updated: BASE + index * 3600, address: null, metadata: {}, ...contact }));

const campaigns = [
  { id: "camp-gala", type: "ticketing", category: "event", title: "Gala 2026", goal_amount: 2_000_000, volume: 845_000 },
  { id: "camp-annual", type: "donation_form", category: "donation", title: "Annual appeal", goal_amount: 5_000_000, volume: 1_210_000 },
  { id: "camp-members", type: "ticketing", category: "membership", title: "Membership 2026", goal_amount: null, volume: 120_000 },
].map((campaign, index) => ({
  object: "campaign",
  created: BASE + index,
  updated: BASE + index,
  deleted_at: null,
  status: "active",
  description: "",
  locale: "en",
  url: `https://www.zeffy.com/en-CA/mock/${campaign.id}`,
  currency: "cad",
  is_archived: false,
  start_date: BASE,
  end_date: BASE + 90 * 86400,
  occurrences: [],
  metadata: {},
  ...campaign,
}));

function payment(id, contactId, campaignId, cents, offsetHours, extra = {}) {
  const contact = contacts.find((c) => c.id === contactId);
  const campaign = campaigns.find((c) => c.id === campaignId);
  const ticket = campaign.category !== "donation";
  return {
    id,
    object: "payment",
    created: BASE + offsetHours * 3600,
    amount: cents,
    eligible_amount: ticket ? 0 : cents,
    currency: "cad",
    status: "succeeded",
    type: "online",
    refund_status: "none",
    refunds: [],
    dispute: null,
    description: campaign.title,
    contact: contactId,
    payment_method: { type: "card", brand: "visa", last4: "4242" },
    buyer: {
      email: contact.email,
      first_name: contact.first_name,
      last_name: contact.last_name,
      is_corporate: false,
      company_name: null,
      address: { line1: "123 Example St", city: "Montréal" },
    },
    discount: null,
    campaign_type: campaign.type,
    campaign_id: campaignId,
    campaign_category: campaign.category,
    buyer_questions: [{ question: "Dietary needs?", type: "text", answer: "None" }],
    items: [{ object: "item", type: ticket ? "ticket" : "donation", amount: cents, currency: "cad", rate_title: ticket ? "General admission" : "Donation", tribute: null, questions: [] }],
    occurrence_id: null,
    receipt_url: ticket ? null : `https://www.zeffy.com/receipts/${id}`,
    recurring: null,
    fund: { id: "fund-gen", object: "fund", code: "GEN", name: { EN: "General Fund", FR: "Fonds général" } },
    metadata: {},
    ...extra,
  };
}

const payments = [
  payment("pay-001", "zc-ana", "camp-annual", 10_000, 1),
  payment("pay-002", "zc-ana", "camp-gala", 15_000, 2),
  payment("pay-003", "zc-ben", "camp-annual", 2_500, 3, {
    recurring: { is_recurring: true, status: "active", interval: "monthly", subscription_id: "sub-1" },
  }),
  payment("pay-004", "zc-chloe", "camp-members", 4_000, 4),
  payment("pay-005", "zc-dev", "camp-annual", 50_000, 5, {
    buyer: { email: "dev.patel@example.org", first_name: "Dev", last_name: "Patel", is_corporate: true, company_name: "Patel Bakery", address: null },
  }),
  payment("pay-006", "zc-ben", "camp-gala", 15_000, 6, { status: "failed" }),
];

function json(response, status, body, headers = {}) {
  response.writeHead(status, { "content-type": "application/json", ...headers });
  response.end(JSON.stringify(body));
}

function list(items, url, timeField) {
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 10), 1), 100);
  const since = Number(url.searchParams.get(`${timeField}[gte]`) || 0);
  const filtered = items.filter((item) => (item[timeField] ?? 0) >= since);
  const after = url.searchParams.get("starting_after");
  const start = after ? filtered.findIndex((item) => item.id === after) + 1 : 0;
  const page = filtered.slice(start, start + limit);
  const hasMore = start + limit < filtered.length;
  return { object: "list", data: page, has_more: hasMore, next_cursor: hasMore ? page.at(-1).id : null };
}

function serve() {
  let windowStart = Date.now();
  let used = 0;
  createServer((request, response) => {
    const url = new URL(request.url, `http://127.0.0.1:${PORT}`);
    if (request.method === "POST" && url.pathname.startsWith("/__refund/")) {
      const target = payments.find((p) => p.id === url.pathname.split("/").pop());
      if (!target) return json(response, 404, { error: { code: "resource_not_found" } });
      target.refund_status = "full";
      target.refunds = [{ id: `rf-${target.id}`, object: "refund", amount: target.amount, currency: "cad", status: "succeeded", created: Math.floor(Date.now() / 1000) }];
      return json(response, 200, target);
    }
    if (request.headers.authorization !== `Bearer ${KEY}`) {
      return json(response, 401, { error: { type: "authentication_error", code: "invalid_api_key", message: "Invalid API key.", status: 401 } });
    }
    if (Date.now() - windowStart > 60_000) {
      windowStart = Date.now();
      used = 0;
    }
    used += 1;
    const headers = { "x-ratelimit-limit": "100", "x-ratelimit-remaining": String(Math.max(0, 100 - used)) };
    const [, api, version, resource, id] = url.pathname.split("/");
    if (api !== "api" || version !== "v1") return json(response, 404, { error: { code: "resource_not_found" } }, headers);
    const tables = { payments: [payments, "created"], contacts: [contacts, "updated"], campaigns: [campaigns, "created"] };
    const entry = tables[resource];
    if (!entry || request.method !== "GET") return json(response, 404, { error: { code: "resource_not_found" } }, headers);
    if (id) {
      const found = entry[0].find((item) => item.id === id);
      return found ? json(response, 200, found, headers) : json(response, 404, { error: { code: "resource_not_found", param: "id" } }, headers);
    }
    return json(response, 200, list(entry[0], url, entry[1]), headers);
  }).listen(PORT, "127.0.0.1", () => {
    console.log(`Mock Zeffy on http://127.0.0.1:${PORT} (key: ${KEY === "mock-key" ? "mock-key" : "from ZEFFY_API_KEY"})`);
  });
}

async function send(type, resourceId) {
  const secret = process.env.ZEFFY_WEBHOOK_SECRET;
  if (!secret) {
    console.error("ZEFFY_WEBHOOK_SECRET is not set; it must match the Hub's own value.");
    process.exit(2);
  }
  if (!type || !resourceId) {
    console.error("Usage: node scripts/qa/zeffy-mock.mjs send <payment.completed|payment.updated|payment.deleted|contact.updated|contact.deleted> <id> [event-id]");
    process.exit(2);
  }
  const data = type === "payment.completed"
    ? payments.find((p) => p.id === resourceId) ?? payment(resourceId, "zc-ana", "camp-annual", 7_500, 24 * 4)
    : { id: resourceId, object: type.split(".")[0] };
  const body = JSON.stringify({ id: process.argv[5] || randomUUID(), type, version: 1, dispatchedAt: new Date().toISOString(), data });
  const t = Math.floor(Date.now() / 1000);
  const signature = createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
  const origin = (process.env.NEXT_PUBLIC_APP_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
  const response = await fetch(`${origin}/api/integrations/zeffy/webhook`, {
    method: "POST",
    headers: { "content-type": "application/json", "zeffy-signature": `t=${t},v1=${signature}` },
    body,
  });
  console.log(`${type} ${resourceId}: HTTP ${response.status} ${await response.text()}`);
  process.exit(response.ok ? 0 : 1);
}

const [mode, type, id] = process.argv.slice(2);
if (mode === "serve") serve();
else if (mode === "send") await send(type, id);
else {
  console.error("Usage: node scripts/qa/zeffy-mock.mjs serve | send <event-type> <id> [event-id]");
  process.exit(2);
}
