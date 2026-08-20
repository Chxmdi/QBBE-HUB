-- QBBE Hub — transactional email delivery (W2).
--
-- Creating a notification and delivering it are separate facts with separate
-- rows (NTF-002). A provider outage must never roll back the business action
-- that caused the notification, so the application only ever writes the
-- notification; a trigger puts a pointer on the queue, and the worker owns
-- everything after that.
--
-- Exactly-once effects come from `email_delivery.dedupe_key`, which carries a
-- unique index. A re-delivered queue message collides on insert and is
-- recognised as already handled rather than sending a second copy.

-- ---------------------------------------------------------------------------
-- Delivery ledger. Every attempt is visible, including the ones suppressed by
-- preference — silence with no record is indistinguishable from a bug.
-- ---------------------------------------------------------------------------
create table email_delivery (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization (id) on delete cascade,
  notification_id uuid references notification (id) on delete set null,
  recipient_user_id uuid references user_profile (id) on delete set null,
  recipient text not null,
  subject text not null,
  body_text text,
  body_html text,
  category text not null default 'system',
  kind text not null default 'notification'
    check (kind in ('notification', 'digest', 'system')),
  status text not null default 'queued'
    check (status in ('queued', 'sending', 'sent', 'bounced', 'failed', 'suppressed')),
  suppressed_reason text,
  dedupe_key text not null,
  provider text,
  provider_message_id text,
  attempt int not null default 0,
  last_error text,
  scheduled_for timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- A row that claims delivery must say when and through what.
  constraint sent_rows_are_attributable
    check (status <> 'sent' or (sent_at is not null and provider is not null)),
  constraint suppressed_rows_explain_themselves
    check (status <> 'suppressed' or suppressed_reason is not null)
);

-- The exactly-once guarantee.
create unique index uq_email_delivery_dedupe on email_delivery (dedupe_key);
create index idx_email_delivery_status on email_delivery (status, created_at desc);
create index idx_email_delivery_recipient on email_delivery (recipient_user_id, created_at desc);
-- Partial index for the recovery sweep: rows stuck mid-flight.
create index idx_email_delivery_inflight on email_delivery (updated_at)
  where status in ('sending', 'queued');

comment on table email_delivery is
  'One row per outbound email attempt. Written only by the job runner.';
comment on column email_delivery.dedupe_key is
  'Stable key for the triggering event. Unique — this is what makes delivery exactly-once.';

create trigger email_delivery_set_updated_at
  before update on email_delivery
  for each row execute function set_updated_at();

alter table email_delivery enable row level security;

-- Administrators see the whole ledger, including bounces (§14.2). Everyone
-- else sees only mail addressed to them.
create policy email_delivery_admin_read on email_delivery
  for select using (app.is_admin());

create policy email_delivery_own_read on email_delivery
  for select using (recipient_user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Preferences. Quiet hours already existed as bare hour columns; delivery
-- needs the timezone they are expressed in, the per-category switches the
-- worker consults, and the hour a person wants their digest.
-- ---------------------------------------------------------------------------
alter table notification_preference
  add column if not exists timezone text not null default 'America/Toronto',
  add column if not exists digest_hour smallint not null default 8
    check (digest_hour between 0 and 23),
  add column if not exists email_assignments boolean not null default true,
  add column if not exists email_mentions boolean not null default true,
  add column if not exists email_announcements boolean not null default true,
  add column if not exists email_due_dates boolean not null default true;

comment on column notification_preference.timezone is
  'IANA zone that quiet_hours_start/end and digest_hour are expressed in.';

alter table notification_preference
  drop constraint if exists quiet_hours_are_valid;
alter table notification_preference
  add constraint quiet_hours_are_valid check (
    (quiet_hours_start is null and quiet_hours_end is null)
    or (quiet_hours_start between 0 and 23 and quiet_hours_end between 0 and 23)
  );

-- Access is unchanged: `notification_pref_own` in 0002 already scopes every
-- operation to the row's own user.

-- ---------------------------------------------------------------------------
-- Enqueue on notification. The trigger puts a pointer on the queue and nothing
-- more: suppression is decided at send time, so mail deferred by quiet hours
-- can still be released later instead of being dropped at creation.
--
-- The send is wrapped so that a queue problem can never fail the transaction
-- that created the notification (NTF-002). The row survives either way, and
-- `retry-failed-emails` re-queues anything the trigger could not.
-- ---------------------------------------------------------------------------
create or replace function app.enqueue_notification_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    perform pgmq.send('notifications', jsonb_build_object(
      'kind', 'notification',
      'notification_id', new.id,
      'user_id', new.user_id,
      'category', new.category,
      'urgency', new.urgency,
      'dedupe_key', coalesce(new.dedupe_key, 'notification:' || new.id::text)
    ));
  exception when others then
    raise warning 'could not enqueue notification email for %: %', new.id, sqlerrm;
  end;
  return new;
end;
$$;

create trigger notification_enqueue_email
  after insert on notification
  for each row execute function app.enqueue_notification_email();

-- ---------------------------------------------------------------------------
-- Recovery source for `retry-failed-emails`: notifications created but never
-- given a delivery row, because the trigger's enqueue failed or the worker
-- crashed before recording anything. Service-role only.
-- ---------------------------------------------------------------------------
create or replace function public.email_orphaned_notifications(
  p_older_than_minutes int default 10,
  p_limit int default 100
)
returns table (
  notification_id uuid,
  user_id uuid,
  category text,
  urgency text,
  dedupe_key text
)
language sql
stable
security definer
set search_path = public
as $$
  select n.id,
         n.user_id,
         n.category,
         n.urgency::text,
         coalesce(n.dedupe_key, 'notification:' || n.id::text)
  from notification n
  left join email_delivery d on d.notification_id = n.id
  where d.id is null
    and n.created_at < now() - make_interval(mins => greatest(p_older_than_minutes, 1))
    and n.created_at > now() - interval '7 days'
  order by n.created_at
  limit greatest(p_limit, 1);
$$;

revoke all on function public.email_orphaned_notifications(int, int) from public, anon, authenticated;
grant execute on function public.email_orphaned_notifications(int, int) to service_role;
