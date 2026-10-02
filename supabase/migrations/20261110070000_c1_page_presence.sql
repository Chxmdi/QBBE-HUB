-- Workspace OS wave 2, unit C1: live presence and co-editing on pages
-- (switches wos_pages + wos_editor).
--
-- Presence
--   Each open tab keeps one row, refreshed every few seconds while it is
--   open and removed when it closes (a person with the page open in two tabs
--   stays present while either is open). A row older than 20 seconds counts
--   as gone, so a tab that closed without saying goodbye (a crash, a lost
--   network) leaves the header within 30 seconds. Readers see only the rows
--   of pages they can open, and only the people who can still open that
--   page: someone who lost access disappears at once, even before their row
--   goes stale. Nobody writes another person's row.
--
--   The table is deliberately not published to Realtime: Realtime cannot
--   apply row-level security to deleted rows, so it would tell any signed-in
--   subscriber which person left which page. Browsers read the list with
--   their heartbeat instead.
--
--   Not object_presence (V1-17): app.can does not answer for pages, and its
--   rows are kept for a minute, too long for the 30-second promise.
--
-- Live editing channel
--   Editors of a page share its changes over one private Realtime broadcast
--   channel named page-edit:<page id>. Private channels are authorised by
--   the policies on realtime.messages below when a browser joins: only people
--   who can edit the page can join or send, so nobody else ever receives its
--   live changes.

create table if not exists public.page_presence (
  page_id uuid not null references public.page (id) on delete cascade,
  user_id uuid not null references public.user_profile (id) on delete cascade,
  -- One per open tab, chosen by the tab.
  tab_id uuid not null,
  organization_id uuid not null references public.organization (id) on delete cascade,
  editing boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (page_id, user_id, tab_id)
);

create index if not exists page_presence_fresh_idx on public.page_presence (page_id, updated_at desc);

alter table public.page_presence enable row level security;

-- Whether one given person (not the caller) can open a page. Mirrors
-- app.can_read_page_row, which only answers for the caller (and sits on the
-- page table's hot read path, so it is not rewritten to call this);
-- supabase/tests/page-presence.sql fails if the two ever disagree.
create or replace function app.c1_person_can_open_page(p_page uuid, p_person uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.page p
    join public.organization_membership m
      on m.organization_id = p.organization_id and m.user_id = p_person and m.status = 'active'
    where p.id = p_page
      and (
        (p.visibility = 'private' and p.created_by = p_person)
        or (p.visibility = 'workspace' and m.role in ('owner', 'admin', 'leadership_viewer', 'staff'))
      )
  );
$$;

revoke all on function app.c1_person_can_open_page(uuid, uuid) from public, anon;
grant execute on function app.c1_person_can_open_page(uuid, uuid) to authenticated, service_role;

drop policy if exists page_presence_read on public.page_presence;
create policy page_presence_read on public.page_presence
  for select to authenticated
  using (
    updated_at > now() - interval '20 seconds'
    and app.can_page(page_id, 'view')
    and app.c1_person_can_open_page(page_id, user_id)
  );

revoke all on public.page_presence from anon, authenticated;
grant select on public.page_presence to authenticated;

-- "I have this page open in this tab." Refused for anyone who cannot open
-- the page. Editing is recorded only for people who can edit it.
create or replace function public.page_presence_touch(p_page uuid, p_tab uuid, p_editing boolean default false)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_org uuid;
begin
  if v_actor is null or p_page is null or p_tab is null or not app.can_page(p_page, 'view') then
    raise exception 'You cannot open this page.' using errcode = '42501';
  end if;
  select p.organization_id into v_org from public.page p where p.id = p_page;
  insert into public.page_presence (page_id, user_id, tab_id, organization_id, editing, updated_at)
  values (p_page, v_actor, p_tab, v_org, coalesce(p_editing, false) and app.can_page(p_page, 'edit_content'), now())
  on conflict (page_id, user_id, tab_id) do update
    set editing = excluded.editing,
        updated_at = now();
end;
$$;

-- Closing the page in one tab.
create or replace function public.page_presence_leave(p_page uuid, p_tab uuid)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  delete from public.page_presence
  where page_id = p_page and tab_id = p_tab and user_id = (select auth.uid());
$$;

-- Who has the page open, one row per person, as the caller may see them:
-- runs with the caller's rights, so the read policy above decides.
create or replace function public.page_presence_list(p_page uuid)
returns table (user_id uuid, full_name text, editing boolean, updated_at timestamptz)
language sql
stable
security invoker
set search_path = ''
as $$
  select pp.user_id, coalesce(max(up.full_name), ''), bool_or(pp.editing), max(pp.updated_at)
  from public.page_presence pp
  left join public.user_profile up on up.id = pp.user_id
  where pp.page_id = p_page
  group by pp.user_id
  order by max(pp.updated_at) desc
  limit 100;
$$;

-- Nightly: rows nobody refreshed for an hour.
create or replace function app.purge_stale_page_presence()
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  delete from public.page_presence where updated_at < now() - interval '1 hour';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.page_presence_touch(uuid, uuid, boolean) from public, anon;
revoke all on function public.page_presence_leave(uuid, uuid) from public, anon;
revoke all on function public.page_presence_list(uuid) from public, anon;
revoke all on function app.purge_stale_page_presence() from public, anon, authenticated;
grant execute on function public.page_presence_touch(uuid, uuid, boolean) to authenticated, service_role;
grant execute on function public.page_presence_leave(uuid, uuid) to authenticated, service_role;
grant execute on function public.page_presence_list(uuid) to authenticated, service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(j.jobname) from cron.job j where j.jobname = 'workspace-os-page-presence-purge';
    perform cron.schedule('workspace-os-page-presence-purge', '40 6 * * *', 'select app.purge_stale_page_presence()');
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Live editing channel
-- ---------------------------------------------------------------------------

-- The page a channel name points at, or null for any other name. Never
-- raises, so a malformed topic is simply refused.
create or replace function app.c1_edit_topic_page(p_topic text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_topic is null or p_topic !~ '^page-edit:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    return null;
  end if;
  return substr(p_topic, 11)::uuid;
end;
$$;

revoke all on function app.c1_edit_topic_page(text) from public, anon;
grant execute on function app.c1_edit_topic_page(text) to authenticated, service_role;

do $$
begin
  if to_regclass('realtime.messages') is null then
    raise exception 'realtime.messages is missing; the live editing channel cannot be authorised';
  end if;
end;
$$;

drop policy if exists c1_page_edit_join on realtime.messages;
create policy c1_page_edit_join on realtime.messages
  for select to authenticated
  using (
    extension = 'broadcast'
    and app.can_page(app.c1_edit_topic_page(realtime.topic()), 'edit_content')
  );

drop policy if exists c1_page_edit_send on realtime.messages;
create policy c1_page_edit_send on realtime.messages
  for insert to authenticated
  with check (
    extension = 'broadcast'
    and app.can_page(app.c1_edit_topic_page(realtime.topic()), 'edit_content')
  );

comment on table public.page_presence is
  'Workspace OS wave 2 C1: who has a page open. Written by page_presence_touch and page_presence_leave only; rows older than 20 s count as gone.';
