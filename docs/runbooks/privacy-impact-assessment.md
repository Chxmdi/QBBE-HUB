# Privacy impact assessment (draft)

**Status: draft, not in force.** It has no effect until the person in charge
of protecting personal information (`privacy.md`) completes the open points
and signs it. Quebec's Law 25 requires an assessment for any information
system project involving personal information (s. 3.3) and before personal
information is communicated outside Quebec (s. 17).

- Prepared by: _to complete_
- Reviewed and approved by (person in charge): _to complete_
- Date approved: _to complete_
- Next review: when a provider, a purpose or a data category changes, and at
  least once a year

## 1. The system

QBBE Hub is the organization's internal workspace: messages, tasks and
projects, documents and forms, CRM for donors, funders and partners, gifts and
donation receipts, bookkeeping, and payroll accounting. About 200 people use
it: staff, volunteers, board members and guests. The full list of what it
stores, who can read it and how long it is kept is the data inventory in
`privacy.md`.

## 2. Purposes

- Running the organization's work (communication, tasks, documents).
- Managing relationships with donors, funders and partners.
- Keeping the financial records the law requires (gifts, payroll, books).

For each data category in the inventory: is it necessary for one of these
purposes? _To complete; flag anything collected "just in case"._

## 3. Sensitive information

- Payroll (pay per employee), donor gifts and amounts, CRM sensitive notes,
  uploaded documents (contracts, identification, consent forms), signatures,
  per-person work signals (Team signals).
- Access: row-level security in the database (`privacy.md`, "Access").
  Finance data needs a finance reader; sensitive notes only their owner or an
  administrator; administrators must use two-factor sign-in.
- Open point: staff and volunteers sign in with a password only. Password
  rules are being raised to 12 characters (`auth-settings.md`). _Decide
  whether finance readers must also use two-factor sign-in._

## 4. Communication outside Quebec

One row per provider in `privacy-processors.md`. For each one record:

| Provider | Region confirmed | Contract signed | Sensitivity of what it receives | Protection measures | Conclusion |
|---|---|---|---|---|---|
| Supabase | _to complete_ | _to complete_ | Everything | Encryption in transit and at rest (to confirm), access controls | _to complete_ |
| Oracle Cloud server | _to complete_ | _to complete_ | Everything rendered | Server hardening (`hosting.md`) | _to complete_ |
| Resend | _to complete_ | _to complete_ | Email content, including donor names | Consider content-free emails | _to complete_ |
| Google | _to complete_ | _to complete_ | Connected mailboxes and calendars; backups | Per-person opt-in; encrypted backups | _to complete_ |
| Sentry | _to complete_ | _to complete_ | Error context | Keep switched off until scrubbing exists | _to complete_ |

The assessment must consider the sensitivity of the information, the purpose,
the protection measures (contractual ones included) and the legal framework
of the place where it is processed (s. 17).

## 5. Retention

Gaps found while writing the inventory: notification delivery rows, CRM
contacts, sensitive notes and most work records have no retention period.
_Decide a period for each, or record why none is needed._

## 6. Rights of the people concerned

The request procedure is in `privacy.md` (30-day answer). The public notice is
at `/privacy` in the app. _Confirm the notice text before it stops being a
draft._

## 7. Risks and decisions

| Risk | Likelihood | Severity | Decision | Owner |
|---|---|---|---|---|
| _to complete_ | | | | |

## 8. Approval

_Signature of the person in charge and date._
