# Bills and invoices: payables and receivables (#150)

Bills from vendors and invoices to partners, funders and members live at
**Bills & invoices** in the sidebar (`/finance/payables`). Every step posts a
journal entry through the ledger (#148), so the ledger's rules apply: the chart
of accounts must be approved, the date must be in an open period, and posted
entries never change.

## Who can do what

| Person | Can |
| --- | --- |
| Owner or admin who completed MFA | Everything below, plus post bills and invoices, record payments made and received, reverse payments, void, and set the bill approval threshold. |
| Staff | See vendors, customers, bills, invoices, payments and aging. Add and edit contacts. Draft bills and invoices, edit or delete their own drafts, send a bill for approval. |
| Volunteers, guests, other organizations | Nothing. |

Staff choose accounts from a list of names only; they still cannot read the
ledger itself unless an admin names them a ledger reader.

## What posting writes

| Step | Debit | Credit |
| --- | --- | --- |
| Post a bill | Each line's account (expense or asset); GST to **1200**, QST to **1210** | Accounts payable **2000** (or the liability account chosen) for the total |
| Pay a bill | Accounts payable | The bank account chosen |
| Post an invoice | Accounts receivable **1100** (or the asset account chosen, e.g. **1150** for grants) for the total | Each line's account (revenue, or deferred contributions); GST to **2200**, QST to **2210** |
| Receive a payment | The bank account chosen | The receivable account |
| Void, or reverse a payment | The mirror image of the original entry, on the date chosen | |

Everything on a bill or invoice is in one fund, chosen on the document. Taxes
that cannot be claimed back go in the line amounts, with GST and QST left at
zero. If account 1200, 1210, 2200 or 2210 is missing or inactive, posting a
document with that tax says which account to add.

## Rules the database enforces

- **No double payment.** A payment can never be more than what is still owing.
  Payments are taken one at a time under a lock, and a check on the bill itself
  refuses a paid amount above the total. A paid bill takes no more payments.
- **No duplicate bills.** The same vendor invoice number for the same vendor,
  or the same captured bill from Receipts, cannot be two live bills. After a
  void, the number can be entered again.
- **Posted means permanent.** A posted bill or invoice keeps its figures and
  lines. A mistake is voided (only when no payments remain), which posts a
  reversing entry; the document stays on file marked void.
- **Payments are never edited or deleted.** A wrong payment or returned cheque
  is reversed, which reopens the amount owing.
- **Invoice numbers** (INV-0001, INV-0002, ...) are given at posting, in order,
  without gaps.

## Aging

**Aging** shows what was still owed on any date, by days past due: not yet
due, 1–30, 31–60, 61–90 and over 90. It uses the same dates as the ledger
entries (document, payment, reversal and void dates), so its total equals the
balance of the payable or receivable accounts on that date. Admins and ledger
readers see that check on the page. A difference means someone posted a manual
journal entry to one of those accounts that is not tied to a bill or invoice.
**Download CSV** gives the accountant the same figures.

## Approvals

An admin can set a bill total at or above which a bill needs an approval
before posting (under the bills list). When the approvals engine (#143) is
installed, **Send for approval** on a draft bill routes it, and posting is
refused until an approval for that exact total is approved; changing the
amount afterwards needs a new approval. Until the engine is installed the
threshold is shown but not enforced.
