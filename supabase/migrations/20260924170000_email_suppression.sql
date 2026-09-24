-- INT-EMAIL: remember addresses the provider says must not be mailed again.
--
-- A hard bounce or a spam complaint arrives from the provider after the send
-- succeeded, through a signed webhook. Without a record of it the worker keeps
-- mailing an address that does not exist or a person who reported the Hub as
-- spam, which is what gets a sending domain blocked. Written only by the
-- webhook through the service role; the worker reads it before every send.

create table email_suppression (
  address text primary key check (address = lower(address) and address like '%@%'),
  reason text not null check (reason in ('bounced', 'complained')),
  provider text not null default 'resend',
  provider_event_id text,
  detail text,
  created_at timestamptz not null default now()
);

comment on table email_suppression is
  'Addresses the email provider reported as bounced or complained. The worker never mails them.';

alter table email_suppression enable row level security;

-- Administrators may see why an address stopped receiving mail. Nobody writes
-- through the API; the service role bypasses RLS for the webhook.
create policy email_suppression_admin_read on email_suppression
  for select using (app.is_admin());
