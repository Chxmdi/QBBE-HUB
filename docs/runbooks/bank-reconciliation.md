# Bank import and reconciliation

How QBBE reconciles each bank account with the ledger every month (#151).
Builds on the ledger runbook (`docs/runbooks/ledger.md`): the chart of accounts
must be approved and the month's fiscal period must exist and be open.

## Rules the database enforces

- Only owners and admins who completed MFA import, match, create entries and
  reconcile. Staff an admin named as ledger readers see everything read-only.
- A bank account is tied to one active **asset** account of the ledger (its
  cash account). Only the last four digits of the account number are stored.
- Importing the same statement twice adds nothing twice. Each line gets a
  fingerprint (a SHA-256 hash of its date, amount, description, reference and
  position among identical lines; for OFX, the bank's own transaction id).
- A statement line matches one posted ledger line on the same cash account for
  exactly the same amount. Each side is matched once.
- A statement can be marked reconciled only when: every line in its dates is
  matched, the lines add up from the opening to the closing balance, the
  difference is zero, the previous statement is reconciled and its closing
  balance is this one's opening balance. This holds even for a direct database
  update.
- Once reconciled, its lines and matches are locked. Only the latest reconciled
  statement can be reopened.

## The monthly routine

1. **Download the statement file.** In online banking, export the month as CSV,
   or as OFX / QFX ("Quicken" or "Money" format) if offered. OFX is preferred:
   it carries the bank's transaction ids. Do not change the file.
2. **Import it.** Open **Bank** in the sidebar, then the account. Under
   *Import a statement*, choose the file. For CSV, check *File layout* shows
   your bank; if the bank changed its format, choose *Other CSV: choose the
   columns* and pick the date, description and amount columns. Click **Import
   statement**.
   - It worked if a message says "Imported N new lines". Importing an
     overlapping file later is safe: lines already there are skipped.
   - If it says "This does not look like a … file" or "Row N: …", the file is
     not in the expected layout or has an amount that could be read two ways
     (for example `1,234`). Nothing was imported. Try the custom layout.
3. **Match the lines.** On the account page, go to the month. For each line:
   - **Accept** takes the suggested ledger line (same amount, dated within 7
     days). **Accept all N suggestions** takes all of them.
   - **Match to…** lists every unmatched ledger line with the same amount
     within 60 days.
   - **Create entry** posts a two-line entry for items only the bank knows
     about (bank charges, interest, a deposit nobody recorded). Choose the other
     account (for example 5800 Bank charges). ⚠️ This posts immediately and is
     permanent; a mistake is corrected by reversing the entry in the journal.
4. **Start the reconciliation.** Under *Reconciliations*, enter the statement's
   dates and its opening and closing balances exactly as printed. Click
   **Start reconciliation**.
5. **Clear the difference.** The screen shows the statement's closing balance,
   the ledger balance, the outstanding items (cheques and deposits in the ledger
   the bank has not processed yet) and the difference. Fix whatever it lists.
6. **Mark reconciled** once it says "Everything matches and the difference is
   zero". ⚠️ The month's lines are then locked.
7. **Download the report** with **Report (CSV)** and file it for the accountant.
8. Close the ledger period for the month (Ledger, Periods) once every bank
   account for that month is reconciled.

## If something is wrong after reconciling

Reopen the statement (only the latest one can be reopened; reopen later ones
first), fix the matches, and mark it reconciled again. Reopening is recorded in
the audit log.
