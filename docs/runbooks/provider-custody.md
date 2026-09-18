# Provider custody register

Issue: #52. Companion to `environment-ownership.md`, which says what must be
true; this file is where it gets written down.

**Never record a secret value here.** Record where the secret lives. This file
is in the repository and anyone who can read the code can read it.

## How to fill this in

One row per provider. A row is complete when every column has a real name or
identifier in it — not "QBBE", not "the team", not "TBD". The point of the
register is that when an account needs recovering at short notice, somebody can
read a name and phone them.

- **QBBE owner** — the organizational account that owns the resource, not a
  person. If the answer is a personal account, the row is not done.
- **Primary / backup custodian** — named people who can sign in today. Two,
  because one person is a single point of failure, and the backup is the reason
  a holiday is not an outage.
- **Recovery contact** — the address or phone the provider sends recovery to.
  If it is a personal mailbox, the row is not done.
- **MFA** — `enforced` only if the provider refuses a sign-in without it.
  "Enabled for my account" is not enforcement.
- **Secret location** — the store and key name, e.g.
  `GitHub Environment "staging" → NETLIFY_AUTH_TOKEN`.
- **Rotated** — the date it was last rotated, and the interval it is due on.

| Provider | QBBE owner | Primary custodian | Backup custodian | Recovery contact | MFA | Staging resource | Production resource | Secret location | Rotated |
|---|---|---|---|---|---|---|---|---|---|
| GitHub | | | | | | | | | |
| Netlify | | | | | `qbbe-hub-staging` `2169b17a-8dc3-49de-a466-4281e1285de2` | `qbbe-hub-production` `a34499c8-0d84-47d5-bfb2-502c2b9b9071` | | |
| Supabase | | | | | | | | | |
| Google Workspace / OAuth | | | | | | | | | |
| Transactional email | | | | | | | | | |
| Malware scanning | | | | | | | | | |
| Monitoring / alerting | | | | | | | | | |
| Backup storage | | | | | | | | | |

## Open ownership questions

These are recorded because they block #52, not because they are unknowable.

1. The repository is owned by the personal `Chxmdi` account. Until it sits
   under a QBBE organization, every branch protection and environment secret is
   held by an individual.
2. The production Supabase project ref in the repository (`xvxahcbwydsnllqbjnlr`)
   is not visible from the Supabase account currently connected to this
   workspace, so its ownership cannot be confirmed from here. Somebody with
   access has to confirm it, or it has to be recreated under QBBE control.
3. Whether staging and production are separate Supabase projects or one project
   with branching. Either is defensible; the register needs to say which, because
   the isolation checks in `environment-ownership.md` are written differently for
   each.
