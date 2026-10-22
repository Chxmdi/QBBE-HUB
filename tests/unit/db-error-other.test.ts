import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type Answer } from "@/lib/objects/testing/fake-db";

const logged: string[] = [];
vi.mock("@/lib/server-log", () => ({ logActionFailure: (action: string) => logged.push(action) }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/rate-limit", () => ({ enforceRateLimit: async () => null }));
const SESSION = {
  userId: "11111111-1111-4111-8111-111111111111",
  organizationId: "22222222-2222-4222-8222-222222222222",
  isStaff: true,
  isAdmin: true,
};
vi.mock("@/lib/auth", () => ({
  requireSession: async () => SESSION,
  authorizeAdminAction: async () => ({ ok: true, session: SESSION }),
}));
let answer: (kind: "rpc" | "table", name: string) => Answer = () => ({ data: null, error: null });
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () =>
    fakeDb({ rpc: (call) => answer("rpc", call.fn), table: (call) => answer("table", call.table) }).db,
}));
vi.mock("@/lib/i18n/server", async () => {
  const { createTranslator } = await import("@/lib/i18n/translate");
  const { formattersFor } = await import("@/lib/i18n/format");
  return {
    getT: async () => createTranslator("fr-CA"),
    getLocale: async () => "fr-CA",
    getFormatters: async () => formattersFor("fr-CA"),
  };
});

const { dbErrorMessage } = await import("@/lib/db-error");
const { APPROVAL_DB_ERRORS } = await import("@/features/approvals/db-error-rules");
const { FORM_DB_ERRORS } = await import("@/features/forms/db-error-rules");
const { RETENTION_DB_ERRORS } = await import("@/features/retention/db-error-rules");
const { RECORD_DB_ERRORS } = await import("@/features/record-retention/db-error-rules");
const { createTranslator } = await import("@/lib/i18n/translate");
const approvals = await import("@/features/approvals/services/approval.commands");
const forms = await import("@/features/forms/services/form.commands");
const retention = await import("@/features/retention/services/retention.commands");
const records = await import("@/features/record-retention/services/record-retention.commands");

/**
 * Approval, form, retention and legal-hold actions show a database refusal in
 * the reader's language and never show database text that was not written for
 * people. Every sentence the mapper knows is listed with an example.
 */
const SENTENCES: Record<string, string[]> = {
  "finance.approvals.dbErrors.commentLength": ["A comment needs between 1 and 2000 characters"],
  "finance.approvals.dbErrors.delegationWindow": ["A delegation starts between today and one year from today and lasts at most a year"],
  "finance.approvals.dbErrors.rejectionReason": ["A rejection needs a reason"],
  "finance.approvals.dbErrors.delegateSelf": ["Choose someone other than the approver as the delegate"],
  "finance.approvals.dbErrors.staffSubmit": ["Only staff can submit items for approval"],
  "finance.approvals.dbErrors.endDelegation": ["Only the approver, or an owner or administrator with MFA, can end a delegation"],
  "finance.approvals.dbErrors.setDelegation": ["Only the approver, or an owner or administrator with MFA, can set a delegate"],
  "finance.approvals.dbErrors.requesterWithdraw": ["Only the requester can withdraw a request"],
  "finance.approvals.dbErrors.programOrg": ["Program is not in this organization"],
  "finance.approvals.dbErrors.notAvailable": ["That approval is not available to you"],
  "finance.approvals.dbErrors.alreadySettled": ["That approval was already settled", "This approval request has already been decided."],
  "finance.approvals.dbErrors.bothActive": ["The approver and the delegate must both be active staff members or administrators"],
  "finance.approvals.dbErrors.approverCovering": ["The approver is covering for someone else for some of those dates; delegations cannot be passed on"],
  "finance.approvals.dbErrors.approverActive": ["The approver must be an active staff member or administrator"],
  "finance.approvals.dbErrors.delegateAway": ["The delegate is away themselves for some of those dates; delegations cannot be passed on"],
  "finance.approvals.dbErrors.lastDay": ["The last day must be on or after the first day"],
  "finance.approvals.dbErrors.noteTooLong": ["The note is too long"],
  "finance.approvals.dbErrors.alreadyDelegated": ["This approver already has a delegate for some of those dates"],
  "finance.approvals.dbErrors.notApprover": ["You are not an approver for this step"],
  "finance.approvals.dbErrors.ownRequest": ["You cannot approve or reject your own request", "Nobody approves their own request."],
  "finance.approvals.dbErrors.draftedBill": ["You drafted this bill, so someone else approves or rejects it"],
  "forms.dbErrors.publishedLocked": ["A published form cannot be changed; make a new one"],
  "forms.dbErrors.noBackToDraft": ["A published form cannot go back to draft"],
  "forms.dbErrors.addField": ["Add at least one field before publishing"],
  "forms.dbErrors.publishFirst": ["Publish a draft before closing it"],
  "forms.dbErrors.unknownField": ["An answer does not match any field on this form"],
  "forms.dbErrors.answerDate": ["Answer for Date of birth must be a date"],
  "forms.dbErrors.answerNumber": ["Answer for Age must be a number"],
  "forms.dbErrors.answerAmount": ["Answer for Donation must be an amount in whole cents"],
  "forms.dbErrors.answerFile": ["Answer for Receipt must be an uploaded file"],
  "forms.dbErrors.answerOption": ["Answer for Region must be one of its options"],
  "forms.dbErrors.answerText": ["Answer for Comments must be text of up to 5,000 characters"],
  "forms.dbErrors.answerTick": ["Answer for Consent must be ticked or not"],
  "forms.dbErrors.answerRequired": ["Answer required: Full name"],
  "forms.dbErrors.formNotFound": ["Form not found"],
  "forms.dbErrors.notOpen": ["This form is not open for submissions"],
  "forms.dbErrors.notOpenToYou": ["This form is not open to you"],
  "forms.dbErrors.mustSign": ["This form must be signed: type your name and tick the consent box"],
  "forms.dbErrors.fileAttached": ["That file is already attached to a submission"],
  "forms.dbErrors.signIn": ["Sign in to submit a form"],
  "retention.dbErrors.actionNotAllowed": ["Audit log cannot be set to \"delete\" — allowed here: anonymize."],
  "retention.dbErrors.tooShort": ["Retention for Audit log cannot be shorter than 2555 days."],
  "retention.dbErrors.unknownSubject": ["There is no retention subject called \"nope\"."],
  "records.dbErrors.permanent": ["Board minutes are kept permanently; they have no retention period to set."],
  "records.dbErrors.minYears": ["Payroll records must be kept for at least 6 years."],
  "records.dbErrors.enterYears": ["Enter how many years payroll records are kept."],
  "records.dbErrors.unknownCategory": ["There is no record category called \"nope\"."],
  "records.dbErrors.holdNoEdit": ["A hold cannot be edited, only released."],
  "records.dbErrors.holdOrder": ["A hold is placed first and released later."],
  "records.dbErrors.releaseReason": ["Say why the hold is being released."],
  "records.dbErrors.recordMissing": ["That record does not exist in this organization."],
  "records.dbErrors.holdReleased": ["This hold has already been released."],
  "records.dbErrors.shortensForever": ["This change would shorten how long the record must be kept (until permanently)."],
  "records.dbErrors.shortens": ["This change would shorten how long the record must be kept (until 2032-12-31)."],
  "records.dbErrors.underHold": ["This record is under legal hold and cannot be reclassified."],
};
const RULES = [...APPROVAL_DB_ERRORS, ...FORM_DB_ERRORS, ...RETENTION_DB_ERRORS, ...RECORD_DB_ERRORS];

const en = createTranslator("en");
const fr = createTranslator("fr-CA");
const ID = "33333333-3333-4333-8333-333333333333";
const refusal = (message: string, code = "P0001"): Answer => ({ data: null, error: { code, message } });

beforeEach(() => {
  logged.length = 0;
  answer = () => ({ data: null, error: null });
});

describe("approval, form and retention refusals", () => {
  it("list a sentence for every rule", () => {
    expect(Object.keys(SENTENCES).sort()).toEqual(RULES.map((rule) => rule.key).sort());
  });

  it.each(Object.entries(SENTENCES))("map %s to French", (_key, sentences) => {
    for (const sentence of sentences) {
      const options = { action: "test", rules: RULES };
      const french = dbErrorMessage(fr, { message: sentence }, "fallback", options);
      expect(french).not.toBe("fallback");
      expect(french).not.toBe(dbErrorMessage(en, { message: sentence }, "fallback", options));
      expect(french).not.toMatch(/\{\w+\}/);
    }
    expect(logged).toEqual([]);
  });

  it("do not show the English labels the database puts in a retention sentence", () => {
    const options = { action: "test", rules: RULES };
    expect(dbErrorMessage(fr, { message: "Payroll records must be kept for at least 6 years." }, "x", options)).toBe(
      "Ces documents doivent être conservés au moins 6 ans.",
    );
  });
});

describe("the actions, in French", () => {
  it("explain a refused delegation, and hide a permission error", async () => {
    const input = { delegateId: ID, startsOn: "2026-11-02", endsOn: "2026-11-06" };
    answer = () => refusal("The delegate is away themselves for some of those dates; delegations cannot be passed on", "23514");
    expect(await approvals.setApprovalDelegation(input)).toEqual({
      ok: false,
      error: "Le délégué est lui-même absent à certaines de ces dates; une délégation ne peut pas être transmise.",
    });
    answer = () => refusal("Only the approver, or an owner or administrator with MFA, can set a delegate", "42501");
    expect((await approvals.setApprovalDelegation(input)).error).toMatch(/^Seul l’approbateur/);
    answer = () => refusal("permission denied for function set_approval_delegation", "42501");
    const hidden = await approvals.setApprovalDelegation(input);
    expect(hidden.ok).toBe(false);
    expect(hidden.error).toBe(fr("finance.approvals.away.errors.setFailed"));
    answer = () => refusal('new row for relation "approval_delegation" violates check constraint "x"', "23514");
    expect((await approvals.setApprovalDelegation(input)).error).toBe(fr("finance.approvals.away.errors.checkPeopleDates"));
  });

  it("explain a refused decision, including the finance bill rules", async () => {
    answer = () => refusal("You drafted this bill, so someone else approves or rejects it", "42501");
    expect(await approvals.decideApproval({ itemId: ID, decision: "approve" })).toMatchObject({
      ok: false,
      error: "Vous avez rédigé cette facture fournisseur; une autre personne doit donc l’approuver ou la refuser.",
    });
    answer = () => refusal('new row violates row-level security policy for table "approval_request"', "42501");
    const hidden = await approvals.decideApproval({ itemId: ID, decision: "approve" });
    expect(hidden.ok).toBe(false);
    expect(hidden.error).not.toMatch(/row-level|approval_request/);
  });

  it("explain a form the database will not change or accept", async () => {
    answer = (kind) => (kind === "table" ? refusal("Publish a draft before closing it", "23514") : refusal("x"));
    expect(await forms.setFormStatus(ID, "closed")).toEqual({
      ok: false,
      error: "Publiez un brouillon avant de le fermer.",
    });
    answer = (kind) =>
      kind === "table"
        ? { data: { id: ID, status: "published", fields: [], requires_signature: false }, error: null }
        : refusal("Answer required: Full name", "23514");
    expect(await forms.submitForm({ formId: ID, answers: {} })).toEqual({ ok: false, error: "Réponse obligatoire : Full name." });
    answer = (kind) =>
      kind === "table"
        ? { data: { id: ID, status: "published", fields: [], requires_signature: false }, error: null }
        : refusal('new row for relation "form_submission" violates check constraint "x"', "23514");
    expect(await forms.submitForm({ formId: ID, answers: {} })).toEqual({ ok: false, error: fr("forms.errors.submitFailed") });
  });

  it("explain a refused legal hold or reclassification, and hide raw database text", async () => {
    answer = () => refusal("This record is under legal hold and cannot be reclassified.", "23514");
    expect(await records.classifyDocument({ documentId: ID, categoryKey: "finance" })).toEqual({
      ok: false,
      error: "Ce document fait l’objet d’une suspension pour motif juridique et ne peut pas être reclassé.",
    });
    answer = () => refusal("This hold has already been released.", "23514");
    expect(await records.releaseLegalHold({ holdId: ID, reason: "Audit closed" })).toEqual({
      ok: false,
      error: "Cette suspension a déjà été levée.",
    });
    answer = () => refusal('insert or update on table "legal_hold" violates foreign key constraint "x"', "23503");
    const hidden = await records.placeLegalHold({ scope: "record", recordId: ID, reason: "Audit opened" });
    expect(hidden.ok).toBe(false);
    expect(hidden.error).not.toMatch(/legal_hold|constraint/);
    expect(logged.length).toBeGreaterThan(0);
  });

  it("explain a refused retention rule without its English label", async () => {
    answer = (kind, name) =>
      name === "record_retention_rule" && kind === "table"
        ? refusal("Payroll records must be kept for at least 6 years.", "23514")
        : { data: null, error: null };
    const result = await records.saveRetentionRule({ categoryKey: "payroll", retainYears: 3, confirmed: false });
    expect(result.ok).toBe(false);
    expect(result.error).not.toMatch(/Payroll records/);
  });
});

describe("retention and records actions", () => {
  it.each([
    "src/features/retention/services/retention.commands.ts",
    "src/features/record-retention/services/record-retention.commands.ts",
    "src/features/approvals/services/approval.commands.ts",
    "src/features/forms/services/form.commands.ts",
  ])("%s returns no database text to people", (file) => {
    expect(readFileSync(file, "utf8")).not.toMatch(/error: error\??\.message|\? error\.message|error\.message \?\?|return error\.message/);
  });

  it("never let a save look successful when the database refused it", async () => {
    answer = (kind, name) =>
      name === "retention_subject"
        ? { data: { key: "audit", label: "Audit log", description: "", minimum_days: 30, default_days: 365, allowed_actions: ["delete"], caution: null }, error: null }
        : refusal("Retention for Audit log cannot be shorter than 2555 days.", "23514");
    const result = await retention.saveRetentionPolicy({ subjectKey: "audit", retainDays: 400, action: "delete", enabled: true });
    expect(result).toEqual({ ok: false, error: "Ce type de dossier doit être conservé au moins 2555 jours." });
  });
});
