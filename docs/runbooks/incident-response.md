# Incident response

What to do when QBBE Hub is down, broken, or may have exposed personal
information. Hub holds donor, payroll and personal information for about 200
people, so a data incident is also a legal matter under Quebec's Law 25 (the
*Act respecting the protection of personal information in the private sector*).
Privacy rules and retention live in [privacy.md](privacy.md); this page is the
procedure.

Never put real incident details, names or personal information in this
repository. It is public. Records go in the incident register (below).

## People

QBBE fills these in; nobody else may. Until they are filled in, the person
who notices the incident calls the person in charge of personal information.

| Role | Who | How to reach them |
|---|---|---|
| Person in charge of the protection of personal information (Law 25; by default the organization's highest authority) | *QBBE to name* | *QBBE to fill* |
| On-call operator (server, deploys, Supabase) | *QBBE to name* | *QBBE to fill* |
| Backup operator | *QBBE to name* | *QBBE to fill* |
| Leadership contact for SEV-1 | *QBBE to name* | *QBBE to fill* |

Provider accounts and their custodians: [provider-custody.md](provider-custody.md).

## Severity

| Level | Meaning | Examples | Response |
|---|---|---|---|
| SEV-1 | Personal information exposed or possibly exposed; sign-in down for everyone; data corrupted or lost | A leaked service key; a wrong grant letting one person read another's payroll; database read-only at its size limit | Start now, day or night. Tell leadership within the hour. Register entry required. Law 25 assessment required. |
| SEV-2 | A main function is down for many people, no data exposure | Uploads stuck in "Security check pending"; Zeffy or Gmail sync stopped; email not sending | Start the same working day. Register entry if personal information may be involved. |
| SEV-3 | One feature or a few people affected, with a workaround | One report fails to export; one integration shows "delayed" | Handle in normal work, within a week. |
| SEV-4 | Cosmetic or no user impact | A wrong label; a noisy log line | Ordinary issue. |

When unsure between two levels, take the higher one.

## How incidents are noticed

- **Error monitoring**: crashes users see, server errors and failed actions go
  to the monitoring service when `ERROR_MONITORING_DSN` is set
  ([hosting.md](hosting.md)).
- **In-app alerts**: Admin > Jobs shows failed, overdue and "dispatch failed"
  jobs; Admin > Integrations shows "Synchronization delayed" when a sync has
  stopped ([jobs.md](jobs.md)).
- **Health addresses**: `/api/health/version` (the site answers),
  `/api/health/ready` (settings and database work), `/api/health/jobs`
  (background jobs are wired). An external uptime monitor on these is an
  owner step; until it exists, an outage is noticed only when someone uses the
  site.
- **Server logs**: one JSON line per refused webhook or job call and per
  failed action, each with a request id that matches the `x-request-id`
  response header. `docker logs qbbe-app-production` on the server.
- **People**: a report from a user. Ask for the time, the page, and the
  "reference" shown on any error page.

## First hour: contain

Do what fits; write down what you did and when, as you go.

1. **Decide the severity** with the table above and open a register entry for
   SEV-1 and SEV-2.
2. **If a key or secret may have leaked** (service role key, `CRON_JOB_SECRET`,
   a provider key): rotate it at the provider, update the environment's
   `APP_ENV` secret in GitHub, and redeploy ([deployment.md](deployment.md)).
   A rotated Supabase JWT secret or signing key also signs everyone out.
3. **If an account may be compromised**: deactivate the person in Admin >
   Members (Deactivate; this ends their access at once), and end their
   sessions in the Supabase dashboard (Authentication > Users).
4. **If a feature is leaking or corrupting data**: switch it off. A Workspace
   OS module is off when its row in `public.feature_flag` is off (change it in
   the Supabase SQL editor); anything else may need a rollback.
5. **If the last release caused it**: run the Rollback workflow to the
   previous commit ([release-procedure.md](release-procedure.md)).
6. **If the database is lost or corrupted**: follow
   [backup-recovery.md](backup-recovery.md).
7. **Keep evidence**: do not delete logs, rows or accounts you may need to
   understand what happened. Copy the relevant log lines (with request ids) and
   Supabase logs into the register entry's private folder before they rotate.

## Law 25: confidentiality incidents

A *confidentiality incident* is any access to, use of or disclosure of
personal information that the law does not authorize, any loss of personal
information, or any other breach of its protection. It includes a staff
member opening records they had no reason to open, an export sent to the wrong
person, or a misconfiguration that made rows readable, even if nobody is known
to have looked.

When one happens or is suspected, the person in charge of personal information
(or their delegate) must:

1. **Reduce the risk** right away (the containment steps above) and prevent a
   repeat.
2. **Assess the risk of serious injury** to the people concerned, considering:
   - how sensitive the information is (payroll, banking, donations, health or
     identity information are sensitive);
   - what could happen to the people if it is misused (fraud, identity theft,
     discrimination, damage to reputation);
   - how likely misuse is (who got it, whether it was encrypted, whether it was
     recovered).
   Write the assessment and its reasons in the register.
3. **If there is a risk of serious injury, notify promptly**:
   - the *Commission d'accès à l'information du Québec* (CAI), using the
     confidentiality incident notice form on its website;
   - every person whose information is concerned (directly, or by public
     notice where the law allows it);
   - and, where it can reduce the risk, other organizations that can help (for
     example a bank, or the police).
   Do not delay a notice while the investigation continues; send what is known
   and update it.
4. **Record every confidentiality incident in the register**, including those
   with no risk of serious injury, and keep each entry for at least five years
   after the date the incident became known. The CAI may ask for a copy.

## The incident register

- **Where**: in QBBE's private storage, never in this repository (an owner
  step: QBBE chooses the location and who can open it, and writes the location
  in this line once decided).
- **Template**: [incident-register-template.md](incident-register-template.md)
  lists the fields each entry needs. Copy it into the private register; do not
  fill it in here.
- **Who writes**: whoever handles the incident opens the entry; the person in
  charge of personal information completes the Law 25 fields.

## After the incident

Within two weeks of closing a SEV-1 or SEV-2:

1. Write a short review in the register: what happened, how it was noticed,
   how long each step took, what is changed so it does not happen again.
2. Open GitHub issues for the changes (no personal information in them).
3. Update this runbook if a step was missing or wrong.
4. Record a tabletop exercise at least once a year (date and who took part) in
   the register.
