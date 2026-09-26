"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorizeAdminAction } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { requiredText } from "@/lib/schema";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import type { ActionResult } from "@/features/tasks/services/task.commands";
import { parseMoneyToCents } from "@/features/ledger/money";
import {
  EmailSendError,
  recipientIsAllowed,
  sendEmail,
} from "@/features/notifications/services/email-provider";
import {
  LANGUAGES,
  letterBodyHtml,
  renderAnnualStatement,
  renderGiftAcknowledgement,
} from "@/features/gifts/acknowledgement";
import {
  donorName,
  loadGift,
  organizationName,
  parseDonorKey,
  statementGifts,
  toAckGift,
  type StatementRow,
} from "@/features/gifts/services/gift.data";

/**
 * Gift, grant and acknowledgement actions (#156). Every write is for owners
 * and admins who completed MFA; the database checks the same thing again,
 * posts gifts through the ledger's own functions, refuses any letter without
 * the bilingual "not an official receipt" sentence, and writes the audit
 * record for each step.
 */

const GIFTS = "/finance/gifts";
const GRANTS = "/finance/gifts/grants";

type DbError = { code?: string; message: string } | null;

// The database's own rules raise with sentences written for people; anything
// else (row-level security, a network failure) gets a generic message.
const READABLE_CODES = new Set(["23514", "22023", "42501", "23505", "P0002"]);

function dbMessage(error: DbError, fallback: string): string {
  if (!error) return fallback;
  if (error.code === "23503") return "An account, fund, donor, program or grant is not in this organization.";
  if (error.code === "23514" && /violates check constraint/i.test(error.message)) {
    return "Check the values entered.";
  }
  if (
    error.code &&
    READABLE_CODES.has(error.code) &&
    !/row-level security|permission denied/i.test(error.message)
  ) {
    return error.message;
  }
  return fallback;
}

async function authorize(
  action: "gift:write" | "gift:email" = "gift:write",
): Promise<{ ok: true; organizationId: string; userId: string } | { ok: false; result: ActionResult }> {
  const auth = await authorizeAdminAction();
  if (!auth.ok) return { ok: false, result: { ok: false, error: auth.error } };
  const limited = await enforceRateLimit(action, auth.session.userId);
  if (limited) return { ok: false, result: limited };
  return { ok: true, organizationId: auth.session.organizationId, userId: auth.session.userId };
}

const isoDate = (message: string) => requiredText(message).regex(/^\d{4}-\d{2}-\d{2}$/, message);
const optionalUuid = z
  .string()
  .trim()
  .optional()
  .transform((v) => v || null)
  .pipe(z.string().uuid().nullable());
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => v || null);
const optionalDate = z
  .string()
  .trim()
  .regex(/^(\d{4}-\d{2}-\d{2})?$/, "Enter dates as YYYY-MM-DD.")
  .optional()
  .transform((v) => v || null);

function todayInToronto(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Toronto" });
}

// ---------------------------------------------------------------------------
// Gifts
// ---------------------------------------------------------------------------

const giftSchema = z
  .object({
    giftType: z.enum(["donation", "grant_payment", "in_kind"], { message: "Choose the kind of gift." }),
    donor: requiredText("Choose the donor from the CRM."),
    receivedOn: isoDate("Enter the date the gift was received."),
    amount: z.string().trim().optional(),
    inKindDescription: optionalText(1000),
    valueSuppliedByDonor: z.boolean().default(false),
    fundId: optionalUuid,
    programId: optionalUuid,
    donorRestriction: optionalText(1000),
    grantId: optionalUuid,
    debitAccountId: optionalUuid,
    creditAccountId: optionalUuid,
    note: optionalText(1000),
  })
  .superRefine((g, ctx) => {
    if (g.giftType === "in_kind" && !g.inKindDescription) {
      ctx.addIssue({ code: "custom", message: "Describe the in-kind gift.", path: ["inKindDescription"] });
    }
    if (g.giftType === "grant_payment" && !g.grantId) {
      ctx.addIssue({ code: "custom", message: "Choose the grant this payment is for.", path: ["grantId"] });
    }
    if (g.giftType !== "grant_payment" && !g.fundId) {
      ctx.addIssue({ code: "custom", message: "Choose the fund the gift belongs to.", path: ["fundId"] });
    }
  });

export async function recordGift(input: unknown): Promise<ActionResult> {
  const auth = await authorize();
  if (!auth.ok) return auth.result;
  const parsed = giftSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message };
  const g = parsed.data;
  const donor = parseDonorKey(g.donor);
  if (!donor) return { ok: false, error: "Choose the donor from the CRM." };

  let amountCents: number | null = null;
  if (g.amount) {
    amountCents = parseMoneyToCents(g.amount);
    if (amountCents === null || amountCents <= 0) {
      return { ok: false, error: "Enter the amount as dollars and cents, for example 250.00." };
    }
  }
  if (g.giftType === "in_kind" && amountCents !== null && !g.valueSuppliedByDonor) {
    return {
      ok: false,
      error: "Leave the value blank unless the donor told you what the in-kind gift is worth.",
    };
  }
  const posts = amountCents !== null;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("gift_record", {
    p_organization: auth.organizationId,
    p_gift: {
      gift_type: g.giftType,
      crm_contact_id: donor.kind === "contact" ? donor.id : null,
      crm_organization_id: donor.kind === "organization" ? donor.id : null,
      received_on: g.receivedOn,
      amount_cents: amountCents,
      in_kind_description: g.giftType === "in_kind" ? g.inKindDescription : null,
      value_supplied_by_donor: g.giftType === "in_kind" && amountCents !== null && g.valueSuppliedByDonor,
      fund_id: g.fundId,
      program_id: g.programId,
      donor_restriction: g.donorRestriction,
      grant_id: g.giftType === "grant_payment" ? g.grantId : null,
      debit_account_id: posts ? g.debitAccountId : null,
      credit_account_id: posts ? g.creditAccountId : null,
      note: g.note,
    },
  });
  if (error || !data) return { ok: false, error: dbMessage(error, "Could not record the gift. Try again.") };
  revalidatePath(GIFTS, "layout");
  revalidatePath("/finance/ledger", "layout");
  if (g.grantId) revalidatePath(GRANTS, "layout");
  return { ok: true, id: data as string };
}

const voidSchema = z.object({
  giftId: z.string().uuid({ message: "Gift not found." }),
  voidOn: isoDate("Enter the date of the correction."),
  reason: requiredText("Give the reason for voiding the gift.", 500),
});

export async function voidGift(input: unknown): Promise<ActionResult> {
  const auth = await authorize();
  if (!auth.ok) return auth.result;
  const parsed = voidSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("gift_void", {
    p_gift: parsed.data.giftId,
    p_date: parsed.data.voidOn,
    p_reason: parsed.data.reason,
  });
  if (error) return { ok: false, error: dbMessage(error, "Could not void the gift. Try again.") };
  revalidatePath(GIFTS, "layout");
  revalidatePath("/finance/ledger", "layout");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Acknowledgements and annual statements
// ---------------------------------------------------------------------------

const deliverySchema = z
  .object({
    language: z.enum(LANGUAGES, { message: "Choose English or French." }),
    channel: z.enum(["print", "email"], { message: "Choose print or email." }),
    recipientEmail: z
      .string()
      .trim()
      .max(320)
      .optional()
      .transform((v) => v || null)
      .pipe(z.string().email("Enter a valid email address.").nullable()),
  })
  .refine((d) => d.channel !== "email" || d.recipientEmail, {
    message: "Enter the donor's email address.",
    path: ["recipientEmail"],
  });

type Delivery = z.infer<typeof deliverySchema>;

/**
 * Emails an issued letter through the app's sender. The non-production
 * recipient allowlist (EMAIL_RECIPIENT_ALLOWLIST) is checked first so a
 * blocked address is recorded as blocked rather than as a failure, and an
 * address the provider reported as bounced or complained is never mailed.
 */
async function deliverByEmail(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  ack: { id: string; to: string; subject: string; text: string },
): Promise<ActionResult> {
  const mark = (fields: Record<string, unknown>) =>
    supabase.from("gift_acknowledgement").update(fields).eq("id", ack.id);

  if (!recipientIsAllowed(ack.to)) {
    await mark({
      email_status: "blocked",
      email_error: "Recipient is not on this environment's email allowlist; nothing was sent.",
    });
    return {
      ok: false,
      id: ack.id,
      error: "The acknowledgement was saved, but this environment only emails allowlisted addresses, so nothing was sent.",
    };
  }
  const service = createSupabaseServiceClient();
  const { data: suppressed } = await service
    .from("email_suppression")
    .select("reason")
    .eq("address", ack.to.trim().toLowerCase())
    .maybeSingle();
  if (suppressed) {
    await mark({ email_status: "blocked", email_error: `Address ${suppressed.reason as string}; not mailed again.` });
    return {
      ok: false,
      id: ack.id,
      error: "The acknowledgement was saved, but this address previously bounced or complained, so it was not emailed.",
    };
  }
  try {
    await sendEmail({
      idempotencyKey: `gift-ack:${ack.id}`,
      to: ack.to,
      subject: ack.subject,
      text: ack.text,
      html: `<!doctype html><html><body style="font-family:Georgia,serif;font-size:15px;line-height:1.55;color:black;max-width:40rem;margin:0 auto;padding:24px">${letterBodyHtml(ack.text)}</body></html>`,
    });
  } catch (err) {
    const message = err instanceof EmailSendError ? err.message : "The email provider did not accept the message.";
    await mark({ email_status: "failed", email_error: message.slice(0, 500) });
    return { ok: false, id: ack.id, error: "The acknowledgement was saved, but the email could not be sent. Try again from the gift page." };
  }
  await mark({ email_status: "sent", sent_at: new Date().toISOString(), email_error: null });
  return { ok: true, id: ack.id };
}

async function issue(
  auth: { organizationId: string },
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  row: Record<string, unknown>,
  letter: { subject: string; text: string },
  delivery: Delivery,
): Promise<ActionResult> {
  const { data, error } = await supabase
    .from("gift_acknowledgement")
    .insert({
      ...row,
      organization_id: auth.organizationId,
      language: delivery.language,
      channel: delivery.channel,
      recipient_email: delivery.channel === "email" ? delivery.recipientEmail : null,
      subject: letter.subject,
      body_text: letter.text,
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: dbMessage(error, "Could not issue the acknowledgement. Try again.") };
  const id = data.id as string;
  if (delivery.channel === "email" && delivery.recipientEmail) {
    return deliverByEmail(supabase, { id, to: delivery.recipientEmail, subject: letter.subject, text: letter.text });
  }
  return { ok: true, id };
}

const giftAckSchema = z.object({ giftId: z.string().uuid({ message: "Gift not found." }) });

/** Builds the thank-you letter from the recorded gift, stores it as issued, and prints or emails it. */
export async function issueGiftAcknowledgement(input: unknown): Promise<ActionResult> {
  const parsedDelivery = deliverySchema.safeParse(input);
  if (!parsedDelivery.success) return { ok: false, error: parsedDelivery.error.issues[0]?.message };
  const parsed = giftAckSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message };
  const auth = await authorize(parsedDelivery.data.channel === "email" ? "gift:email" : "gift:write");
  if (!auth.ok) return auth.result;

  const supabase = await createSupabaseServerClient();
  const gift = await loadGift(supabase, auth.organizationId, parsed.data.giftId);
  if (!gift) return { ok: false, error: "Gift not found." };
  if (gift.status !== "recorded") return { ok: false, error: "A voided gift is not acknowledged." };
  const org = await organizationName(supabase, auth.organizationId);
  const letter = renderGiftAcknowledgement({
    language: parsedDelivery.data.language,
    organizationName: org,
    donorName: donorName(gift),
    issuedOn: todayInToronto(),
    gift: toAckGift(gift),
  });
  const result = await issue(
    auth,
    supabase,
    {
      kind: "gift",
      gift_id: gift.id,
      crm_contact_id: gift.crm_contact_id,
      crm_organization_id: gift.crm_organization_id,
      recipient_name: donorName(gift).slice(0, 200),
    },
    letter,
    parsedDelivery.data,
  );
  revalidatePath(`${GIFTS}/${gift.id}`);
  return result;
}

const statementSchema = z.object({
  donor: requiredText("Choose the donor."),
  year: z.coerce.number().int().min(2000).max(2100),
});

/** Issues a donor's annual statement of gifts for one calendar year. */
export async function issueAnnualStatement(input: unknown): Promise<ActionResult> {
  const parsedDelivery = deliverySchema.safeParse(input);
  if (!parsedDelivery.success) return { ok: false, error: parsedDelivery.error.issues[0]?.message };
  const parsed = statementSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Choose the donor and the year." };
  const donor = parseDonorKey(parsed.data.donor);
  if (!donor) return { ok: false, error: "Choose the donor." };
  const auth = await authorize(parsedDelivery.data.channel === "email" ? "gift:email" : "gift:write");
  if (!auth.ok) return auth.result;

  const supabase = await createSupabaseServerClient();
  const [{ data: rows, error }, name, org] = await Promise.all([
    supabase.rpc("gift_donor_statement", {
      p_organization: auth.organizationId,
      p_contact: donor.kind === "contact" ? donor.id : null,
      p_crm_organization: donor.kind === "organization" ? donor.id : null,
      p_year: parsed.data.year,
    }),
    donorDisplayName(supabase, donor),
    organizationName(supabase, auth.organizationId),
  ]);
  if (error) return { ok: false, error: dbMessage(error, "Could not read the donor's gifts. Try again.") };
  if (!name) return { ok: false, error: "Donor not found." };
  const letter = renderAnnualStatement({
    language: parsedDelivery.data.language,
    organizationName: org,
    donorName: name,
    issuedOn: todayInToronto(),
    year: parsed.data.year,
    gifts: statementGifts((rows ?? []) as StatementRow[]),
  });
  const result = await issue(
    auth,
    supabase,
    {
      kind: "annual_statement",
      statement_year: parsed.data.year,
      crm_contact_id: donor.kind === "contact" ? donor.id : null,
      crm_organization_id: donor.kind === "organization" ? donor.id : null,
      recipient_name: name.slice(0, 200),
    },
    letter,
    parsedDelivery.data,
  );
  revalidatePath(`${GIFTS}/statement`);
  return result;
}

async function donorDisplayName(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  donor: { kind: "contact" | "organization"; id: string },
): Promise<string | null> {
  if (donor.kind === "contact") {
    const { data } = await supabase.from("crm_contact").select("full_name").eq("id", donor.id).maybeSingle();
    return (data?.full_name as string | undefined) ?? null;
  }
  const { data } = await supabase.from("crm_organization").select("name").eq("id", donor.id).maybeSingle();
  return (data?.name as string | undefined) ?? null;
}

/** Tries the email again for an acknowledgement that was issued but not delivered. */
export async function resendAcknowledgement(ackId: string): Promise<ActionResult> {
  if (!z.string().uuid().safeParse(ackId).success) return { ok: false, error: "Acknowledgement not found." };
  const auth = await authorize("gift:email");
  if (!auth.ok) return auth.result;
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("gift_acknowledgement")
    .select("id, channel, email_status, recipient_email, subject, body_text, gift_id")
    .eq("organization_id", auth.organizationId)
    .eq("id", ackId)
    .maybeSingle();
  if (!data || data.channel !== "email" || !data.recipient_email) {
    return { ok: false, error: "Acknowledgement not found." };
  }
  if (data.email_status === "sent") return { ok: false, error: "This acknowledgement was already sent." };
  const result = await deliverByEmail(supabase, {
    id: data.id as string,
    to: data.recipient_email as string,
    subject: data.subject as string,
    text: data.body_text as string,
  });
  if (data.gift_id) revalidatePath(`${GIFTS}/${data.gift_id as string}`);
  return result;
}

// ---------------------------------------------------------------------------
// Grants
// ---------------------------------------------------------------------------

const grantSchema = z
  .object({
    id: z.string().uuid().optional(),
    funderId: z.string().uuid({ message: "Choose the funder from the CRM." }),
    funderContactId: optionalUuid,
    title: requiredText("Enter the grant's name.", 200),
    funderReference: optionalText(100),
    amount: requiredText("Enter the amount awarded."),
    awardedOn: optionalDate,
    startsOn: optionalDate,
    endsOn: optionalDate,
    fundId: z.string().uuid({ message: "Choose the fund that tracks this grant." }),
    programId: optionalUuid,
    restrictions: optionalText(2000),
    responsibleUserId: optionalUuid,
    status: z.enum(["active", "closed"]).default("active"),
  })
  .refine((g) => !g.startsOn || !g.endsOn || g.startsOn <= g.endsOn, {
    message: "The end date must be on or after the start date.",
    path: ["endsOn"],
  });

export async function saveGrant(input: unknown): Promise<ActionResult> {
  const auth = await authorize();
  if (!auth.ok) return auth.result;
  const parsed = grantSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message };
  const g = parsed.data;
  const amount = parseMoneyToCents(g.amount);
  if (amount === null || amount <= 0) {
    return { ok: false, error: "Enter the amount awarded as dollars and cents, for example 30000.00." };
  }
  const row = {
    funder_crm_organization_id: g.funderId,
    funder_contact_id: g.funderContactId,
    title: g.title,
    funder_reference: g.funderReference,
    amount_awarded_cents: amount,
    awarded_on: g.awardedOn,
    starts_on: g.startsOn,
    ends_on: g.endsOn,
    fund_id: g.fundId,
    program_id: g.programId,
    restrictions: g.restrictions,
    responsible_user_id: g.responsibleUserId,
    status: g.status,
  };
  const supabase = await createSupabaseServerClient();
  const { data, error } = g.id
    ? await supabase
        .from("grant_award")
        .update(row)
        .eq("id", g.id)
        .eq("organization_id", auth.organizationId)
        .select("id")
        .maybeSingle()
    : await supabase
        .from("grant_award")
        .insert({ ...row, organization_id: auth.organizationId })
        .select("id")
        .single();
  if (error || !data) return { ok: false, error: dbMessage(error, "Could not save the grant. Try again.") };
  revalidatePath(GRANTS, "layout");
  return { ok: true, id: data.id as string };
}

const reportSchema = z.object({
  grantId: z.string().uuid({ message: "Grant not found." }),
  title: requiredText("Name the report, for example Interim report.", 200),
  dueOn: isoDate("Enter the date the report is due."),
  notes: optionalText(2000),
});

export async function addGrantReport(input: unknown): Promise<ActionResult> {
  const auth = await authorize();
  if (!auth.ok) return auth.result;
  const parsed = reportSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message };
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("grant_report")
    .insert({
      organization_id: auth.organizationId,
      grant_id: parsed.data.grantId,
      title: parsed.data.title,
      due_on: parsed.data.dueOn,
      notes: parsed.data.notes,
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: dbMessage(error, "Could not add the report. Try again.") };
  revalidatePath(`${GRANTS}/${parsed.data.grantId}`);
  return { ok: true, id: data.id as string };
}

const submittedSchema = z.object({
  reportId: z.string().uuid({ message: "Report not found." }),
  submittedOn: optionalDate,
});

export async function setGrantReportSubmitted(input: unknown): Promise<ActionResult> {
  const auth = await authorize();
  if (!auth.ok) return auth.result;
  const parsed = submittedSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message };
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("grant_report")
    .update({ submitted_on: parsed.data.submittedOn })
    .eq("id", parsed.data.reportId)
    .eq("organization_id", auth.organizationId)
    .select("grant_id")
    .maybeSingle();
  if (error || !data) return { ok: false, error: dbMessage(error, "Could not update the report. Try again.") };
  revalidatePath(`${GRANTS}/${data.grant_id as string}`);
  return { ok: true };
}

export async function deleteGrantReport(reportId: string): Promise<ActionResult> {
  if (!z.string().uuid().safeParse(reportId).success) return { ok: false, error: "Report not found." };
  const auth = await authorize();
  if (!auth.ok) return auth.result;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("grant_report")
    .delete()
    .eq("id", reportId)
    .eq("organization_id", auth.organizationId)
    .select("grant_id")
    .maybeSingle();
  if (error || !data) {
    return { ok: false, error: dbMessage(error, "Only a report not yet submitted can be removed.") };
  }
  revalidatePath(`${GRANTS}/${data.grant_id as string}`);
  return { ok: true };
}
