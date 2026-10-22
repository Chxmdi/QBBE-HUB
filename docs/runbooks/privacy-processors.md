# Service providers that receive personal information

Every outside service the Hub, its deployment or its backups send personal
information to. Quebec's Law 25 requires a written contract with each one
(s. 18.3) and, before information leaves Quebec, an assessment that it will
be adequately protected (s. 17). That assessment is
`privacy-impact-assessment.md`.

"To confirm" means the repository cannot show it: someone with access to the
provider's account has to check and record it here. Nothing in this table is
an approval.

| Provider | What it receives | Why | Where processed | Contract / terms | Can it be turned off? |
|---|---|---|---|---|---|
| Supabase (database, Auth, Storage, Realtime) | Everything in the Hub: every table in `privacy.md`'s inventory and every uploaded file | Hosts the application data | Region of each project: to confirm per project. One measured project was `ca-central-1` (Montreal) on 2026-09-25, owned by the Supabase organization "BMF", not QBBE (`qbbe-ownership-and-environments.md`) | To confirm (Supabase DPA) | No |
| Oracle Cloud (application server) | Every page the app renders, its logs, the app's environment secrets, any data cached in memory | Runs the Next.js app and Caddy (`hosting.md`) | Region of the server: to confirm | To confirm (Oracle Cloud terms) | No |
| Resend (email) | Recipient name and address, subject, and the body of every notification, digest, invitation and gift acknowledgement, including message excerpts, donor names and amounts | Sends email (`src/features/notifications/services/email-provider.ts`) | To confirm (account region) | To confirm (Resend DPA) | Yes: without `EMAIL_PROVIDER_API_KEY` no email is sent. Consider content-free emails that link back to the Hub |
| Google (OAuth, Gmail, Calendar, Drive) | For a person who connects their account: their Google identity, mail metadata and the messages they send from the Hub, calendar events they link, file names and links | Inbox, calendar and document links (`src/features/inbox/services/google-oauth.ts`) | To confirm (QBBE's Google Workspace data region) | To confirm (Google Workspace terms) | Yes: per person, by not connecting or disconnecting |
| Google Drive (backups) | Full database dumps and every uploaded file, if the backup plan in `backup-recovery.md` is set up as written | Off-site backups | To confirm (QBBE's Google Workspace data region) | To confirm | The backup destination can change; backups must stay encrypted (`backup-recovery.md`) |
| Sentry (error reporting) | Error messages and their context, which can include names, emails or text a person typed | Error reports (`src/lib/observability.ts`) | To confirm (Sentry organization region) | To confirm | Yes: off unless a Sentry DSN is set. Leave it off until personal data is scrubbed |
| Zeffy | Nothing is sent; the Hub reads supporters and payments from Zeffy | Donation import (`src/features/zeffy`) | Zeffy's own (to confirm) | QBBE's existing Zeffy account terms | Yes: disconnect in Admin |
| GitHub and GitHub Container Registry | The source code and container images. No personal information should be in either; seed data is synthetic | Code hosting, CI and image registry | United States | GitHub terms | Not applicable as long as no personal information is committed |
| OpenStreetMap tiles | The viewer's IP address and the map area viewed, when a map view is open | Map lenses | OpenStreetMap Foundation servers (to confirm) | OSM tile usage policy | Yes: only when a map is shown |
| Embedded video (YouTube, Vimeo, Loom) | The viewer's IP address and browser details, when an embed is played | Embeds in pages | Provider's own | Provider's terms | Yes: only when someone embeds a video |

## Keeping this list current

Add a row in the same pull request as any code that sends personal
information to a new service, and update the privacy impact assessment.
