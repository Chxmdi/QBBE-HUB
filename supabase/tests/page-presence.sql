-- Workspace OS wave 2, unit C1: page presence and the live editing channel.
-- Run after qa-users.sql and rls.sql. Everything is rolled back.
--
-- What must hold (C1-4):
--   1. Signed-out callers can do nothing; signed-in people cannot write the
--      table directly, only through page_presence_touch and _leave.
--   2. People see who has a page open only on pages they can open, and never
--      see someone who cannot open the page (a private page's owner stays
--      invisible to others; someone who loses access disappears at once).
--   3. Someone who cannot open a page cannot announce themselves on it.
--   4. A row older than 20 seconds counts as gone.
--   5. "Editing" is recorded only for people who can edit the page.
--   6. Leaving removes only the caller's own tab: the same person with the
--      page open in another tab stays present, listed once.
--   8. The table is not published to Realtime (which cannot hide deleted
--      rows), and the copied "can this person open the page" rule agrees
--      with the page table's own for every person and page.
--   7. Only people who can edit a page can join or send on its live channel
--      (page-edit:<id>); any other channel name is refused by this rule.
begin;

-- Fixtures: owner 1, staff 2, volunteer 3, admin 4, guest 5, lead 6 (staff).
create temporary table c1_fixture (key text primary key, id uuid) on commit drop;
grant select on c1_fixture to authenticated, anon;

with p as (
  insert into public.page (organization_id, visibility, created_by, title)
  select organization_id, 'workspace', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2', 'C1 presence workspace page'
  from public.organization_membership where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2'
  returning id
)
insert into c1_fixture select 'workspace', id from p;

with p as (
  insert into public.page (organization_id, visibility, created_by, title)
  select organization_id, 'private', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3', 'C1 volunteer private page'
  from public.organization_membership where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3'
  returning id
)
insert into c1_fixture select 'private', id from p;

-- Returns 'ok', or 'refused' when the call is refused for lack of rights.
create or replace function tests.c1_touch(p_page uuid, p_editing boolean)
returns text
language plpgsql
as $$
begin
  perform public.page_presence_touch(p_page, '00000000-0000-0000-0000-0000000000a1', p_editing);
  return 'ok';
exception when insufficient_privilege then
  return 'refused';
end;
$$;

create or replace function tests.c1_seen(p_page uuid)
returns uuid[]
language sql
as $$
  select coalesce(array_agg(user_id order by user_id), '{}') from public.page_presence_list(p_page);
$$;

-- Whether the caller may send on a channel (the insert rule Realtime checks on join).
create or replace function tests.c1_can_send(p_topic text)
returns boolean
language plpgsql
as $$
begin
  perform set_config('realtime.topic', p_topic, true);
  insert into realtime.messages (topic, extension, payload, event, private)
  values (p_topic, 'broadcast', '{}'::jsonb, 'probe', true);
  return true;
exception when insufficient_privilege then
  return false;
end;
$$;

-- Whether the caller may join a channel (the select rule): a probe message
-- written by the database owner is visible only if joining is allowed.
create or replace function tests.c1_can_join(p_topic text)
returns boolean
language plpgsql
as $$
begin
  perform set_config('realtime.topic', p_topic, true);
  return exists (select 1 from realtime.messages m where m.topic = p_topic and m.event = 'c1-owner-probe');
end;
$$;

grant execute on all functions in schema tests to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 1. Rights
do $$
declare
  v_page uuid := (select id from c1_fixture where key = 'workspace');
begin
  perform tests.ok(not has_function_privilege('anon', 'public.page_presence_touch(uuid, uuid, boolean)', 'execute'),
    'signed-out visitors cannot call page_presence_touch');
  perform tests.ok(not has_function_privilege('anon', 'public.page_presence_leave(uuid, uuid)', 'execute'),
    'signed-out visitors cannot call page_presence_leave');
  perform tests.ok(not has_function_privilege('anon', 'public.page_presence_list(uuid)', 'execute'),
    'signed-out visitors cannot call page_presence_list');
  perform tests.ok(not has_table_privilege('authenticated', 'public.page_presence', 'insert')
    and not has_table_privilege('authenticated', 'public.page_presence', 'update')
    and not has_table_privilege('authenticated', 'public.page_presence', 'delete'),
    'signed-in people cannot write page_presence directly');
  perform tests.ok(not has_table_privilege('anon', 'public.page_presence', 'select'),
    'signed-out visitors cannot read page_presence');
  perform tests.ok(
    (select not p.prosecdef from pg_proc p where p.proname = 'page_presence_list' and p.pronamespace = 'public'::regnamespace),
    'page_presence_list runs with the caller''s rights');

  -- A forged insert of someone else's row is refused.
  perform tests.authenticate('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2');
  begin
    insert into public.page_presence (page_id, user_id, tab_id, organization_id)
    select v_page, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4', gen_random_uuid(), organization_id from public.page where id = v_page;
    raise exception 'FAIL: staff wrote a presence row directly';
  exception when insufficient_privilege then
    perform tests.ok(true, 'a direct insert into page_presence is refused');
  end;
  reset role;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2, 3 and 5. Who can announce themselves, and who sees whom
do $$
declare
  v_ws uuid := (select id from c1_fixture where key = 'workspace');
  v_private uuid := (select id from c1_fixture where key = 'private');
begin
  perform tests.authenticate('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2');
  perform tests.ok(tests.c1_touch(v_ws, true) = 'ok', 'staff announces themselves on a workspace page');
  perform tests.authenticate('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4');
  perform tests.ok(tests.c1_touch(v_ws, false) = 'ok', 'an admin announces themselves on the same page');
  perform tests.ok(tests.c1_seen(v_ws) = array['aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4']::uuid[],
    'the admin sees both people on the page');
  perform tests.ok((select editing from public.page_presence_list(v_ws) where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2'),
    'the staff member is shown editing');

  -- A volunteer cannot open a workspace page: refused, and sees nobody.
  perform tests.authenticate('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3');
  perform tests.ok(tests.c1_touch(v_ws, true) = 'refused', 'a volunteer cannot announce themselves on a workspace page');
  perform tests.ok(tests.c1_seen(v_ws) = '{}'::uuid[], 'a volunteer sees nobody on a workspace page');
  perform tests.ok((select count(*) from public.page_presence) = 0, 'a volunteer reads no presence rows of that page directly');
  -- A guest neither.
  perform tests.authenticate('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5');
  perform tests.ok(tests.c1_touch(v_ws, false) = 'refused', 'a guest cannot announce themselves on a workspace page');
  perform tests.ok(tests.c1_seen(v_ws) = '{}'::uuid[], 'a guest sees nobody on a workspace page');

  -- The volunteer's private page: only they can be on it.
  perform tests.authenticate('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3');
  perform tests.ok(tests.c1_touch(v_private, true) = 'ok', 'the volunteer announces themselves on their private page');
  perform tests.ok(tests.c1_seen(v_private) = array['aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3']::uuid[], 'the volunteer sees themselves there');
  perform tests.authenticate('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1');
  perform tests.ok(tests.c1_touch(v_private, false) = 'refused', 'the owner cannot announce themselves on someone else''s private page');
  perform tests.ok(tests.c1_seen(v_private) = '{}'::uuid[], 'the owner does not see who is on someone else''s private page');

  -- 5. A leadership viewer can open but not edit: never shown editing.
  reset role;
  update public.organization_membership set role = 'leadership_viewer' where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa6';
  perform tests.authenticate('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa6');
  perform tests.ok(tests.c1_touch(v_ws, true) = 'ok', 'a leadership viewer announces themselves');
  perform tests.ok(not (select editing from public.page_presence_list(v_ws) where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa6'),
    'a leadership viewer who claims to edit is recorded as viewing');
  reset role;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Someone who loses access disappears at once, before their row is stale.
do $$
declare
  v_ws uuid := (select id from c1_fixture where key = 'workspace');
begin
  update public.organization_membership set role = 'volunteer' where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  perform tests.authenticate('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4');
  perform tests.ok(not ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2'::uuid = any (tests.c1_seen(v_ws))),
    'a person who can no longer open the page is not shown on it');
  reset role;
  update public.organization_membership set role = 'staff' where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  update public.organization_membership set status = 'deactivated' where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  perform tests.authenticate('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4');
  perform tests.ok(not ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2'::uuid = any (tests.c1_seen(v_ws))),
    'a deactivated member is not shown on the page');
  reset role;
  update public.organization_membership set status = 'active' where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Freshness: 15 seconds old is present, 21 seconds old is gone.
do $$
declare
  v_ws uuid := (select id from c1_fixture where key = 'workspace');
begin
  update public.page_presence set updated_at = now() - interval '15 seconds'
  where page_id = v_ws and user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  update public.page_presence set updated_at = now() - interval '21 seconds'
  where page_id = v_ws and user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa6';
  perform tests.authenticate('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4');
  perform tests.ok('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2'::uuid = any (tests.c1_seen(v_ws)), 'a row 15 seconds old is still shown');
  perform tests.ok(not ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa6'::uuid = any (tests.c1_seen(v_ws))), 'a row 21 seconds old is gone');
  reset role;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Leaving removes only the caller's own tab.
do $$
declare
  v_ws uuid := (select id from c1_fixture where key = 'workspace');
  v_other_tab uuid := '00000000-0000-0000-0000-0000000000b2';
begin
  perform tests.authenticate('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4');
  perform public.page_presence_touch(v_ws, v_other_tab, false);
  perform tests.ok((select count(*) from public.page_presence_list(v_ws) where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4') = 1,
    'a person with the page open in two tabs is listed once');
  perform public.page_presence_leave(v_ws, v_other_tab);
  perform tests.ok('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4'::uuid = any (tests.c1_seen(v_ws)),
    'closing one of two tabs keeps the person present');
  perform public.page_presence_leave(v_ws, '00000000-0000-0000-0000-0000000000a1');
  reset role;
  perform tests.ok(not exists (select 1 from public.page_presence where page_id = v_ws and user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4'),
    'closing the last tab removes the person');
  perform tests.ok(exists (select 1 from public.page_presence where page_id = v_ws and user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2'),
    'leaving leaves other people''s rows alone');
  -- Someone else's tab id does not reach their row.
  perform tests.authenticate('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1');
  perform public.page_presence_leave(v_ws, '00000000-0000-0000-0000-0000000000a1');
  reset role;
  perform tests.ok(exists (select 1 from public.page_presence where page_id = v_ws and user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2'),
    'nobody can remove another person''s tab');
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Not published to Realtime; the copied access rule agrees with the original.
do $$
declare
  v_person uuid;
  v_page record;
  v_mismatches integer := 0;
  v_checked integer := 0;
begin
  perform tests.ok(not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'page_presence'),
    'page_presence is not published to Realtime');
  for v_person in select distinct user_id from public.organization_membership loop
    for v_page in select id, organization_id, visibility, created_by from public.page loop
      -- As the database owner (signed-in roles cannot name the app schema),
      -- with the person's identity for auth.uid().
      perform set_config('request.jwt.claim.sub', v_person::text, true);
      perform set_config('request.jwt.claims', json_build_object('sub', v_person::text, 'role', 'authenticated')::text, true);
      if app.can_read_page_row(v_page.organization_id, v_page.visibility, v_page.created_by)
         is distinct from app.c1_person_can_open_page(v_page.id, v_person) then
        v_mismatches := v_mismatches + 1;
      end if;
      v_checked := v_checked + 1;
    end loop;
  end loop;
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
  perform tests.ok(v_checked > 0 and v_mismatches = 0,
    format('c1_person_can_open_page agrees with can_read_page_row for every person and page (%s checked)', v_checked));
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. The live editing channel.
do $$
declare
  v_ws uuid := (select id from c1_fixture where key = 'workspace');
  v_private uuid := (select id from c1_fixture where key = 'private');
  v_ws_topic text := 'page-edit:' || v_ws;
  v_private_topic text := 'page-edit:' || v_private;
begin
  perform tests.ok(app.c1_edit_topic_page('page-edit:not-a-uuid') is null, 'a malformed channel name names no page');
  perform tests.ok(app.c1_edit_topic_page('page-edit:' || v_ws || 'x') is null, 'a channel name with a suffix names no page');
  perform tests.ok(app.c1_edit_topic_page(v_ws_topic) = v_ws, 'page-edit:<id> names the page');

  insert into realtime.messages (topic, extension, payload, event, private)
  values (v_ws_topic, 'broadcast', '{}'::jsonb, 'c1-owner-probe', true),
         (v_private_topic, 'broadcast', '{}'::jsonb, 'c1-owner-probe', true);

  -- Editors of a workspace page: owner, admin, staff.
  perform tests.authenticate('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2');
  perform tests.ok(tests.c1_can_join(v_ws_topic), 'staff can join a workspace page''s live channel');
  perform tests.ok(tests.c1_can_send(v_ws_topic), 'staff can send on a workspace page''s live channel');
  perform tests.ok(not tests.c1_can_join(v_private_topic), 'staff cannot join someone else''s private page channel');
  perform tests.ok(not tests.c1_can_send(v_private_topic), 'staff cannot send on someone else''s private page channel');
  perform tests.authenticate('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1');
  perform tests.ok(tests.c1_can_join(v_ws_topic), 'the owner can join a workspace page''s live channel');
  perform tests.ok(not tests.c1_can_join(v_private_topic), 'the owner cannot join someone else''s private page channel');

  -- Viewers and outsiders.
  perform tests.authenticate('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa6');
  perform tests.ok(not tests.c1_can_join(v_ws_topic), 'a leadership viewer (read only) cannot join the live channel');
  perform tests.ok(not tests.c1_can_send(v_ws_topic), 'a leadership viewer cannot send on the live channel');
  perform tests.authenticate('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3');
  perform tests.ok(not tests.c1_can_join(v_ws_topic), 'a volunteer cannot join a workspace page''s live channel');
  perform tests.ok(not tests.c1_can_send(v_ws_topic), 'a volunteer cannot send on a workspace page''s live channel');
  perform tests.ok(tests.c1_can_join(v_private_topic), 'the volunteer can join their own private page''s channel');
  perform tests.authenticate('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5');
  perform tests.ok(not tests.c1_can_join(v_ws_topic), 'a guest cannot join the live channel');
  perform tests.ok(not tests.c1_can_send(v_ws_topic), 'a guest cannot send on the live channel');
  perform tests.ok(not tests.c1_can_send('page-edit:nope'), 'nobody can send on a malformed page channel name');
  perform tests.clear_auth();
  perform tests.ok(not tests.c1_can_join(v_ws_topic), 'a signed-out visitor cannot join the live channel');
  reset role;

  -- A trashed page takes no live edits.
  update public.page set deleted_at = now() where id = v_ws;
  perform tests.authenticate('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2');
  perform tests.ok(not tests.c1_can_send(v_ws_topic), 'nobody can send live edits to a page in the trash');
  reset role;
end;
$$;

rollback;
