import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ZeffyClient, type ZeffyResource } from "./client";
import {
  buyerFromContact,
  buyerFromPayment,
  campaignRow,
  paymentRow,
} from "./mapping";
import { decideMatch, type ContactCandidate } from "./matching";
import {
  zeffyCampaignSchema,
  zeffyContactSchema,
  zeffyPaymentSchema,
  type ZeffyBuyer,
  type ZeffyContact,
  type ZeffyPayment,
} from "./types";

/**
 * Copies Zeffy into the Hub. Shared by the 15-minute `zeffy-sync` job, the
 * one-minute `zeffy-events` job and the webhook route, so a payment lands the
 * same way whichever path brought it.
 *
 * Everything is idempotent: payments and campaigns are upserted on their
 * Zeffy id, supporters are linked or created once (a unique index stops a
 * second copy), and a page saved twice changes nothing.
 */

export interface ZeffyContext {
  db: SupabaseClient;
  organizationId: string;
  now: Date;
}

/** Re-read a day of overlap on each incremental walk, against clock skew. */
const OVERLAP_SECONDS = 24 * 60 * 60;
/** Refunds and disputes can come months later; re-read this far back daily. */
export const REFRESH_DAYS = 120;
const REFRESH_EVERY_MS = 24 * 60 * 60 * 1000;
const CAMPAIGNS_EVERY_MS = 60 * 60 * 1000;

/** How an erased person's email is kept in zeffy_suppressed_contact. */
export function emailHash(email: string): string {
  return createHash("sha256").update(email.trim().toLowerCase(), "utf8").digest("hex");
}

/** The Zeffy identities (by id or by email) erased from this organization's CRM. */
async function suppressedIdentities(
  ctx: ZeffyContext,
  ids: string[],
  emails: string[],
): Promise<{ ids: Set<string>; emailHashes: Set<string> }> {
  const hashes = [...new Set(emails.map(emailHash))];
  const rows: { zeffy_contact_id: string; email_sha256: string | null }[] = [];
  for (const [column, values] of [["zeffy_contact_id", ids], ["email_sha256", hashes]] as const) {
    if (!values.length) continue;
    const { data, error } = await ctx.db
      .from("zeffy_suppressed_contact")
      .select("zeffy_contact_id, email_sha256")
      .eq("organization_id", ctx.organizationId)
      .in(column, [...values]);
    fail("load erased supporters", error);
    rows.push(...((data ?? []) as typeof rows));
  }
  return {
    ids: new Set(rows.map((row) => row.zeffy_contact_id)),
    emailHashes: new Set(rows.map((row) => row.email_sha256).filter((hash): hash is string => Boolean(hash))),
  };
}

function fail(what: string, error: { message: string } | null): void {
  if (error) throw new Error(`Could not ${what}: ${error.message}`);
}

// ---------------------------------------------------------------------------
// Supporters
// ---------------------------------------------------------------------------

export interface PlacementSummary {
  linked: number;
  created: number;
  ambiguous: number;
}

/**
 * Finds or creates the CRM contact for each buyer. `refreshDetails` lets a
 * Zeffy contact update overwrite the name, email and phone of a contact the
 * sync itself created, unless someone corrected it in the Hub; a contact
 * someone entered in the Hub keeps its values. A buyer whose Zeffy identity
 * was erased (zeffy_suppressed_contact) is neither linked nor created.
 */
export async function placeBuyers(
  ctx: ZeffyContext,
  buyers: ZeffyBuyer[],
  options: { refreshDetails?: boolean; createMissing?: boolean } = {},
): Promise<PlacementSummary> {
  const summary: PlacementSummary = { linked: 0, created: 0, ambiguous: 0 };
  const unique = new Map<string, ZeffyBuyer>();
  for (const buyer of buyers) unique.set(buyer.zeffyContactId, buyer);
  if (!unique.size) return summary;

  const suppressed = await suppressedIdentities(
    ctx,
    [...unique.keys()],
    [...unique.values()].map((buyer) => buyer.email).filter((email): email is string => Boolean(email)),
  );
  for (const [id, buyer] of unique) {
    if (suppressed.ids.has(id) || (buyer.email && suppressed.emailHashes.has(emailHash(buyer.email)))) unique.delete(id);
  }
  if (!unique.size) return summary;
  const createMissing = options.createMissing ?? true;

  const ids = [...unique.keys()];
  const { data: linkedRows, error: linkedError } = await ctx.db
    .from("crm_contact")
    .select("id, email, zeffy_contact_id, source, details_edited_at")
    .eq("organization_id", ctx.organizationId)
    .in("zeffy_contact_id", ids);
  fail("load linked supporters", linkedError);
  type Linked = ContactCandidate & { source: string; details_edited_at?: string | null };
  const linkedById = new Map<string, Linked>();
  for (const row of (linkedRows ?? []) as Linked[]) {
    if (row.zeffy_contact_id) linkedById.set(row.zeffy_contact_id, row);
  }

  const emails = [...unique.values()]
    .filter((buyer) => !linkedById.has(buyer.zeffyContactId) && buyer.email)
    .map((buyer) => buyer.email as string);
  let byEmail: ContactCandidate[] = [];
  if (emails.length) {
    const { data, error } = await ctx.db.rpc("zeffy_contacts_by_email", {
      p_organization: ctx.organizationId,
      p_emails: [...new Set(emails)],
    });
    fail("look up supporters by email", error);
    byEmail = (data ?? []) as ContactCandidate[];
  }
  // A contact linked during this batch is no longer free for the next buyer.
  const taken = new Set<string>();
  const toCreate: ZeffyBuyer[] = [];

  for (const buyer of unique.values()) {
    const linked = linkedById.get(buyer.zeffyContactId) ?? null;
    const decision = decideMatch(
      buyer,
      linked,
      byEmail.filter((contact) => !taken.has(contact.id)),
    );

    if (decision.kind === "linked") {
      if (options.refreshDetails && linked?.source === "zeffy" && !linked.details_edited_at) {
        const update: Record<string, string> = { full_name: buyer.fullName };
        if (buyer.email) update.email = buyer.email;
        if (buyer.phone) update.phone = buyer.phone;
        const { error } = await ctx.db
          .from("crm_contact")
          .update(update)
          .eq("id", decision.contactId)
          .eq("organization_id", ctx.organizationId);
        fail("update a supporter's details", error);
      }
      continue;
    }

    if (decision.kind === "link") {
      const { data, error } = await ctx.db
        .from("crm_contact")
        .update({ zeffy_contact_id: buyer.zeffyContactId })
        .eq("id", decision.contactId)
        .eq("organization_id", ctx.organizationId)
        .is("zeffy_contact_id", null)
        .select("id");
      fail("link a supporter", error);
      if ((data ?? []).length) {
        taken.add(decision.contactId);
        summary.linked += 1;
        await closeMatch(ctx, buyer.zeffyContactId);
        continue;
      }
      // Someone linked that contact in the meantime: treat as new below.
    }

    if (decision.kind === "ambiguous") {
      const { error } = await ctx.db.from("zeffy_contact_match").upsert(
        {
          organization_id: ctx.organizationId,
          zeffy_contact_id: buyer.zeffyContactId,
          full_name: buyer.fullName,
          email: buyer.email,
          candidate_ids: decision.candidateIds,
          resolved_at: null,
        },
        { onConflict: "organization_id,zeffy_contact_id" },
      );
      fail("record a supporter to match", error);
      summary.ambiguous += 1;
      continue;
    }

    if (createMissing) toCreate.push(buyer);
  }

  if (toCreate.length) summary.created += await createSupporters(ctx, toCreate);
  return summary;
}

/**
 * Creates supporters in one statement. If another run created one of them a
 * moment ago (unique index, 23505), the batch is retried one by one so the
 * others still land and the duplicate is skipped.
 */
async function createSupporters(ctx: ZeffyContext, buyers: ZeffyBuyer[]): Promise<number> {
  const row = (buyer: ZeffyBuyer) => ({
    organization_id: ctx.organizationId,
    full_name: buyer.fullName,
    email: buyer.email,
    phone: buyer.phone,
    status: "active",
    source: "zeffy",
    zeffy_contact_id: buyer.zeffyContactId,
  });
  const { error } = await ctx.db.from("crm_contact").insert(buyers.map(row));
  if (!error) return buyers.length;
  if ((error as { code?: string }).code !== "23505") fail("create supporters", error);

  let created = 0;
  for (const buyer of buyers) {
    const { error: oneError } = await ctx.db.from("crm_contact").insert(row(buyer));
    if (!oneError) created += 1;
    else if ((oneError as { code?: string }).code !== "23505") fail("create a supporter", oneError);
  }
  return created;
}

async function closeMatch(ctx: ZeffyContext, zeffyContactId: string): Promise<void> {
  const { error } = await ctx.db
    .from("zeffy_contact_match")
    .update({ resolved_at: ctx.now.toISOString() })
    .eq("organization_id", ctx.organizationId)
    .eq("zeffy_contact_id", zeffyContactId)
    .is("resolved_at", null);
  fail("close a supporter match", error);
}

/**
 * Recomputes what each supporter did (donor, ticket, ...) and when they last
 * did it, from their payments, in one statement (see the migration).
 */
export async function refreshKinds(ctx: ZeffyContext, zeffyContactIds: string[]): Promise<void> {
  const ids = [...new Set(zeffyContactIds.filter(Boolean))];
  if (!ids.length) return;
  const { error } = await ctx.db.rpc("zeffy_refresh_supporter_kinds", {
    p_organization: ctx.organizationId,
    p_zeffy_contact_ids: ids,
  });
  fail("update supporters' activity", error);
}

// ---------------------------------------------------------------------------
// Payments, contacts, campaigns
// ---------------------------------------------------------------------------

/** Saves payments and places their buyers. Returns the Zeffy contacts touched. */
export async function savePayments(
  ctx: ZeffyContext,
  payments: ZeffyPayment[],
): Promise<{ saved: number; contacts: string[]; placement: PlacementSummary }> {
  if (!payments.length) {
    return { saved: 0, contacts: [], placement: { linked: 0, created: 0, ambiguous: 0 } };
  }
  const rows = new Map(payments.map((payment) => [payment.id, paymentRow(ctx.organizationId, payment, ctx.now)]));
  // An erased supporter's payments keep their amounts, not their identity.
  const erased = await suppressedIdentities(
    ctx,
    [...new Set([...rows.values()].map((row) => row.zeffy_contact_id).filter((id): id is string => Boolean(id)))],
    [],
  );
  for (const row of rows.values()) {
    if (row.zeffy_contact_id && erased.ids.has(row.zeffy_contact_id)) {
      row.company_name = null;
      row.receipt_url = null;
    }
  }
  const { error } = await ctx.db
    .from("zeffy_payment")
    .upsert([...rows.values()], { onConflict: "organization_id,zeffy_id" });
  fail("save Zeffy payments", error);

  const buyers = payments
    .filter((payment) => payment.status === "succeeded")
    .map(buyerFromPayment)
    .filter((buyer): buyer is ZeffyBuyer => buyer !== null);
  const placement = await placeBuyers(ctx, buyers);
  const contacts = [...new Set([...rows.values()].map((row) => row.zeffy_contact_id).filter(Boolean))] as string[];
  await refreshKinds(ctx, contacts);
  return { saved: rows.size, contacts, placement };
}

/** Marks a payment Zeffy deleted; it stops counting but its record stays. */
export async function markPaymentDeleted(ctx: ZeffyContext, zeffyId: string): Promise<void> {
  const { data, error } = await ctx.db
    .from("zeffy_payment")
    .update({ deleted_at: ctx.now.toISOString() })
    .eq("organization_id", ctx.organizationId)
    .eq("zeffy_id", zeffyId)
    .select("zeffy_contact_id");
  fail("mark a Zeffy payment deleted", error);
  const contacts = ((data ?? []) as { zeffy_contact_id: string | null }[])
    .map((row) => row.zeffy_contact_id)
    .filter((id): id is string => Boolean(id));
  await refreshKinds(ctx, contacts);
}

/** Zeffy contact changes update supporters the sync created; nobody new is added. */
export async function saveContacts(ctx: ZeffyContext, contacts: ZeffyContact[]): Promise<number> {
  const buyers = contacts.map(buyerFromContact);
  await placeBuyers(ctx, buyers, { refreshDetails: true, createMissing: false });
  return buyers.length;
}

/**
 * A contact deleted in Zeffy is an erasure request: its CRM contact is
 * erased (public.erase_crm_contact keeps gift amounts and suppresses the
 * Zeffy identity), and an identity with no CRM contact is suppressed so a
 * later payment does not import it.
 */
export async function eraseDeletedContact(ctx: ZeffyContext, zeffyContactId: string): Promise<void> {
  const { data, error } = await ctx.db
    .from("crm_contact")
    .select("id, source")
    .eq("organization_id", ctx.organizationId)
    .eq("zeffy_contact_id", zeffyContactId);
  fail("find a deleted Zeffy contact", error);
  for (const row of (data ?? []) as { id: string; source: string }[]) {
    if (row.source === "zeffy") {
      const { error: eraseError } = await ctx.db.rpc("erase_crm_contact", { p_contact: row.id });
      fail("erase a deleted Zeffy contact", eraseError);
    }
  }
  // A contact entered in the Hub is QBBE's own record: it loses only its
  // Zeffy link; erasing it is an administrator's decision.
  await unlinkContact(ctx, zeffyContactId);

  const { data: matches, error: matchError } = await ctx.db
    .from("zeffy_contact_match")
    .select("email")
    .eq("organization_id", ctx.organizationId)
    .eq("zeffy_contact_id", zeffyContactId);
  fail("read a deleted Zeffy contact's match", matchError);
  const email = ((matches ?? []) as { email: string | null }[]).find((row) => row.email)?.email ?? null;
  const { error: suppressError } = await ctx.db
    .from("zeffy_suppressed_contact")
    .upsert(
      { organization_id: ctx.organizationId, zeffy_contact_id: zeffyContactId, email_sha256: email ? emailHash(email) : null },
      { onConflict: "organization_id,zeffy_contact_id", ignoreDuplicates: true },
    );
  fail("suppress a deleted Zeffy contact", suppressError);
  const { error: deleteMatchError } = await ctx.db
    .from("zeffy_contact_match")
    .delete()
    .eq("organization_id", ctx.organizationId)
    .eq("zeffy_contact_id", zeffyContactId);
  fail("forget a deleted Zeffy contact's match", deleteMatchError);
  const { error: paymentError } = await ctx.db
    .from("zeffy_payment")
    .update({ company_name: null, receipt_url: null })
    .eq("organization_id", ctx.organizationId)
    .eq("zeffy_contact_id", zeffyContactId);
  fail("detach a deleted Zeffy contact's payments", paymentError);
}

/** A contact Zeffy no longer returns: the CRM contact stays, its Zeffy link goes. */
export async function unlinkContact(ctx: ZeffyContext, zeffyContactId: string): Promise<void> {
  const { error } = await ctx.db
    .from("crm_contact")
    .update({ zeffy_contact_id: null, zeffy_kinds: [], zeffy_last_activity_at: null })
    .eq("organization_id", ctx.organizationId)
    .eq("zeffy_contact_id", zeffyContactId);
  fail("unlink a deleted Zeffy contact", error);
  await closeMatch(ctx, zeffyContactId);
}

function parseEach<T>(items: unknown[], parse: (item: unknown) => { success: boolean; data?: T }): { valid: T[]; skipped: number } {
  const valid: T[] = [];
  let skipped = 0;
  for (const item of items) {
    const result = parse(item);
    if (result.success && result.data !== undefined) valid.push(result.data);
    else skipped += 1;
  }
  return { valid, skipped };
}

// ---------------------------------------------------------------------------
// The scheduled sync: incremental walks that survive being cut short
// ---------------------------------------------------------------------------

interface Walk {
  from: number | null;
  cursor: string | null;
  max: number | null;
}

interface Stream {
  since?: number | null;
  walk?: Walk | null;
  doneAt?: string | null;
}

export interface ZeffySyncState {
  payments?: Stream;
  contacts?: Stream;
  refresh?: Stream;
  campaignsAt?: string | null;
  firstSyncDoneAt?: string | null;
}

export interface Budget {
  /** Requests this run may send. */
  maxRequests: number;
  /** Wall-clock time (ms since epoch) by which the run stops starting pages. */
  deadline: number;
}

export interface SyncOutcome {
  payments: number;
  contacts: number;
  campaigns: number;
  skipped: number;
  created: number;
  linked: number;
  ambiguous: number;
  /** True when every walk reached its end within this run. */
  complete: boolean;
  requests: number;
}

async function loadState(ctx: ZeffyContext): Promise<ZeffySyncState> {
  const { data, error } = await ctx.db
    .from("zeffy_sync_state")
    .select("state")
    .eq("organization_id", ctx.organizationId)
    .maybeSingle();
  fail("load the Zeffy sync state", error);
  return ((data as { state?: ZeffySyncState } | null)?.state ?? {}) as ZeffySyncState;
}

export async function saveState(ctx: ZeffyContext, state: ZeffySyncState): Promise<void> {
  const { error } = await ctx.db.from("zeffy_sync_state").upsert(
    { organization_id: ctx.organizationId, state, updated_at: new Date().toISOString() },
    { onConflict: "organization_id" },
  );
  fail("save the Zeffy sync state", error);
}

function outOfBudget(client: ZeffyClient, budget: Budget): boolean {
  return client.requests >= budget.maxRequests || Date.now() >= budget.deadline || client.nearLimit();
}

/**
 * Walks one list from where it left off. Returns true when the list was read
 * to its end. The cursor is saved after every page, so a run cut short by
 * time, budget or a 429 loses nothing.
 */
async function walk(
  ctx: ZeffyContext,
  client: ZeffyClient,
  budget: Budget,
  state: ZeffySyncState,
  key: "payments" | "contacts" | "refresh",
  resource: ZeffyResource,
  filter: "created[gte]" | "updated[gte]" | null,
  startFrom: () => number | null,
  onPage: (items: unknown[]) => Promise<number | null>,
): Promise<boolean> {
  const stream: Stream = state[key] ?? {};
  state[key] = stream;
  if (!stream.walk) stream.walk = { from: startFrom(), cursor: null, max: stream.since ?? null };

  while (stream.walk) {
    if (outOfBudget(client, budget)) {
      await saveState(ctx, state);
      return false;
    }
    const params: Record<string, string | number | null> = { starting_after: stream.walk.cursor };
    if (filter && stream.walk.from !== null) params[filter] = stream.walk.from;
    const page = await client.listPage(resource, params);
    const newest = await onPage(page.data);
    if (newest !== null) stream.walk.max = Math.max(stream.walk.max ?? 0, newest);

    if (page.hasMore && page.nextCursor) {
      stream.walk.cursor = page.nextCursor;
    } else {
      stream.since = stream.walk.max ?? stream.since ?? null;
      stream.walk = null;
      stream.doneAt = ctx.now.toISOString();
    }
    await saveState(ctx, state);
  }
  return true;
}

export async function syncOrganization(
  ctx: ZeffyContext,
  client: ZeffyClient,
  budget: Budget,
): Promise<SyncOutcome> {
  const outcome: SyncOutcome = {
    payments: 0,
    contacts: 0,
    campaigns: 0,
    skipped: 0,
    created: 0,
    linked: 0,
    ambiguous: 0,
    complete: false,
    requests: 0,
  };
  const state = await loadState(ctx);
  const nowSeconds = Math.floor(ctx.now.getTime() / 1000);

  const onPayments = async (items: unknown[]): Promise<number | null> => {
    const { valid, skipped } = parseEach(items, (item) => zeffyPaymentSchema.safeParse(item));
    outcome.skipped += skipped;
    const saved = await savePayments(ctx, valid);
    outcome.payments += saved.saved;
    outcome.created += saved.placement.created;
    outcome.linked += saved.placement.linked;
    outcome.ambiguous += saved.placement.ambiguous;
    return valid.length ? Math.max(...valid.map((payment) => payment.created)) : null;
  };

  // 1. New payments since the last complete walk (everything, the first time).
  const paymentsDone = await walk(ctx, client, budget, state, "payments", "payments", "created[gte]",
    () => (state.payments?.since ? state.payments.since - OVERLAP_SECONDS : null),
    onPayments);

  // 2. Contact changes, for supporters the sync created.
  let contactsDone = false;
  if (paymentsDone) {
    contactsDone = await walk(ctx, client, budget, state, "contacts", "contacts", "updated[gte]",
      () => (state.contacts?.since ? state.contacts.since - OVERLAP_SECONDS : null),
      async (items) => {
        const { valid, skipped } = parseEach(items, (item) => zeffyContactSchema.safeParse(item));
        outcome.skipped += skipped;
        outcome.contacts += await saveContacts(ctx, valid);
        const stamps = valid.map((contact) => contact.updated ?? 0);
        return stamps.length ? Math.max(...stamps) : null;
      });
  }

  // 3. Campaigns, hourly: a short list.
  let campaignsDone = true;
  const campaignsDue = !state.campaignsAt || ctx.now.getTime() - Date.parse(state.campaignsAt) >= CAMPAIGNS_EVERY_MS;
  if (contactsDone && campaignsDue) {
    campaignsDone = false;
    let cursor: string | null = null;
    for (;;) {
      if (outOfBudget(client, budget)) break;
      const page = await client.listPage("campaigns", { starting_after: cursor });
      const { valid, skipped } = parseEach(page.data, (item) => zeffyCampaignSchema.safeParse(item));
      outcome.skipped += skipped;
      if (valid.length) {
        const { error } = await ctx.db
          .from("zeffy_campaign")
          .upsert(valid.map((campaign) => campaignRow(ctx.organizationId, campaign, ctx.now)), {
            onConflict: "organization_id,zeffy_id",
          });
        fail("save Zeffy campaigns", error);
        outcome.campaigns += valid.length;
      }
      if (!page.hasMore || !page.nextCursor) {
        campaignsDone = true;
        state.campaignsAt = ctx.now.toISOString();
        await saveState(ctx, state);
        break;
      }
      cursor = page.nextCursor;
    }
  }

  // 4. Once a day, re-read recent payments: a refund or dispute changes an old
  //    payment, and a missed webhook must not leave it counted.
  let refreshDone = true;
  const refreshDue =
    Boolean(state.refresh?.walk) ||
    !state.refresh?.doneAt ||
    ctx.now.getTime() - Date.parse(state.refresh.doneAt) >= REFRESH_EVERY_MS;
  if (contactsDone && campaignsDone && refreshDue && state.firstSyncDoneAt) {
    refreshDone = await walk(ctx, client, budget, state, "refresh", "payments", "created[gte]",
      () => nowSeconds - REFRESH_DAYS * 24 * 60 * 60,
      async (items) => {
        await onPayments(items);
        return null;
      });
  }

  outcome.complete = paymentsDone && contactsDone && campaignsDone && refreshDone;
  if (outcome.complete && !state.firstSyncDoneAt) {
    // The first full copy just finished; the next daily refresh starts tomorrow.
    state.firstSyncDoneAt = ctx.now.toISOString();
    state.refresh = { ...(state.refresh ?? {}), doneAt: ctx.now.toISOString(), walk: null };
  }
  await saveState(ctx, state);
  outcome.requests = client.requests;
  return outcome;
}
