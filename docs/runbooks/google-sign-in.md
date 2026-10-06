# Google sign-in (V2-9)

Lets people sign in to QBBE Hub with their Google account instead of a
password. It changes **how** people sign in, not **who** can: sign-up stays
invite-only. A Google account whose email was not invited is refused by the
same database check that refuses an uninvited email (`app.handle_new_user`).
Two-step sign-in rules still apply after a Google sign-in.

Nothing here is done in code: it is set up in Google Cloud and in the
Supabase dashboard, once per environment (staging first, then production).
The code side is ready: `supabase/config.toml` has the provider (off
locally), and `GoogleSignInButton` (`src/features/spaces/admin/`) appears on
the sign-in page only when the site sets `NEXT_PUBLIC_GOOGLE_SIGN_IN=on`.

## What you need before starting

- An owner of QBBE's Google account (Google Workspace admin if QBBE uses
  Google Workspace) who can open https://console.cloud.google.com.
- Owner access to the Supabase project (staging, then production).
- Access to the Netlify site's environment variables.
- The Supabase project reference: in the Supabase dashboard, **Project
  Settings → General → Reference ID** (a string like `abcd1234efgh5678`).

## Steps (do them for staging first, then repeat for production)

1. **Create a Google Cloud project** (skip if QBBE already has one for the Hub).
   Go to https://console.cloud.google.com → project picker at the top →
   **New project** → Name: `QBBE Hub` → **Create**.
   *Worked if:* the project picker now shows `QBBE Hub`.

2. **Set up the consent screen.** In that project: **APIs & Services → OAuth
   consent screen**.
   - User type: **Internal** if everyone signs in with a QBBE Google
     Workspace address (only QBBE accounts can then use it). Otherwise
     **External**.
   - App name `QBBE Hub`, support email and developer contact: QBBE's admin
     address. Scopes: leave the defaults (email, profile, openid). **Save**.
   *Worked if:* the consent screen page shows the app name and status.
   *If "Internal" is greyed out:* the Google account is not a Workspace
   account; choose External and, while it says "Testing", add each tester
   under **Test users**.

3. **Create the sign-in credentials.** **APIs & Services → Credentials →
   Create credentials → OAuth client ID**.
   - Application type: **Web application**. Name: `QBBE Hub (staging)` or
     `(production)`.
   - **Authorized redirect URIs → Add URI**:
     `https://<Reference ID>.supabase.co/auth/v1/callback`
   - **Create.** Copy the **Client ID** and **Client secret** shown.
   *Worked if:* a dialog shows both values.
   **Careful:** the client secret is a password. Paste it only into Supabase
   (next step). Never into chat, email, GitHub or a file in the repository.

4. **Turn Google on in Supabase.** Supabase dashboard → the environment's
   project → **Authentication → Sign In / Providers → Google** →
   **Enable Sign in with Google** on → paste **Client ID** and **Client
   Secret** → **Save**.
   *Worked if:* Google shows as "Enabled" in the provider list.

5. **Allow the site's return address.** Same project → **Authentication →
   URL Configuration** → **Redirect URLs → Add URL**:
   `https://<the site's address>/auth/callback` (for example
   `https://staging.<qbbe domain>/auth/callback`) → **Save**.
   *Worked if:* the address is listed.

6. **Show the button on the site.** Netlify → the environment's site →
   **Site configuration → Environment variables → Add a variable** →
   Key `NEXT_PUBLIC_GOOGLE_SIGN_IN`, Value `on` → **Create variable**. Then
   **Deploys → Trigger deploy → Deploy site** (the value is built into the
   page, so it needs a new deploy).
   *Worked if:* after the deploy, the sign-in page shows "Continue with
   Google". (Until integration places the button on the sign-in page, this
   step has no visible effect; steps 1–5 can still be done ahead of time.)

7. **Test with an invited person.** Invite a test Google address from
   **People** in the Hub, then sign in with Google as that person.
   *Worked if:* they land in the Hub. Then try an address that was **not**
   invited: it must be refused and land back on the sign-in page.
   *If the invited person is refused too:* check that the invitation's email
   is exactly the Google address (same spelling, same domain).

## Turning it off

Supabase → **Authentication → Sign In / Providers → Google** → off → Save;
then remove `NEXT_PUBLIC_GOOGLE_SIGN_IN` in Netlify and redeploy. People who
signed in with Google can still sign in with a password once they set one
with **Forgot password** on the sign-in page.
