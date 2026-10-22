# Account recovery for owners and admins

Owners and admins must pass two-step verification (an authenticator app)
before any workspace page opens. Supabase has no backup codes, so a person who
loses every authenticator is locked out until their factors are removed and
they set up a new one. The workspace has exactly one owner, and ownership
cannot be transferred without the owner's own two-step sign-in, so a locked-out
owner blocks owner-only actions until this is done.

**Prevent it:** every owner and admin enrols **two** authenticators (for
example a phone and a password manager), in **Settings**, **Multi-factor
authentication**. Then losing one device is not an incident.

## Who may do this

- The **operator**: a person listed in the Supabase row of
  [provider-custody.md](provider-custody.md) who holds the production
  service role key in the password manager.
- Two **approvers**: two different people who are active owners or admins of
  the organization, other than the person being reset. The audit record names
  them and the operator.

The workspace has exactly one owner, so resetting an admin needs the owner and
one other admin, and resetting the owner needs two other admins. With fewer
(for example one owner and one admin), the script refuses: use the dashboard
path at the end of this page.

## Forgotten password (but authenticator still works)

The person uses **Forgot your password?** on the sign-in page. Nothing else is
needed. If the reset email does not arrive, check **Admin**, **Email** for a
bounce or suppression.

## Lost authenticator: break-glass reset

> **Warning:** removing someone's factors lets whoever controls their
> password sign in as them with full admin rights until a new factor is set
> up. Do the identity check first, every time.

1. **Check identity out of band.** A video call with the person, or in person,
   not email or chat (their accounts may be the ones compromised). Write down
   how you checked.
2. **Get the two approvals** in writing (for example in the incident
   register entry): each approver names the person and the reason.
3. **Open a terminal** with a checkout of this repository, Node 22 and
   `npm ci` done. Load the production key without saving it in your history:
   ```sh
   read -rs SUPABASE_SERVICE_ROLE_KEY; export SUPABASE_SERVICE_ROLE_KEY
   export SUPABASE_URL=https://<production-ref>.supabase.co
   ```
   Paste the key from the password manager after pressing Enter; nothing is
   shown.
4. **Dry run:**
   ```sh
   node scripts/ops/reset-admin-mfa.mjs --email <person> \
     --approved-by <approver 1> --approved-by <approver 2> \
     --operator <your own address> \
     --reason "<why, and how identity was checked>" --dry-run
   ```
   You should see `Dry run: <person> has N factor(s). Nothing was changed.`
   Every address is the one the person signs in with, typed in full.
   A line starting `Refused:` names what is wrong (the person is not an owner
   or admin, an approver is not one, the approvers are the same person, an
   address is not a plain address, or the reason is missing). Fix it and
   repeat; nothing has been changed. `Could not read the sign-in accounts`
   means the key or `SUPABASE_URL` is wrong: load them again (step 3).
5. **Run it** with the same command without `--dry-run`. You should see
   `Removed N factor(s) for <person> and recorded the reset in the audit log.`
   If it says `Stopped before removing anything`, the audit record could not
   be written: nothing was removed; try again. If it says `Removed 1 of 2
   factors, then failed`, run the same command again.
6. **The person signs in** with their password. You should see them sent to
   set up a new authenticator. Ask them to add a second one straight away.
7. **Check the record:** **Admin**, **Audit history** shows two entries
   "authenticators reset by an operator (break-glass)": one when it started,
   one with the outcome. The person, the approvers and the operator are in
   the record's details (`audit_event.metadata` in the database).
8. **Clean up:** `unset SUPABASE_SERVICE_ROLE_KEY`, close the terminal, and
   record the reset (date, person, approvers, identity check) in the incident
   register ([incident-response.md](incident-response.md)).

## When the script cannot be used: Supabase dashboard

For a sole owner with no other admins, or if the script fails:

1. A Supabase custodian signs in to the Supabase dashboard (their own login
   and its own two-step verification).
2. **Authentication**, **Users**, find the person, open them, and delete each
   factor under **Multi-factor authentication**.
3. Write an `mfa.break_glass_reset` entry in the incident register by hand:
   who, why, how identity was checked, who approved.
4. The person signs in and sets up a new authenticator (step 6 above).

If the only Supabase custodian is the person locked out and their Supabase
login used the same lost device, recovery needs Supabase support, which can
take days. Name two Supabase custodians in
[provider-custody.md](provider-custody.md) to avoid that.

## Rehearsal

Rehearse once on staging with a disposable admin account before launch, then
yearly. Record the date and how long it took in the incident register.
