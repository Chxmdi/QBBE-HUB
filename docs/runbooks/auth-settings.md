# Supabase Auth settings

The password rule lives in three places that must agree:

- `src/features/auth/password-rules.ts`: what the sign-up and password
  recovery forms check before sending, and the hint they show.
- `supabase/config.toml` (`[auth]` and `[auth.email]`): the local stack.
- Each hosted Supabase project's dashboard: staging and production. The
  repository cannot change or read these; someone with access sets them by
  hand and records it below.

`tests/unit/password-rules.test.ts` keeps the first two in step. The forms
call Supabase Auth directly from the browser, so only Auth's own settings
actually stop a weak password: a form check alone protects nothing.

## The settings

| Setting | Value | Where in the dashboard |
|---|---|---|
| Minimum password length | 12 | Authentication → Sign In / Providers → Email |
| Password requirements | Lowercase, uppercase letters and digits | Same page |
| Secure password change | On | Same page |
| Leaked password protection | On, if the plan allows it | Authentication → Attack Protection (check the current menu name) |
| Email confirmation | As decided for invite-only sign-up | Authentication → Sign In / Providers → Email |

Secure password change means a session older than 24 hours must confirm with
an emailed code (reauthentication) before changing the password. The Hub's
only in-app password change is the recovery page. Arriving by the emailed
recovery link signs the person in fresh, so it works. Someone who opens
`/reset-password` directly from a session older than 24 hours is refused, and
the page tells them to request a new recovery link, which then works.

Leaked password protection (checking new passwords against known breaches)
may need a paid Supabase plan. If it is not available on the plan in use,
record that here, with the date, rather than leaving the row blank.

Existing passwords are not checked again: the rule applies when a password is
set. People with older, shorter passwords meet it at their next reset.

## Record per environment

| Environment | Checked by | Date | Minimum | Requirements | Secure change | Leaked-password protection |
|---|---|---|---|---|---|---|
| Staging | | | | | | |
| Production | | | | | | |

## Checking it

With a signed-in test account on the environment, set a weak password through
the Auth API. It must be refused:

```bash
curl -s -X PUT "$SUPABASE_URL/auth/v1/user" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $USER_ACCESS_TOKEN" \
  -H "Content-Type: application/json" -d '{"password":"abc123"}'
```

The answer is HTTP 422 with `"error_code":"weak_password"`. Use a test
account, never a real person's, and staging before production.
