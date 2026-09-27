# General ledger: setup and rules (#148, #149)

The ledger lives at **Ledger** in the sidebar (`/finance/ledger`). This page
says what the database enforces, who can do what, and the order to set it up
for the 2026-10-01 switchover.

## Who can do what

| Person | Can |
| --- | --- |
| Owner or admin who completed MFA | Everything: accounts, funds, periods, entries, posting, reversing, CSV exports, naming ledger readers. |
| Staff named as a ledger reader | Read the journal, accounts, funds, periods and reports, and export CSV. Change nothing. |
| Other staff, volunteers, guests | Nothing. Staff see "You do not have access to the ledger". |

Ledger readers are managed on the Ledger overview page. The accountant's own
read-only login arrives with B7; until then, give the accountant CSV exports.

## Rules the database enforces (for everyone, including admins)

- **Balance.** An entry's debits equal its credits, and they also balance
  within each fund. An unbalanced entry cannot be saved, even as a draft.
- **Approval first.** Nothing can be posted until the accountant's approval of
  the chart of accounts is recorded.
- **Periods.** An entry must be dated in an existing, open monthly period. A
  closed period accepts no new entries, draft changes or reversals. A period
  with drafts cannot be closed.
- **Immutability.** A posted entry and its lines cannot be updated or deleted by
  anyone, the table owner and service role included. A mistake is corrected by
  **Reverse entry**, which posts the mirror image on a date you choose; the
  original stays. Each entry can be reversed once.
- **Restricted funds.** An expense charged to a restricted fund must be dated
  inside the fund's dates and, if the fund lists programs, name one of them.
- **Numbering.** Posted entries are numbered 1, 2, 3… in the order they are
  posted, with no gaps. Drafts have no number.
- Every material step (posting, reversing, closing or reopening a period,
  approving the chart, granting or removing read access, CSV exports) writes an
  audit record.

## Setting up for 2026-10-01

1. **Review the chart of accounts with the accountant.** Open Ledger, then
   Accounts. Every organization starts with a Quebec nonprofit starter chart
   (61 accounts, ASNPO-style). Admins can rename, add or deactivate accounts.
   You should see accounts grouped by Asset, Liability, Net assets, Revenue and
   Expense.
2. **Set up funds.** Ledger, then Funds, then **Add fund** for each restricted
   grant: code (for example `MFQ-2026`), restriction, funder, spending dates and
   allowed programs. The `GEN` general fund already exists.
3. **Record the accountant's approval.** On the Ledger overview, fill in the
   accountant's name and the approval date, then **Record approval**. You
   should see "Approved by … on …". If you skip this, posting fails with
   "Record the accountant's approval of the chart of accounts before posting".
4. **Create the fiscal year.** Ledger, then Periods, choose `2026-10` as the
   first month, then **Add fiscal year**. You should see twelve open periods,
   2026-10 to 2027-09. (If the accountant confirms a different fiscal year-end,
   start from that month instead.)
5. **Enter opening balances.** On the overview, **Enter opening balances**.
   The entry is dated 2026-10-01 and holds the accountant's 2026-09-30
   figures: assets as debits, liabilities and net assets as credits, each in
   its fund. **Save and post** stays disabled until debits equal credits.
6. **Check the trial balance.** Ledger, then Trial balance, as at
   2026-10-01. Total debits must equal total credits and match the
   accountant's figures. Use **Export CSV** to send it to them.

## Month end

Post or delete every draft in the month, check the trial balance, then close
the period on the Periods page. Reopening a closed month asks for confirmation
and is audited.

## Giving the external accountant access (#154)

The accountant gets their own login that can read the books and change
nothing. It needs MFA, ends on a date you choose (at most one year), and can
be revoked at any time.

1. **Invite the accountant as a Guest.** Admin, then **Invite user**, enter
   their email and choose the role **Read-only guest**. A Guest sees no relationships,
   finance, receipts or HR-type records. (They can still see what every
   member sees: public channels, announcements and the people directory.)
2. **Wait for them to sign up** with that email. You should see them in
   People with the role Guest.
3. **Grant access.** Ledger, then Year-end, then **Accountant access**.
   Choose them, choose the last day of access, then **Grant access**. You
   should see a row marked **Active**. If you see "Invite the accountant as a
   Guest first", their role is not Guest or they have not signed up yet.
4. **Tell the accountant** to sign in and click **Open the books** on Home.
   The first time, they set up an authenticator app; without it they see
   nothing. After that they land on the Ledger.
5. **Revoke** on the same page when the engagement ends. It takes effect on
   their next page load.

Every accountant sign-in that opens the books, every grant and revocation,
and every export is written to the audit log. The last twenty sign-ins are
listed on the Accountant access page.

## Year-end

1. **Close every month** on the Periods page, except the last month of the
   year (the closing entry is dated its last day). Post or delete every draft
   first.
2. **Review the statements.** Ledger, then Statements, choose the year. You
   should see the statement of financial position and the statement of
   operations by fund class, with the prior year when there is one. **Print**
   gives a paper-style copy; the CSV links give spreadsheets.
3. **Close the year.** Ledger, then Year-end, then **Close year** on that
   year's row. **This posts a closing entry and closes all twelve months.**
   It moves every revenue and expense balance into the fund's net assets
   account: 3000 (unrestricted), 3100 (internally restricted) or 3200
   (externally restricted). If one of those accounts is missing you will see
   "Net assets account … is missing"; add it on the Accounts page and retry.
   Years close in order: an earlier year must be closed first.
4. **Send the year-end package.** The Year-end page lists, for the chosen
   year: both statements (CSV and printable), the trial balance at year end,
   the general ledger for the year and for each month (import CSV: date, entry
   no, account code, account name, fund, program, description, debit,
   credit) and the receipts list. The accountant can download them all
   themselves.
5. **Annual returns.** Ledger, then Returns shows the T2, T1044, CO-17 and
   TP-997.1 with the figures from the books and the T1044 thresholds. It is
   prepared for your accountant, not filed. The accountant decides which
   returns apply and files them.

### Reopening a closed year

Only an admin with MFA can reopen, and only by giving a reason. On the
Year-end page, **Reopen**, enter the reason, then **Reopen and post reopening
entry**. This posts the exact reversal of the closing entry and reopens the
twelve months. Make the corrections, then close the year again. A closed
year's months cannot be reopened one at a time, and the closing entry cannot
be reversed from its own page.

## Not built yet

The statement of cash flows and notes, per-funder spending statements,
automatic release of restricted funds, interfund transfers, form-by-form
mapping of the returns (GIFI line numbers and Quebec equivalents), and tracking
whether each return has been filed. See the pull request's "Not included" list.
