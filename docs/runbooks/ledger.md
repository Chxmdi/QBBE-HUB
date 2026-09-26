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

## Not built yet

Year-end closing entries, the statement of financial position, the statement
of operations, the statement of changes in fund balances, per-funder spending
statements and automatic release of restricted funds. See the pull request's
"Not included" list.
