# Epic 06 live verification (staging)

Issues: #43 Gmail, #44 Calendar, #45 Drive, #46 VMS, #47 Email. Epic #16.

This is the procedure that moves each `INT-*` row in
`docs/acceptance-matrix.md` from `blocked` to `verified`. Each row moves only
on evidence recorded here from a real staging run. Code and unit tests are not
evidence for these rows.

## Rules for every run

- **Staging only.** Confirm the site URL and Supabase project are staging
  before each session (see `staging-provisioning.md`). Never point staging at
  production data.
- **QBBE-owned accounts only.** The Google project, the test Google account, the
  Resend sender domain and the VMS credentials must belong to QBBE. Never use a
  personal account, even to "just check".
- **No real recipients.** Before sending any mail, `EMAIL_RECIPIENT_ALLOWLIST`
  must be set on staging to the authorized test addresses only. Admin → Email
  shows "Email is restricted to an allowlist" when it is. If that notice is
  missing, stop.
- **Never record secrets.** Evidence is screenshots, timestamps, record IDs,
  status text and provider message IDs. Never paste tokens, keys, full email
  bodies or personal data.
- **Record as you go.** For each step, write down the date/time (UTC), the
  deployed commit SHA (Admin → Jobs, or the deploy log), what you did,
  and what you saw. A failed step is recorded as failed, with the error text.

## 0. Preconditions

| Check | How | Expected |
|---|---|---|
| Deployed commit | Deploy log | The commit you are certifying |
| Allowlist on | Admin → Email | "Email is restricted to an allowlist" notice lists only test addresses |
| Credentials present | `sh scripts/verify-integrations.sh` with the staging values exported | "Credentials present." (not "blocked") |
| Jobs running | Admin → Jobs | `google-sync`, `drain-notifications`, `gmail-watch-renew`, `vms-sync` have recent successful runs |
| Test users | Admin → Workspace, Members table | Two active test members, **A** (organizer) and **B** (recipient), both using allowlisted addresses |

If any check fails, stop and fix it first. Everything below depends on these.

## 1. INT-EMAIL (#47)

1. **Invitation.** As an admin, invite a new allowlisted address.
   *Expected:* the invite arrives within 2 minutes; its link opens the staging
   sign-up page. Record: the time, the Admin → Email row (status `sent`,
   provider `resend`) and the provider message ID.
2. **Password recovery.** From the sign-in page, request a reset for user B.
   *Expected:* the email arrives, and its link opens staging's reset page.
   *Note:* Supabase Auth sends this one, not the Hub worker, so it does not
   appear in Admin → Email. Record the arrival time.
3. **Direct actions.** As A, trigger each of the following for B: assign a task,
   @mention B in a channel, reply to B's message, @mention B in a record
   comment, and request an approval from B.
   *Expected:* one email per action. Each button opens the exact record: the
   task drawer, the channel message or thread, the commented record, and the
   approvals board. Record one line per action with its Admin → Email row.
4. **Digest.** Turn on B's daily digest (Settings → Notifications) at the
   current hour, leave one unread notification, and wait for the next hourly
   run. *Expected:* one digest email that lists the unread item. Record the row.
5. **Allowlist holds.** Assign a task to a member whose address is **not** on
   the allowlist. *Expected:* no email; Admin → Email shows `suppressed`,
   reason `recipient_not_allowlisted`.
6. **Bounce.** Send a notification to Resend's bounce test address, if it is
   allowlisted for this step. *Expected:* the delivery turns `bounced` within a
   few minutes, and a second notification to that address is `suppressed` with
   `provider_bounced`. Record both rows.
7. **Retry.** Temporarily set `EMAIL_PROVIDER_API_KEY` to an invalid value,
   trigger one assignment, then restore the key. *Expected:* the delivery shows
   an error, then `sent` after the key is restored, with exactly **one** email
   received. **Restore the key right away** — while it is wrong, all staging
   mail fails.

## 2. INT-GMAIL (#43)

1. **Connect.** As A, open Inbox and choose Connect Gmail. Approve with the QBBE
   test Google account. *Expected:* Admin → Integrations shows Gmail
   **Connected**, and the Inbox lists recent messages within 15 minutes.
2. **Retrieval.** Open one message. *Expected:* the full body loads on demand.
3. **Send and reply.** Send a new message to an allowlisted address, then reply
   to a received message. *Expected:* both arrive, and the reply stays in the
   same thread in Gmail.
4. **Push.** From another allowlisted account, send a message to the test
   account. *Expected:* it appears in the Hub Inbox within about 1 minute, not
   15. Record the send and arrival times.
5. **Missed push.** In Google Cloud, pause the Pub/Sub push subscription and
   send another message. *Expected:* it still appears on the next 15-minute
   `google-sync` run. **Resume the subscription afterwards.**
6. **Revocation.** At myaccount.google.com → Security → Third-party access,
   remove the Hub's access. *Expected:* after the next sync, Admin →
   Integrations shows **Authentication expired**. Reconnect: status returns to
   Connected and the Inbox catches up.

## 3. INT-CALENDAR (#44)

1. **Connect** Calendar as A. *Expected:* **Connected**.
2. **Create.** Create a meeting at 14:00 organization time with a Zoom link
   typed in. *Expected:* it appears in A's Google Calendar at 14:00 local time.
   The Hub meeting still shows the Zoom link, not a Google link.
3. **Update.** Move it to 15:30. *Expected:* Google shows 15:30. There is one
   event, not two.
4. **Daylight saving.** Create a meeting on the Sunday of the next
   daylight-saving change at 09:00. *Expected:* Google shows 09:00 local on that
   day.
5. **Remote deletion.** Delete the event in Google, then edit the meeting in
   the Hub. *Expected:* the event reappears in Google, once.
6. **Cancel.** Cancel the meeting. *Expected:* the event disappears from Google;
   the Hub meeting shows Cancelled.
7. **Revocation.** Remove the Hub's Calendar access in Google, then edit a
   meeting. *Expected:* the Hub saves the edit; Admin → Integrations shows
   **Authentication expired**. Reconnect and edit again. *Expected:* Google
   catches up.

## 4. INT-DRIVE (#45)

1. **Connect** Drive as A. *Expected:* within 15 minutes, A's Drive files
   appear in Documents as links. Signed in as B, they are **not** visible.
2. **Rename.** Rename a file in Drive. *Expected:* after the next sync, the Hub
   shows the new name, once.
3. **Loss of access.** Remove A's access to a shared file, or trash one of A's
   files. *Expected:* after the next sync, it is gone from Documents.
4. **Revocation.** Remove the Hub's Drive access in Google. *Expected:*
   **Authentication expired**; the existing list stays until reconnect or
   disconnect.
5. **Disconnect.** Disconnect Drive. *Expected:* A's imported Drive links are
   removed; files in Google are untouched.

## 5. INT-VMS (#46)

Requires the provider's contract and staging credentials.

1. **Connect** from Admin. *Expected:* Connected. A malformed or unreachable
   endpoint is refused with a visible error.
2. **Link identity.** In Admin → Workspace, Members table, link B to a VMS volunteer identity.
   *Expected:* after the next `vms-sync`, B's availability shows.
3. **Assignments.** Create and then remove an assignment in the VMS.
   *Expected:* the reference appears and then disappears. No Hub task is
   created or deleted.
4. **Revoked credentials.** Rotate the VMS key without updating the Hub.
   *Expected:* the integration shows a visible error; Hub data is intact.
5. **Disconnect.** *Expected:* VMS identities and references are cleared; Hub
   tasks and history remain.

## Recording the result

For each `INT-*` row in `docs/acceptance-matrix.md`, set the status to
`verified` only when **every** step in its section passed. In the evidence
column, record the run date, the staging commit SHA, who ran it, and where the
screenshots are. If any step failed, keep the row `blocked` or
`awaiting verification`, note the failed step, and open or link an issue for
it. Then close the matching child issue, and tick it in #16.
