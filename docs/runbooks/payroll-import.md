# Payroll import

How QBBE records each pay run in the ledger (#155). Payroll itself is **not**
run in the app: a specialist provider calculates pay, source deductions,
RL-1 and T4 slips. The app imports the provider's payroll journal (or payroll
register) export and posts each pay run as one balanced journal entry.

Builds on the ledger runbook (`docs/runbooks/ledger.md`): the chart of accounts
must be approved and the pay date's fiscal period must exist and be open.

## Privacy: what is and is not kept

- The file is read **in the browser, on your computer**. It is not uploaded.
- Only each pay run's totals are sent to the server and stored: pay date,
  period, the provider's run number, gross wages, each employee deduction
  total, each employer contribution total and net pay, plus how the run is
  split across funds and programs.
- Employee names, social insurance numbers (SIN), employee numbers and
  per-employee lines are never sent or stored, even when the file contains
  them. They are added into the run totals and then discarded. The database
  has no column that could hold them (checked by `supabase/tests/payroll.sql`).
- Keep the original export in the payroll provider's system, not in the Hub.

## Provider presets: not yet checked against a real export

Presets exist for **Nethris (Desjardins)**, **Employeur D**, **ADP Workforce
Now** and **Ceridian Powerpay**. They follow each provider's published export
layout and **have not yet been checked against a real export**. The screen
says so. When the first real file from QBBE's provider imports cleanly and its
totals match the provider's own payroll register, record that here and in the
issue, and remove the warning for that preset
(`src/features/payroll/parsers.ts` and the import form).

A preset refuses a file whose headers it does not recognise, or where two
columns share a name. It never guesses. **Other CSV** maps any file by hand.

## Rules the database enforces

- Only owners and admins who completed MFA import, map accounts, allocate,
  post, reverse and delete drafts. Ledger readers see runs read-only. Everyone
  else, including an owner who has not completed MFA, sees nothing.
- A run's totals add up to the cent: gross wages less employee deductions
  equals net pay. No amount is negative. Amounts that could be read two ways
  (for example `1,234`) are refused, and the whole file with them.
- The same run cannot be imported twice while it is live. Each run has a
  fingerprint (pay date, period, run number, gross and net) that is unique per
  organization. Importing the same file again adds nothing and says so.
- Imported figures never change. A draft can be deleted and imported again; a
  posted run is corrected only by reversing it.
- Posting builds the entry in the database from the stored totals, the
  account mapping and the allocation, then posts it through the ledger's own
  posting. All ledger rules apply: the entry balances overall and within each
  fund, the period is open, the chart is approved, accounts and funds are
  active, restricted funds are spent inside their dates and on their programs.

## The entry a pay run posts

| Figure | Debit | Credit |
| --- | --- | --- |
| Gross wages | 5000 Salaries and wages | |
| Each employee deduction (federal tax, Quebec tax, QPP, EI, QPIP, other) | | 2300 Source deductions payable |
| Each employer contribution (QPP, EI, QPIP, FSS, CNESST, CNT, other) | 5010 Employer contributions | 2300 Source deductions payable |
| Net pay | | 1000 Bank - chequing, or a net pay payable account |

These are the defaults, created from the starter chart where those accounts
exist. An admin can change any of them. Net pay can come straight out of the
bank account, or go to a payable account (for example 2100 Accrued
liabilities) that the bank payment later clears through bank reconciliation.

When a run is allocated, every figure is split in the allocation's
proportions, to the cent, and net pay per share is set so each fund balances
exactly. Expense lines carry the share's program.

## Each pay run, step by step

1. **Export the payroll journal from the provider.** Choose the payroll
   journal or payroll register report for the pay date, in CSV format. Do not
   edit the file.
   - Nethris: the payroll journal (*Journal de paie*) export.
   - Employeur D: the payroll journal export.
   - ADP Workforce Now: the Payroll Register report, exported to CSV.
   - Ceridian Powerpay: the Payroll Register report, exported to CSV.
2. **Import it.** Open **Payroll** in the sidebar. Under *Import pay runs*,
   choose the provider under *Payroll provider*, then choose the file under
   *Payroll journal or register (CSV)*.
   - It worked if you see "N pay runs found" with a table of runs. Check the
     gross wages and net pay against the provider's report.
   - The page also says how many lines were added in and discarded, whether
     the file's own total row matched, and which categories were not in the
     file (imported as zero). If an employer contribution you pay (for
     example FSS) is listed as missing, stop: choose *Other CSV* and map its
     column.
   - If a red message appears ("does not look like…", "Row N…", "does not add
     up…"), nothing was imported. Choose *Other CSV (choose the columns)*,
     pick the header row, the date order, and the column for each figure.
3. Click **Import pay runs**. Each run is saved as a **draft**.
   - "Already imported: nothing was added." means the run is already there.
     This is the protection against double posting, not an error.
4. **Review the run.** Click the pay date in *Pay runs*. Check *Totals*, then
   the *Account mapping* (anything "Not mapped" must be fixed with **Edit
   account mapping**), then *Journal entry to post*. The last row must say
   *Balanced*.
5. **Allocate it (optional).** Under *Allocation to funds and programs*, click
   **Add share** for each fund and program, choose *Percentage of the run*
   (must add up to 100) or *Amount of gross wages* (must add up to the run's
   gross), and click **Save allocation**. With no shares, the whole run goes
   to the general fund (GEN). A restricted fund that names programs needs a
   program on its share.
6. **Post it.** Click **Post to ledger** and confirm. **This cannot be
   undone**: a posted entry is only corrected by reversing it.
   - It worked if the badge says *Posted* and a *Journal entry N* link
     appears.
   - "Period … is closed" or "No fiscal period covers …": open or create the
     period on **Ledger**, *Periods* (an admin decision), then post again.
   - "Map … to an account before posting": fix the mapping (step 4).

## Correcting a posted run

1. Open the run and click **Reverse**, choosing the *Reversal date* (on or
   after the pay date, in an open period). This posts a mirror entry.
2. Correct the run at the provider, export again, and import it. A reversed
   run's fingerprint no longer blocks a new import.

## Deleting a draft

Open the draft and click **Delete draft**. Posted and reversed runs cannot be
deleted.

## Audit

Every import, mapping change, allocation, post, reversal and draft deletion
writes an audit event of type `payroll`. The import event records the file
name, its SHA-256 hash and the counts, never the file's contents.

## Tests

- `supabase/tests/payroll.sql`: who may do what, duplicate import, runs that
  do not add up, incomplete mapping, closed period, restricted funds, balance
  within each fund, reversal, and that no column can hold employee details.
- `src/features/payroll/tests/parsers.test.ts`: each preset and Other CSV
  against fabricated files, and that nothing about employees survives parsing.
- `tests/e2e/payroll.spec.ts`: import, review, allocate, post, re-import,
  reverse, and that staff without ledger access see nothing.

All sample files are fabricated: no real person, SIN or organization.
