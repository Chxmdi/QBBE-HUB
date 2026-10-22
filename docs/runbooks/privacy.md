# Privacy and retention

Hub stores **QBBE work data**, not a second volunteer database and not
service-user/case records (those are P2 / out of first release).

## What we keep

| Data | Retention | Notes |
|---|---|---|
| Auth identities (`auth.users`) | While the account is active; deactivated rows stay for audit | Reactivate is a recovery path (Unit 6) |
| Messages, tasks, projects, reports | Until an admin archives/deletes per policy | Soft-delete (`deleted_at`) on messages |
| Frozen report snapshots | Keep the approved bytes; live data must not rewrite them | PDF/CSV export is audited |
| Gmail metadata | Only while `integration_connection` is connected | Disconnect drops Hub’s mail rows, not Hub tasks |
| VMS ids on `user_profile` | Optional link; disconnect clears sourced fields only | Hub does not copy the volunteer DB |
| Zeffy supporters and payments (`crm_contact` with `source = 'zeffy'`, `zeffy_payment`, `zeffy_campaign`) | Kept after Zeffy is disconnected: payments are donor financial records (six years, as gifts), supporters are CRM contacts | Read only from Zeffy. Payments readable by finance readers only (`can_read_ledger`); each view and CSV export of supporters' giving is recorded in the audit log. Not kept: postal addresses, checkout and ticket answers, card details, discount codes, tribute ("in memory of") names |
| Notification delivery rows | Needed for job idempotency | Dedupe keys prevent double-send |
| Audit events | At least six years; see [Audit trail retention](#audit-trail-retention) | Access changes, exports, ownership transfer |

## Data inventory

Personal information the Hub holds, by table. "Who can read" is the
row-level security rule, not the menu: the database refuses everyone else.
Retention in **bold** is handled by the app: Admin → Retention deletes on a
schedule once a policy is switched on; Admin → Records lists the records whose
period has ended, and a person deletes them (it never deletes by itself).
Everything else is kept until someone deletes it, which is a gap the privacy
impact assessment has to decide on (see `privacy-impact-assessment.md`).

| Table(s) | Personal information | Purpose | Who can read | Retention | How it is deleted |
|---|---|---|---|---|---|
| `auth.users`, `user_profile` | Name, email, title, photo, time zone, language, VMS id and availability, sign-in history (Auth) | Accounts and sign-in | The person; members of the same organization see name, title and photo | While the account is active; deactivated accounts stay for the audit trail | Owner deletes the Auth user (cascades the profile); see the request procedure below |
| `organization_membership`, `team_member`, `*_access_grant`, `program_membership`, `project_membership` | Role, team, what each person may see | Authorization | Members; grants are managed by admins | While the membership exists | Removed with the grant or account |
| `message`, `message_mention`, `message_reaction`, `conversation*`, `channel_member`, `saved_message` | What people write to each other, who read what and when | Work communication | Channel or conversation members only | Until deleted by the author or an admin | Author deletes (soft delete, `deleted_at`); admins delete channels |
| `task*`, `checklist_item`, `record_comment*`, `project*`, `program*`, `meeting*`, `decision*` | Names, assignments, comments, attendance | Work management | Per project or program grant | Until archived or deleted | Archive or delete in the app |
| `activity_event`, `activity_entry`, `object_event` | Who did what, when | Timelines and history | Same as the record they describe | **`activity_event`: 90 days minimum, 365 default, when the policy is on** | Admin → Retention (`apply-retention` job) |
| `notification`, `notification_delivery`, `email_delivery`, `email_suppression`, `notification_preference` | Who was notified of what; email addresses; excerpts of the message that caused the email | Notifications and email | The recipient; delivery rows are job-only | **`notification`: 30 days minimum, 180 default, when the policy is on**; delivery rows have no limit (a gap) | Admin → Retention for notifications |
| `crm_contact`, `crm_organization`, `crm_interaction`, `crm_follow_up`, `crm_agreement`, `crm_link`, `opportunity` | Donor, funder and partner names, emails, phone numbers, notes on conversations | Fundraising and partnerships | CRM users (`can_access_crm`: staff and above) | **`crm_interaction`: 2 years minimum, 5 default, delete or anonymise, when the policy is on**; contacts until deleted | Admin → Retention for interactions; delete contacts in the CRM |
| `crm_sensitive_note` | Free-text notes a staff member marked sensitive about a contact or organization | Context that should not be on the open record | Only the owner of the contact or organization, or an administrator (`app.can_access_crm_sensitive_note`) | Until deleted (no policy: a gap) | Delete in the CRM |
| `gift`, `gift_acknowledgement`, `grant_award`, `grant_report` | Donor names, amounts, dates, acknowledgement letters | Donation records and tax receipts | Finance readers (`can_read_ledger`) | Six years after the fiscal year end (**Admin → Records**, `financial_record`) | A person deletes them once Admin → Records lists them as past their period |
| `zeffy_*` | Zeffy supporters and payments | Imported donations | Finance readers | As gifts (see the row above in "What we keep") | As gifts |
| `payroll_run`, `payroll_run_allocation`, `payroll_account_map` | Pay by employee as imported from the payroll provider's journal | Payroll accounting | Finance readers | Six years after the fiscal year end (**Admin → Records**) | A person deletes them once listed as past their period |
| `finance_*`, `journal_*`, `bank_*` | Supplier and customer names, bank transaction descriptions that can name people | Bookkeeping | Finance readers | Six years after the fiscal year end (**Admin → Records**) | A person deletes them once listed as past their period |
| `document`, `document_text`, `form_file`, `signature`, `signing_document*`, `form_submission`, `form_v2_response` | Whatever people upload or enter: contracts, IDs, consent forms, signatures, form answers | Documents, forms and e-signatures | Per folder, form or document access | **Admin → Records** by category (signed documents 3 years minimum, 6 default; form submissions 1 minimum, 3 default) | A person deletes them once listed as past their period; documents can also be deleted directly |
| `gmail_message`, `integration_connection`, `integration_secret`, `calendar_event_link` | Email metadata (sender, subject, date) of a connected mailbox, OAuth tokens | Inbox and calendar integration | The person who connected it | While connected | Disconnecting removes the mail rows and tokens |
| `team_signal`, `team_signal_settings` | Per-person work signals (overdue work, load) | Team overview for leads | Team leads and admins | While the feature is on | Switching the feature off; see the staff notice in `/privacy` |
| `home_visit`, `page_visit`, `object_presence`, `page_presence` | When a person was last on a page | Presence and "what changed since your visit" | The person; presence is shown to others on the same page | Overwritten on each visit | Account deletion |
| `audit_event`, `api_request_log`, `export_job`, `rate_limit_counter` | Who changed access, exported data, used the API; request counters per key | Accountability and abuse limits | Admins (audit, exports); job-only for counters | **`audit_event`: 6 years minimum, 7 default, when the policy is on; `export_job`: 1 year minimum, 3 default** | Admin → Retention |

Backups (`backup-recovery.md`) hold copies of all of the above for as long
as the backup set is kept. Uploaded files live in Supabase Storage and follow
the `document` rows.

## Audit trail retention

The audit trail (`audit_event`) is kept **at least six years**. That floor is
enforced by the database (`retention_subject`: minimum 2190 days, default 2555
days), so no setting can shorten it. Deletion after that is **off until an
administrator switches the policy on** in Admin → Retention; while it is off,
audit events are never deleted. Do not delete audit events by hand.

## Person in charge of protecting personal information

Quebec's Law 25 requires a person in charge of protecting personal
information. By default it is the person with the highest authority in the
organization; that person may delegate the role, in writing, to someone else.

- **Title:** _to be designated by QBBE (owner action)_
- **Contact:** _a role address, for example a privacy@ mailbox, to be created
  and published by QBBE (owner action)_
- Their title and contact must also appear in the public notice at
  `/privacy` (`src/config/privacy.ts`) and on QBBE's website.

## Requests about personal information

Anyone (staff, volunteer, donor, partner) can ask to see, correct or delete
their personal information, or ask how it was used.

1. The request goes to the person in charge, in writing (email is fine). Log
   it with the date received.
2. Confirm the requester's identity before disclosing anything: a request from
   the email address on file, or a call back on a known number.
3. Answer **within 30 days** of receipt. If more time is truly needed, say so
   in writing within those 30 days.
4. **Access:** export what the Hub holds about the person: their profile, the
   rows in the inventory above that name them, and their CRM record if they
   are a contact. Admin → Exports produces a person-data export for members.
   Do not include other people's personal information in the answer.
5. **Correction:** correct it in the app, or tell the person why not.
6. **Deletion:** delete what is not required by law (financial records follow
   the six-year rule) and say what was kept and why.
7. Record the request, the answer and the date in the request register kept
   by the person in charge (outside the Hub).

## Confidentiality incidents

A confidentiality incident is any access, use, disclosure or loss of personal
information that was not authorized. The person in charge keeps a register of
every incident. When an incident presents a risk of serious injury, notify
the Commission d’accès à l’information and the people affected without
delay. Record what happened, what information and how many people were
affected, and the steps taken to reduce the risk.

## Service providers and transfers outside Quebec

Every provider that receives personal information, what it receives, and
where it is processed: see `privacy-processors.md`. Personal information may
not be communicated outside Quebec before the privacy impact assessment
(`privacy-impact-assessment.md`) concludes it will be adequately protected.

## What we do not log

- Full Gmail bodies in application logs (SEC-006)
- Service-role keys, OAuth refresh tokens, or SMTP credentials
- Fake “sent” states when `EMAIL_PROVIDER_API_KEY` is unset

## Access

Postgres RLS is the authorization boundary. Volunteers cannot read CRM,
reports, or admin tables. Private channel bodies are invisible to non-members
in queries, realtime, and `global_search`.

## Operator review (before production pilot)

- [ ] Confirm Supabase project region and backup retention with QBBE
- [ ] Designate the person in charge in writing and publish the contact
- [ ] Complete and sign the privacy impact assessment
- [ ] Sign data processing terms with each provider in `privacy-processors.md`
- [ ] Confirm MFA on owner/admin (AUTH-006) — see `deployment.md`
- [ ] Confirm no production seed data
- [ ] Confirm Gmail/VMS remain disconnected until QBBE-owned credentials exist

## Retention policies

Admin → Retention. Each governed record type has a policy saying how long it is
kept and what happens then. Three properties are worth knowing before using it:

**Only whitelisted record types can be governed.** `retention_subject` names
them, and adding another is a schema change. A retention system that can be
pointed at any table is a compliance hole waiting for a well-meaning
administrator — an audit trail set to thirty days, or funder evidence deleted
the year before the audit that needed it.

**Every subject has a floor**, enforced by a trigger rather than a CHECK,
because the minimum lives in a row of another table. The audit trail's floor is
six years and is deliberately hard to argue with: charity records are commonly
required for that long, and an audit trail is the first thing an investigation
asks for.

**Policies start switched off.** The page shows how many records the current
setting would affect, counted by the same code the nightly job runs, and
enabling one asks for confirmation with that number in the sentence.

`apply-retention` runs at 02:40 daily, one batch per policy, and writes a
`retention_run` row whether it removed anything or not. That log cannot be
written from the application — a hand-edited retention log is not a log.
