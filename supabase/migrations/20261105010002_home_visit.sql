-- "While you were away" (M17d, epic #199): when each person last looked at
-- Home, so the digest can show what changed since.
--
-- One row per person and organization. Nobody reads anyone else's row: the
-- time a colleague last opened Home is not work information. Rows are written
-- only through public.home_away_since(), which also decides when a visit
-- starts, so a reload in the middle of a visit does not empty the digest:
--
--   * last_seen_at     the most recent time Home was opened;
--   * away_since       where the current visit's digest starts, i.e. the last
--                      time Home was opened before this visit began.
--
-- A visit begins when Home is opened more than 30 minutes after it was last
-- opened. The first visit ever has no away_since; the app then looks back a
-- fixed seven days.

create table if not exists public.home_visit (
  user_id uuid not null references public.user_profile (id) on delete cascade,
  organization_id uuid not null references public.organization (id) on delete cascade,
  last_seen_at timestamptz not null default now(),
  away_since timestamptz,
  primary key (organization_id, user_id)
);

comment on table public.home_visit is
  'When each person last opened Home, for the while-you-were-away digest (M17d). Own row only.';

alter table public.home_visit enable row level security;

-- Read your own row, in an organization you are an active member of.
drop policy if exists home_visit_read_own on public.home_visit;
create policy home_visit_read_own on public.home_visit
  for select to authenticated
  using (user_id = (select auth.uid()) and app.is_org_member(organization_id));

-- No insert, update or delete policy: writes go through home_away_since().
revoke insert, update, delete on public.home_visit from anon, authenticated;
revoke all on public.home_visit from anon;

create or replace function public.home_away_since(p_organization uuid)
returns timestamptz
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_row public.home_visit;
  v_visit_gap constant interval := interval '30 minutes';
begin
  if v_user is null or not app.is_org_member(p_organization) then
    raise exception 'Organization membership required' using errcode = '42501';
  end if;

  select * into v_row from public.home_visit
  where organization_id = p_organization and user_id = v_user
  for update;

  if not found then
    insert into public.home_visit (organization_id, user_id, last_seen_at, away_since)
    values (p_organization, v_user, now(), null);
    return null;
  end if;

  if v_row.last_seen_at < now() - v_visit_gap then
    -- A new visit: the digest starts where the last visit ended.
    update public.home_visit
    set away_since = v_row.last_seen_at, last_seen_at = now()
    where organization_id = p_organization and user_id = v_user;
    return v_row.last_seen_at;
  end if;

  -- The same visit: keep its starting point.
  update public.home_visit
  set last_seen_at = now()
  where organization_id = p_organization and user_id = v_user;
  return v_row.away_since;
end;
$$;

revoke all on function public.home_away_since(uuid) from public, anon;
grant execute on function public.home_away_since(uuid) to authenticated;

comment on function public.home_away_since(uuid) is
  'Records a Home visit for the caller and returns where their while-you-were-away digest starts (M17d).';
