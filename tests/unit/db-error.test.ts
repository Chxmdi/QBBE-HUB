import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const logged: { action: string; error: unknown }[] = [];
vi.mock("@/lib/server-log", () => ({
  logActionFailure: (action: string, error: unknown) => logged.push({ action, error }),
}));

const { dbErrorMessage, knownDbErrorMessage } = await import("@/lib/db-error");
const { FINANCE_DB_ERRORS } = await import("@/features/finance/db-error-rules");
const { createTranslator } = await import("@/lib/i18n/translate");
const { dbErrorsEn } = await import("@/lib/i18n/messages/finance/db-errors.en");
const { dbErrorsFrCA } = await import("@/lib/i18n/messages/finance/db-errors.fr-CA");

/**
 * Finance actions show a database refusal in the reader's language, and never
 * show database text that was not written for people (row-level security,
 * permission errors, constraint names, anything unknown).
 *
 * Every sentence the finance tables and functions raise that the mapper knows
 * is listed here, as the database words it with example values, under the key
 * it must map to. A change to a sentence in a migration fails this test until
 * the rule follows it.
 */
const SENTENCES: Record<string, string[]> = {
  accountKeepsCode: ["An account with entries keeps its code and type"],
  accountMissing: ["Account bill is missing from the chart of accounts"],
  accountantEnd: ["Access ends on a date between today and one year from today"],
  accountantGuest: ["Invite the accountant as a Guest first; only an active Guest can be given accountant access"],
  ackDonor: ["The acknowledgement must go to the gift's donor"],
  ackLocked: ["An issued acknowledgement cannot be changed; issue a new one"],
  ackVoided: ["A voided gift is not acknowledged"],
  addActiveAccount: ["Add an active account bill in the chart of accounts for bill"],
  adminMfa: ["Only an administrator with MFA allocates payroll", "Only an administrator with MFA changes the approval threshold", "Only an administrator with MFA closes the year", "Only an administrator with MFA deletes payroll drafts", "Only an administrator with MFA grants accountant access", "Only an administrator with MFA imports payroll", "Only an administrator with MFA keeps the books", "Only an administrator with MFA keeps the tax records", "Only an administrator with MFA manages budgets", "Only an administrator with MFA maps payroll accounts", "Only an administrator with MFA posts bills", "Only an administrator with MFA posts invoices", "Only an administrator with MFA posts payroll", "Only an administrator with MFA records gifts", "Only an administrator with MFA records payments", "Only an administrator with MFA reopens the year", "Only an administrator with MFA reverses payments", "Only an administrator with MFA reverses payroll", "Only an administrator with MFA revokes accountant access", "Only an administrator with MFA voids bills and invoices", "Only an administrator with MFA voids gifts"],
  allocateRun: ["Allocate the run to at least one fund"],
  alreadyPosted: ["This entry is already posted"],
  alreadyReversed: ["This entry has already been reversed"],
  alreadyVoid: ["This bill is already void"],
  approvalDate: ["Approval date is required and cannot be in the future"],
  approverName: ["Name the accountant who approved the chart"],
  bankAccountLocked: ["The cash account and start date cannot change once a reconciliation exists"],
  bankAssetAccount: ["A bank account is tied to an active asset account of the ledger"],
  bankInactive: ["This bank account is inactive"],
  billApproved: ["This bill is already approved"],
  billLinesFirst: ["Add the bill's lines before asking for approval"],
  billNeedsApproval: ["This bill needs an approval for its total before it can be posted"],
  billPosted: ["This bill is already posted"],
  billWaiting: ["This bill is already waiting for approval"],
  budgetAccount: ["Budget a revenue or expense account of this organization"],
  budgetDraftOnly: ["Only a draft budget can be approved"],
  budgetExists: ["This fiscal year already has a budget; open it and revise it instead"],
  budgetLineExists: ["This budget already has a line for that account, fund, program and project"],
  budgetLinesFirst: ["Add at least one line before approving the budget"],
  budgetLocked: ["A superseded budget cannot change", "An approved budget is locked; revise it to make changes"],
  budgetMonth: ["Choose a month inside the budget's fiscal year"],
  budgetMonths: ["Give an amount for each of the twelve months"],
  budgetName: ["Name the budget"],
  budgetNegative: ["Budget amounts cannot be negative"],
  budgetNotDeleted: ["An approved budget cannot be deleted; revise it instead"],
  budgetRevise: ["Only the approved budget can be revised"],
  budgetRevisionInProgress: ["A revision of this budget is already in progress"],
  chartNotApproved: ["Record the accountant's approval of the chart of accounts before posting"],
  chooseBankAccount: ["Choose the bank account"],
  chooseCustomer: ["Choose a customer of this organization"],
  chooseDateRange: ["Choose a date range"],
  chooseDocumentFund: ["Choose the fund this bill is charged to", "Choose the fund this invoice belongs to"],
  chooseDonor: ["Choose one donor", "Choose one donor from the CRM"],
  chooseLineAccount: ["Choose an account for every line"],
  chooseMonth: ["Choose a month"],
  choosePaymentMethod: ["Choose how it was paid"],
  chooseTaxCode: ["Choose a tax code"],
  chooseVendor: ["Choose a vendor of this organization"],
  chooseYear: ["Choose a year"],
  claimShare: ["The claimable share must be between 0 % and 100 %"],
  claimTooHigh: ["The amount claimed back cannot exceed the tax paid"],
  closeEarlierFirst: ["Close the earlier periods first"],
  closingEntryManual: ["Closing entries are made by closing the fiscal year"],
  closingEntryReverse: ["A closing entry is undone only by reopening the fiscal year"],
  closingFund: ["Choose the fund the closing entry is recorded in"],
  closingTooLarge: ["The closing entry would need bill lines; the limit is 500"],
  contactStaysCustomer: ["This contact has invoices and stays a customer"],
  contactStaysVendor: ["This contact has bills and stays a vendor"],
  createMissingMonths: ["The periods of this fiscal year do not cover it; create the missing months first"],
  differenceNotZero: ["The difference is not zero (bill cents)"],
  documentNeedsLine: ["A bill needs at least one line with an amount", "An invoice needs at least one line with an amount"],
  draftClosedPeriod: ["The draft is in a closed period"],
  draftNotVoided: ["A draft is deleted, not voided"],
  drafterOnly: ["Only the person who drafted it or an administrator can delete it", "Only the person who drafted it or an administrator sends a bill for approval", "Only the person who drafted this bill or an administrator can change it", "Only the person who drafted this invoice or an administrator can change it"],
  draftsBeforePeriodClose: ["Post or delete the drafts in bill before closing it"],
  draftsBeforeYearClose: ["Post or delete the drafts dated up to bill before closing the year"],
  entryTooSmall: ["A posted entry needs at least two lines and a non-zero amount"],
  filingFrequency: ["Filing frequency must be monthly, quarterly or annual"],
  financeAdminReview: ["Only finance administrators review receipts"],
  fundKeepsCode: ["A fund with entries keeps its code and restriction"],
  funderNotInCrm: ["The funder is not in this organization's CRM", "The funder contact is not in this organization's CRM"],
  giftAccounts: ["Choose the accounts to post the gift to"],
  giftAmount: ["Enter an amount above zero", "Enter the amount received"],
  giftCredit: ["The gift is credited to a revenue or deferred contributions account"],
  giftDate: ["The date received is required and cannot be in the future"],
  giftDebit: ["The gift is debited to an asset (bank) or, for goods used at once, an expense account"],
  giftFund: ["Choose the fund the gift belongs to"],
  giftKind: ["Choose the kind of gift"],
  giftLocked: ["A recorded gift cannot be changed; void it and record it again"],
  giftNotDeleted: ["A gift cannot be deleted; void it instead"],
  giftVoidReason: ["Give the reason for voiding the gift"],
  giftVoided: ["A voided gift cannot change", "This gift is already voided"],
  grantOnlyPayment: ["Only a grant payment names a grant"],
  grantPayment: ["A grant payment comes from the grant's funder", "A grant payment goes to the grant's fund"],
  gstTooHigh: ["GST on this invoice can be at most bill (on bill before tax)"],
  inKindNotPosted: ["An in-kind gift without a value is not posted to the ledger"],
  inKindValue: ["An in-kind gift carries a dollar value only when the donor supplied one"],
  invoicePosted: ["This invoice is already posted"],
  lastPeriodClosed: ["The last period of the year is closed; reopen it so the closing entry can be dated bill"],
  ledgerLineMatched: ["That ledger line is already matched to another statement line"],
  lineAccountInactive: ["Line 3: account 3 is inactive"],
  lineFundDates: ["Line 3: restricted fund 3 cannot be spent on 3"],
  lineFundInactive: ["Line 3: fund 3 is inactive"],
  lineInReconciled: ["Line dated bill is in a reconciled statement"],
  lineRestrictedPrograms: ["Line 3: restricted fund 3 can only be spent on its programs"],
  lineScope: ["Line 3: program or project is not in this organization or program"],
  linesNotMatched: ["bill statement line(s) are not matched to the ledger"],
  mapCategory: ["Map bill to an account before posting", "Map Gross wages to an account before posting"],
  mappingTooLong: ["The mapping is a list of at most 15 categories"],
  matchRule: ["A statement line matches a posted ledger line on the same cash account for the same amount"],
  mustBeActiveAccount: ["The bill must be an active bill account", "The bank account must be an active asset account"],
  netAssetsMissing: ["Net assets account bill is missing; add it to the chart of accounts"],
  noAccessBudgets: ["You do not have access to budgets"],
  noAccessDonors: ["You do not have access to donor records"],
  noAccessLedger: ["You do not have access to the ledger"],
  noAccessPayroll: ["You do not have access to payroll"],
  noGstRate: ["No GST rate applies on 2026-01-01"],
  noPeriod: ["No fiscal period covers bill"],
  noQstRate: ["No QST rate applies on 2026-01-01"],
  notFound: ["Bank account not found", "Bill not found", "Budget line not found", "Captured bill not found", "Donor not found", "Donor not found in the CRM", "Entry not found", "Fund not found", "Gift not found", "Grant not found", "Invoice not found", "Pay run not found", "Reconciliation not found", "Statement line not found", "Tax line not found"],
  notInOrganization: ["A program is not in this organization", "An account is not in this organization", "Program is not in this organization", "Project is not in this organization or program", "The fund is not in this organization", "The program is not in this organization", "The project is not in this organization or program"],
  notManager: ["You do not manage this program"],
  notRegisteredGst: ["This organization is not registered for GST; remove the GST or record the registration under GST and QST"],
  notRegisteredQst: ["This organization is not registered for QST; remove the QST or record the registration under GST and QST"],
  notRegisteredTax: ["The organization is not registered to collect that tax"],
  onlyDraftForApproval: ["Only a draft bill is sent for approval"],
  onlyPostedPaid: ["Only a posted bill can be paid"],
  onlyPostedPayRunReversed: ["Only a posted pay run can be reversed", "Only a posted pay run can be reversed; delete a draft instead"],
  onlyPostedReversed: ["Only a posted entry can be reversed; delete a draft instead"],
  openingBalance: ["The opening balance must equal the previous statement's closing balance"],
  otherThanCash: ["Choose an account other than the bank's own cash account"],
  overpaymentBill: ["The payment is more than the bill still owing (bill cents)"],
  overpaymentInvoice: ["The payment is more than the invoice still owing (1200 cents)"],
  paidInFull: ["This bill is already paid in full"],
  payRunDates: ["Each pay run needs a pay date and a period"],
  payRunDoesNotAddUp: ["The pay run of bill does not add up: gross wages less employee deductions must equal net pay, and no amount may be negative"],
  payRunFileSize: ["A file holds between 1 and 100 pay runs"],
  payRunImported: ["An imported pay run keeps its figures; delete the draft and import again"],
  payRunLocked: ["A posted pay run is locked; reverse it to correct it", "A posted pay run's allocation cannot change", "A reversed pay run cannot change"],
  payRunPeriod: ["The pay run of bill: the period ends before it starts"],
  payRunPosted: ["This pay run is already posted"],
  paymentDate: ["A payment is dated on or after the bill date"],
  paymentLocked: ["A payment cannot be changed; reverse it instead", "A payment cannot be deleted; reverse it instead"],
  paymentReversalDate: ["A reversal is dated on or after the payment"],
  paymentReversed: ["This payment has already been reversed"],
  payrollCategory: ["Unknown payroll category"],
  payrollCreditKind: ["bill: credit a bill account", "Net pay: credit a liability or asset account"],
  payrollDebitExpense: ["bill: debit an expense account"],
  payrollNeverCredited: ["bill is never credited; leave its credit account empty", "EI (employer) is never credited; leave its credit account empty"],
  payrollNeverDebited: ["bill is never debited; leave its debit account empty"],
  payrollProvider: ["Choose the payroll provider"],
  periodClosed: ["Period bill is closed"],
  periodDatesFixed: ["A period's dates cannot change"],
  periodHasEntries: ["A period that holds entries cannot be deleted"],
  periodInClosedYear: ["Period 2025-12 belongs to a closed fiscal year; reopen the year instead"],
  periodStraddles: ["A period straddles the start or end of this fiscal year"],
  periodsOverlap: ["Fiscal periods cannot overlap"],
  postedDocumentNotDeleted: ["A posted document cannot be deleted; void it instead"],
  postedKeepsFigures: ["A posted bill keeps its figures; void it instead", "A posted document keeps its figures; void it instead", "A posted invoice keeps its figures; void it instead", "Lines of a posted bill cannot change", "Lines of a posted invoice cannot change"],
  postedNotChanged: ["A posted journal entry cannot be changed; reverse it instead", "Lines of a posted journal entry cannot change"],
  postedNotDeleted: ["A posted journal entry cannot be deleted; reverse it instead"],
  postedPayRunNotDeleted: ["A posted pay run cannot be deleted; reverse it instead"],
  purchaseOnly: ["Only a purchase has tax to claim back"],
  qstTooHigh: ["QST on this invoice can be at most bill (on bill before tax)"],
  reconcileEarlier: ["Reconcile the statement ending bill first"],
  reconcileFrom: ["Choose the first day to reconcile"],
  reconciledLocked: ["A reconciled statement cannot be changed; reopen it first", "A reconciled statement cannot be deleted"],
  registrantOnly: ["Only a registrant can claim tax back"],
  releaseAccounts: ["Releases need accounts 3000, bill, 1900 (asset) and 2900 (liability) in the chart of accounts"],
  releaseAmount: ["The amount to release must be more than zero"],
  releaseCondition: ["Name the condition that was met (up to 300 characters)"],
  releaseDate: ["Choose the date of the release"],
  releasePeriodClosed: ["Period bill is closed; a release cannot be dated in it"],
  releaseTargetRestricted: ["Released money goes to an unrestricted fund; bill is restricted"],
  releaseUnavailable: ["Fund bill has only bill available to release on bill"],
  releaseUnrestricted: ["Fund bill is unrestricted; only restricted money is released"],
  reopenLaterStatements: ["Reopen the later reconciled statements first"],
  reopenLaterYear: ["Reopen the later fiscal year first"],
  reopenReason: ["Give the reason for reopening the year (up to 500 characters)"],
  responsiblePerson: ["The responsible person must be active staff of this organization"],
  reversalDate: ["A reversal is dated on or after the entry it reverses"],
  reversalOfReversal: ["A reversing entry cannot itself be reversed; post a new entry"],
  reversePaymentsFirst: ["Reverse the payments on this bill before voiding it"],
  shareAmount: ["An amount share is a whole number of cents above zero"],
  shareFund: ["Choose a fund of this organization for every share"],
  shareKind: ["Give every share as a percentage, or every share as an amount"],
  shareOnce: ["Each fund and program appears once in a run's allocation"],
  sharePercent: ["A percentage has at most two decimals and is above zero"],
  shareTooSmall: ["Allocation share bill is too small to split this run; merge it with another share"],
  sharesPercent: ["The shares add up to 90.00%, not 100%"],
  sharesTotal: ["The shares add up to bill cents; they must add up to the run's gross wages, bill cents"],
  staffOnly: ["Only active staff of this organization can read the ledger", "Only staff can draft bills", "Only staff can draft bills and invoices", "Only staff can draft invoices", "You are not on the staff of this organization"],
  standardRatedOnly: ["Only a standard-rated line carries GST or QST"],
  statementBalances: ["Enter the statement's opening and closing balances"],
  statementBeforeStart: ["The statement starts before the account's reconciliation start date"],
  statementDates: ["The statement ends on or after the day it starts"],
  statementDoesNotAddUp: ["The statement lines do not add up to the opening and closing balances"],
  statementLineMatched: ["This statement line is already matched"],
  statementLineNotMatched: ["This statement line is not matched"],
  statementLocked: ["A statement's account and dates cannot change; delete it and start again"],
  statementTooLong: ["A statement file holds at most 5000 lines"],
  statementsOverlap: ["Statements of one account cannot overlap"],
  taxLineAmount: ["A tax line needs a date and an amount of zero or more"],
  taxLineKind: ["A tax line is a sale or a purchase"],
  taxPeriodClosed: ["The tax period bill is closed; reopen it to change its lines"],
  taxPeriodClosedAlready: ["This tax period is already closed"],
  taxPeriodDates: ["A tax period needs a start date on or before its end date"],
  taxPeriodDatesFixed: ["A tax period's dates cannot change"],
  taxPeriodLength: ["A tax period is at most one year"],
  taxPeriodNotDeleted: ["A closed tax period cannot be deleted"],
  taxPeriodOpenAlready: ["This tax period is already open"],
  taxPeriodsOverlap: ["Tax periods cannot overlap"],
  thresholdNegative: ["The threshold cannot be negative"],
  tooManyLines: ["Lines must be a list of at most 200", "Lines must be a list of at most 500"],
  tooManyShares: ["Split a run into at most 20 shares"],
  unbalanced: ["Journal entry does not balance: debits bill and credits bill (cents)"],
  unbalancedFund: ["Journal entry does not balance within fund bill"],
  unmatchFirst: ["Unmatch and match again instead"],
  unmatchImportFirst: ["Unmatch this import's lines before deleting it"],
  voidDate: ["A void is dated on or after the bill date"],
  voidDocumentLocked: ["A void document cannot change"],
  voidReason: ["Say why it is being voided"],
  yearAlreadyClosed: ["The fiscal year bill is already closed"],
  yearNotClosed: ["This fiscal year is not closed"],
  yearStartsFirstDay: ["A fiscal year starts on the first day of a month"],
};

const en = createTranslator("en");
const fr = createTranslator("fr-CA");
const FALLBACK = "fallback";
const map = (t: typeof en, message: string, code = "P0001") =>
  dbErrorMessage(t, { code, message }, FALLBACK, { action: "test", rules: FINANCE_DB_ERRORS });

beforeEach(() => {
  logged.length = 0;
});

describe("finance database refusals", () => {
  it("list a sentence for every rule, and a rule for every listed sentence", () => {
    const keys = FINANCE_DB_ERRORS.map((rule) => rule.key.replace("finance.dbErrors.", ""));
    expect(new Set(keys).size).toBe(keys.length);
    expect(Object.keys(SENTENCES).sort()).toEqual([...keys].sort());
    expect(Object.keys(dbErrorsEn).sort()).toEqual([...keys].sort());
  });

  it.each(Object.entries(SENTENCES))("map %s to French, with the values it carries", (key, sentences) => {
    for (const sentence of sentences) {
      const english = map(en, sentence);
      const french = map(fr, sentence);
      expect(english).not.toBe(FALLBACK);
      expect(french).toBe(map(fr, sentence));
      expect(french).not.toBe(english);
      expect(french).not.toMatch(/\{\w+\}/);
      expect(knownDbErrorMessage(fr, { message: sentence }, FINANCE_DB_ERRORS)).toBe(french);
      expect(dbErrorsFrCA[key as keyof typeof dbErrorsFrCA]).toBeTruthy();
    }
    expect(logged).toEqual([]);
  });

  it("show the close-year MFA refusal, period order, reversal and posted-entry rules in French", () => {
    expect(map(fr, "Only an administrator with MFA closes the year", "42501")).toBe(
      "Seul un administrateur ayant terminé l’authentification multifacteur peut effectuer cette action.",
    );
    expect(map(fr, "Close the earlier periods first", "23514")).toBe("Fermez d’abord les périodes précédentes.");
    expect(map(fr, "Only a posted entry can be reversed; delete a draft instead", "22023")).toBe(
      "Seule une écriture comptabilisée peut être contrepassée; supprimez plutôt le brouillon.",
    );
    expect(map(fr, "A posted journal entry cannot be deleted; reverse it instead", "42501")).toBe(
      "Une écriture de journal comptabilisée ne peut pas être supprimée; contrepassez-la plutôt.",
    );
  });

  it("keep the values a sentence carries", () => {
    expect(map(en, "Fund RESTR has only 500.00 available to release on 2026-03-31", "22023")).toBe(
      "Fund RESTR has only 500.00 available to release on 2026-03-31.",
    );
    expect(map(fr, "Line 2: account 5100 is inactive", "22023")).toBe("Ligne 2 : le compte 5100 est inactif.");
  });

  it("translate the values the database writes in English", () => {
    expect(map(fr, "Map Gross wages to an account before posting", "22023")).toBe(
      "Associez Salaires bruts à un compte avant de comptabiliser.",
    );
    expect(map(fr, "Net pay: credit a liability or asset account", "22023")).toBe(
      "Salaire net : portez au crédit un compte de type passif / actif.",
    );
    expect(map(fr, "The bank account must be an active asset account", "22023")).toBe(
      "Choisissez un compte actif de type actif.",
    );
    expect(map(fr, "Line 2: restricted fund F1 cannot be spent on 2026-03-15", "23514")).toBe(
      "Ligne 2 : le fonds affecté F1 ne peut pas être dépensé le 2026-03-15, hors de ses dates.",
    );
  });

  it("anchor every rule to the whole sentence, alternatives included", () => {
    for (const rule of FINANCE_DB_ERRORS) expect(rule.pattern.source).toMatch(/^\^\(\?:[\s\S]*\)\$$/);
    expect(map(en, "A posted journal entry cannot be changed; reverse it instead and more")).toBe(FALLBACK);
    expect(map(en, "Oops: Lines of a posted journal entry cannot change")).toBe(FALLBACK);
  });

  it("never show row-level security or permission text, and log it", () => {
    for (const message of [
      'new row violates row-level security policy for table "journal_entry"',
      "permission denied for table journal_entry",
      "permission denied for function ledger_post",
    ]) {
      expect(map(fr, message, "42501")).toBe(FALLBACK);
    }
    expect(logged).toHaveLength(3);
  });

  it("turn unknown database text into the fallback, and log it", () => {
    expect(map(fr, 'duplicate key value violates unique constraint "uq_x"', "23505")).toBe(FALLBACK);
    expect(map(fr, "A gift keeps its ledger entry", "42501")).toBe(FALLBACK);
    expect(map(fr, "Fermez d’abord les périodes précédentes", "P0001")).toBe(FALLBACK);
    expect(logged.map((entry) => entry.action)).toEqual(["test", "test", "test"]);
  });

  it("match a whole sentence only, not one inside other text", () => {
    expect(map(en, "ERROR: Close the earlier periods first")).toBe(FALLBACK);
    expect(map(en, "Close the earlier periods first; and more")).toBe(FALLBACK);
    expect(map(en, "Close the earlier periods first.")).toBe(FALLBACK);
  });

  it("never turn a missing error into anything but the fallback", () => {
    expect(dbErrorMessage(fr, null, FALLBACK, { action: "test", rules: FINANCE_DB_ERRORS })).toBe(FALLBACK);
    expect(knownDbErrorMessage(fr, null, FINANCE_DB_ERRORS)).toBeNull();
  });
});

const FINANCE_FILES = [
  "src/features/ledger/services/ledger.commands.ts",
  "src/features/ledger/services/year-end.commands.ts",
  "src/features/ledger/services/year-end.queries.ts",
  "src/features/payables/services/payables.commands.ts",
  "src/features/payroll/services/payroll.commands.ts",
  "src/features/payroll/services/payroll.queries.ts",
  "src/features/sales-tax/services/sales-tax.commands.ts",
  "src/features/budgets/services/budget.commands.ts",
  "src/features/banking/services/bank.commands.ts",
  "src/features/gifts/services/gift.commands.ts",
];

describe("finance actions", () => {
  it.each(FINANCE_FILES)("%s passes no database text through to people", (file) => {
    const source = readFileSync(file, "utf8");
    expect(source).not.toMatch(/READABLE_CODES/);
    expect(source).not.toMatch(/return error\.message|error: error\??\.message|\? error\.message/);
  });
});
