# Paperless office and bookkeeping: plan and task checklist

Written 2026-09-27 against `main` at `c4c583e` (after PR #160). Covers the
roadmap #157 and the epics #139 (paperless), #140 (bookkeeping) and #141
(French interface).

## What "done" means

- Every receipt, bill, form, contract, consent and approval is captured,
  routed, signed, filed and retained in the app, and can be found (#139).
- QBBE keeps its books in the app: double-entry ledger with funds, payables and
  receivables, bank reconciliation, GST/QST, budgets, year-end support, payroll
  imported from a provider, and gift acknowledgements (#140).
- Everything works in French and English (#141).
- The books go live only after the accountant signs off, following one full
  month-end run in parallel with the current spreadsheets (#157).

**2026-10-01 is the date the books start from, not the day they go live.**
Everything from that date is captured in the app and entered into the ledger,
so nothing is re-keyed from paper later. Staff cannot use any of it until the
app is deployed. See [`launch-readiness-plan.md`](launch-readiness-plan.md).

## Where it stands (checked against `main`)

| Item | Issue | Merged in | State |
|---|---|---|---|
| Receipt capture v1 (upload, manual entry, inbox, CSV) | #142 | #158, #166 | Done |
| Receipt reading on the device (OCR) | #142 v2 | #175 | Done; forwarding-by-email half not built |
| Approvals routing | #143 | #164 | Done; issue still open |
| E-signatures v1 | #144 | #159 | Built; counsel review owed |
| Digital forms | #145 | #159 | Done |
| Retention rules and legal hold | #146 | #163 | Done |
| Document library v1 | #147 | #161 | Built; issue still open |
| Ledger core | #148 | #162 | Done |
| Fund accounting | #149 | #162 | Done; issue still open |
| Payables and receivables | #150 | #169 | Done |
| Bank import and reconciliation | #151 | #167 | Done; bank presets unverified |
| GST/QST | #152 | #168 | Done; accountant to confirm setup |
| Budgets vs actuals | #153 | #170 | Done |
| Year-end, statements, GL export, accountant login | #154 | #171 | Done |
| Payroll import | #155 | PR #177 | In review |
| Gift acknowledgements | #156 | PR #172 | CI re-running (job timeout raised to 60 min) |
| French interface v1 | #141 | #160 | Done; French reviewer owed |

Supporting fixes merged the same day:
- #165: navigation race in browser tests.
- #174: danger-text contrast.
- #176: shared test lists made conflict-free. New features add
  `tests/e2e/routes/<feature>.json` and need no `test-db.mjs` entry.

## Task checklist

### A. Code still in flight
- [ ] Merge #172 gift acknowledgements. Its CI is re-running with the 60-minute
  Database security limit.
- [ ] Review #177 payroll import:
  - RLS: reads through `app.can_read_ledger`, writes only by admin with MFA,
    `search_path = ''` on SECURITY DEFINER functions;
  - no employee names, SINs or per-employee lines stored;
  - duplicate runs refused and every run balanced.

  Then merge it with main, move its role-matrix/qa-matrix lines into
  `tests/e2e/routes/payroll.json`, run the combined tests and merge.
- [ ] Review and merge #173, the contrast test for tinted badges.

### B. Follow-ups found during review
- [ ] Split or shard the Database security CI job. It reached 45 minutes with
  today's features; 60 is a stopgap.
- [ ] Translate the approvals, payables, bank, GST/QST, budgets, year-end and
  gifts screens. v1 translates the sidebar and main screens only.
- [ ] Test receipt reading in Safari/WebKit and Firefox, and on real phone
  photos of real receipts. So far only Chromium and synthetic images.
- [ ] #142 v2 remainder: a forwarding email address for invoices.
- [ ] Close issues whose work has merged: #143, #149 and #141. Confirm #144 and
  #147 against their acceptance criteria before closing.
- [ ] Record in the accountant runbook that a granted accountant can read bank
  statement lines and donor gift records. They read through the same
  `can_read_ledger` rule.

### C. Needed from QBBE (nobody else can supply these)
- [ ] Accountant:
  - balances as at 2026-09-30;
  - the fiscal year-end;
  - GST/QST registration and filing period;
  - whether the public service body rebate applies;
  - the tax-form mapping for the nonprofit returns;
  - the wording of the gift acknowledgement ("not an official receipt").
- [ ] Accountant review of the chart of accounts, fund structure and tax setup,
  before real transactions are entered (target about 2026-10-09).
- [ ] Record retention periods confirmed by the accountant, at least 6 years for
  financial records.
- [ ] Counsel: which documents may be signed electronically under Quebec's legal
  framework for information technology (#144), and French-language
  obligations (#141).
- [ ] A fluent French reviewer for all French wording (#141).
- [ ] One real export per data source, to confirm the import presets:
  - one statement from each bank QBBE uses (Desjardins, National Bank, RBC, TD
    or BMO; #151);
  - one pay-run journal from the payroll provider (#155).
- [ ] The deployment setup, so staff can use the app. See
  [`launch-readiness-plan.md`](launch-readiness-plan.md).

### D. Taking the books live
- [ ] From 2026-10-01: capture every receipt, bill and statement in the app, or
  in the interim Drive folder `Finance 2026-27` until the app is deployed.
- [ ] Enter the opening balances as at 2026-10-01 once the accountant supplies
  them.
- [ ] Enter October transactions from the captured receipts and statements.
- [ ] Parallel run: at the November month-end, compare the ledger with the
  spreadsheets and explain every difference.
- [ ] Accountant signs off. The ledger becomes the official books (about
  mid-December 2026), covering everything since 2026-10-01.

## Decisions made (recorded on the issues)

- **Payroll (#155).** Payroll is imported from the provider's per-run journal,
  with presets for:
  - Nethris (Desjardins);
  - Employeur D;
  - ADP Workforce Now;
  - Ceridian Powerpay;
  - a column mapping for any other provider.

  Only run-level totals and the fund/program split are stored. Payroll itself
  is not calculated in the app.
- **Receipt reading (#142 v2).** Tesseract.js runs in the browser, in English and
  French. There is no external service, and photos never leave the device for
  reading. Its suggestions fill empty fields only, and a person always
  confirms them.
- **Gifts (#156).** Acknowledgements only, never tax receipts, while QBBE is a
  registered nonprofit and not a registered charity.
