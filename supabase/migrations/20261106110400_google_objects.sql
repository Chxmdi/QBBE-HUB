-- Workspace OS Google objects (V1-15, stream S6b, epic #199).
--
-- Builds on the Google integration (#16), which already syncs each person's
-- own calendar events (calendar_event_link), Gmail messages (gmail_message)
-- and Drive files (document rows with integration_connection_id). Nothing here
-- calls Google; it works on what the existing sync jobs stored, per person.
--
--   * Calendar: a synced event becomes a Hub meeting. The meeting is created
--     through the meeting table's own insert rule, as the person, and then
--     public.google_link_event_meeting ties the person's own event to it.
--   * Drive: files are linked through the existing document link path
--     (approved hosts, app.reject_unapproved_document_link); no table here.
--   * Gmail: a message is forwarded into capture_forward, the hand-over table
--     the capture inbox (S5, M18) reads until it exists. Each person sees and
--     forwards only their own mail.
--
-- Hidden behind the wos_objects switch in the app (no separate switch exists).

create table public.capture_forward (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organization (id) on delete cascade,
  user_id uuid not null references public.user_profile (id) on delete cascade default auth.uid(),
  source text not null check (source in ('gmail')),
  source_id uuid not null,
  title text not null check (char_length(title) between 1 and 300),
  body text check (body is null or char_length(body) <= 2000),
  sender text check (sender is null or char_length(sender) <= 320),
  received_at timestamptz,
  status text not null default 'new' check (status in ('new', 'triaged', 'dismissed')),
  created_at timestamptz not null default now(),
  unique (user_id, source, source_id)
);

create index idx_capture_forward_user on public.capture_forward (user_id, status, created_at desc);

comment on table public.capture_forward is
  'Items forwarded into the capture inbox (V1-15). Read by the capture inbox (M18) once it exists; private to each person.';

alter table public.capture_forward enable row level security;

-- Private to the person: capture is their own inbox, like their mail.
create policy capture_forward_read on public.capture_forward
for select to authenticated using (
  user_id = (select auth.uid()) and app.is_org_member(organization_id)
);

-- Only your own synced message, only into your own capture inbox.
create policy capture_forward_insert on public.capture_forward
for insert to authenticated with check (
  user_id = (select auth.uid())
  and app.is_org_member(organization_id)
  and source = 'gmail'
  and exists (
    select 1 from public.gmail_message m
    where m.id = capture_forward.source_id
      and m.user_id = (select auth.uid())
      and m.organization_id = capture_forward.organization_id)
);

create policy capture_forward_update on public.capture_forward
for update to authenticated
using (user_id = (select auth.uid()) and app.is_org_member(organization_id))
with check (user_id = (select auth.uid()) and app.is_org_member(organization_id));

create policy capture_forward_delete on public.capture_forward
for delete to authenticated using (
  user_id = (select auth.uid()) and app.is_org_member(organization_id)
);

grant select, insert, update, delete on public.capture_forward to authenticated;
grant all on public.capture_forward to service_role;

-- What a forward copies is fixed from the message, never taken from the request.
create or replace function app.capture_forward_from_source() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  m public.gmail_message%rowtype;
begin
  if tg_op = 'UPDATE' then
    if (new.organization_id, new.user_id, new.source, new.source_id, new.title, new.body, new.sender,
        new.received_at, new.created_at)
       is distinct from (old.organization_id, old.user_id, old.source, old.source_id, old.title, old.body,
        old.sender, old.received_at, old.created_at) then
      raise exception 'Only the status of a captured item changes' using errcode = '42501';
    end if;
    return new;
  end if;
  select * into m from public.gmail_message g where g.id = new.source_id;
  if found then
    new.title := left(coalesce(nullif(btrim(m.subject), ''), '(no subject)'), 300);
    new.body := left(m.snippet, 2000);
    new.sender := left(m.from_address, 320);
    new.received_at := m.received_at;
  end if;
  new.created_at := now();
  return new;
end;
$$;
revoke all on function app.capture_forward_from_source() from public, anon, authenticated;

create trigger capture_forward_from_source
before insert or update on public.capture_forward
for each row execute function app.capture_forward_from_source();

-- ---------------------------------------------------------------------------
-- Calendar events as meetings
-- ---------------------------------------------------------------------------

-- Ties a person's own synced event to a meeting they can manage. The meeting
-- itself is created beforehand through the meeting table's own insert rule,
-- so this grants nothing: it only records the link the existing sync reads
-- (calendar_event_link.meeting_id, 0015).
create or replace function public.google_link_event_meeting(p_link_id uuid, p_meeting_id uuid)
returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_link public.calendar_event_link%rowtype;
begin
  select * into v_link from public.calendar_event_link l where l.id = p_link_id;
  if v_uid is null or not found or v_link.user_id <> v_uid
     or not app.is_org_member(v_link.organization_id) then
    raise exception 'This calendar event is not yours' using errcode = '42501';
  end if;
  if v_link.meeting_id is not null then
    raise exception 'This event is already a meeting' using errcode = '23505';
  end if;
  if not exists (
    select 1 from public.meeting mt
    where mt.id = p_meeting_id and mt.organization_id = v_link.organization_id)
     or not app.can_manage_meeting(p_meeting_id) then
    raise exception 'You cannot link that meeting' using errcode = '42501';
  end if;
  update public.calendar_event_link set meeting_id = p_meeting_id where id = p_link_id;
end;
$$;
revoke all on function public.google_link_event_meeting(uuid, uuid) from public, anon;
grant execute on function public.google_link_event_meeting(uuid, uuid) to authenticated, service_role;
