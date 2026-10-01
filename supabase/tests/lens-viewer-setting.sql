-- Workspace OS view engine UI (U13): per-viewer settings on a lens. Run
-- after qa-users.sql and rls.sql. Everything is rolled back.
--
--   1. Every role keeps its own setting on a shared lens, reads only its
--      own, and cannot write one for someone else.
--   2. A setting exists only for a lens the viewer can read: nobody can
--      keep one on another person's personal lens, and making a shared lens
--      personal hides its viewers' settings at once.
--   3. The lens and viewer never change after insert; deleting the lens
--      deletes the settings; a signed-out visitor has no access.
begin;

create temporary table lvs_people (role text primary key, id uuid) on commit drop;
insert into lvs_people values
  ('owner', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'),
  ('staff', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2'),
  ('volunteer', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3'),
  ('admin', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4'),
  ('guest', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5'),
  ('lead', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa6'),
  ('pm', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa7'),
  ('contributor', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa8'),
  ('readonly', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa9');
grant select on lvs_people to authenticated;

do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_org uuid;
  v_role record;
  v_shared uuid;
  v_personal uuid;
  v_rows integer;
  v_where jsonb;
begin
  select organization_id into strict v_org from public.organization_membership where user_id = v_owner;

  perform tests.ok(
    (select relrowsecurity from pg_class where oid = 'public.lens_viewer_setting'::regclass),
    'lens_viewer_setting has row-level security');

  -- The owner shares one lens and keeps one personal.
  perform tests.authenticate(v_owner, 'aal2');
  insert into public.lens (organization_id, owner_id, name, kind, type_key, spec, visibility)
  values (v_org, v_owner, 'LVS shared', 'table', 'task', '{"version":1,"type":"task"}', 'shared')
  returning id into v_shared;
  insert into public.lens (organization_id, owner_id, name, kind, type_key, spec)
  values (v_org, v_owner, 'LVS personal', 'table', 'task', '{"version":1,"type":"task"}')
  returning id into v_personal;
  reset role;

  -- 1. Every role keeps its own setting on the shared lens.
  for v_role in select * from lvs_people order by role loop
    perform tests.authenticate(v_role.id, 'aal2');
    v_where := jsonb_build_object('and', jsonb_build_array(
      jsonb_build_object('property', 'title', 'operator', 'contains', 'value', v_role.role)));
    insert into public.lens_viewer_setting (lens_id, user_id, layout, sort, "where")
    values (v_shared, v_role.id, '{"columns":[]}', '[{"property":"title","direction":"desc"}]', v_where);
    perform tests.ok(
      (select "where" = v_where and sort -> 0 ->> 'direction' = 'desc'
       from public.lens_viewer_setting where lens_id = v_shared and user_id = v_role.id),
      v_role.role || ': keeps their own setting on a shared lens');

    update public.lens_viewer_setting set sort = '[]' where lens_id = v_shared and user_id = v_role.id;
    get diagnostics v_rows = row_count;
    perform tests.ok(v_rows = 1, v_role.role || ': can change their own setting');

    perform tests.ok(
      (select spec = '{"version":1,"type":"task"}'::jsonb and layout = '{}'::jsonb from public.lens where id = v_shared),
      v_role.role || ': the shared lens itself is unchanged');

    -- Nobody writes a setting for someone else.
    begin
      insert into public.lens_viewer_setting (lens_id, user_id)
      select v_shared, id from lvs_people where role <> v_role.role limit 1;
      raise exception 'FAIL: % wrote a setting for someone else', v_role.role;
    exception when insufficient_privilege or unique_violation then
      perform tests.ok(true, v_role.role || ': cannot write a setting for someone else');
    end;

    -- 2. Only on a lens they can read: the owner's personal lens is out of reach.
    if v_role.id <> v_owner then
      begin
        insert into public.lens_viewer_setting (lens_id, user_id) values (v_personal, v_role.id);
        raise exception 'FAIL: % kept a setting on a personal lens of someone else', v_role.role;
      exception when insufficient_privilege then
        perform tests.ok(true, v_role.role || ': cannot keep a setting on another person''s personal lens');
      end;
    else
      insert into public.lens_viewer_setting (lens_id, user_id) values (v_personal, v_role.id);
      perform tests.ok(true, 'owner: keeps a setting on their own personal lens');
    end if;
    reset role;
  end loop;

  -- Each person reads only their own row.
  for v_role in select * from lvs_people order by role loop
    perform tests.authenticate(v_role.id, 'aal2');
    perform tests.ok(
      (select count(*) from public.lens_viewer_setting where lens_id = v_shared) = 1
        and (select user_id from public.lens_viewer_setting where lens_id = v_shared) = v_role.id,
      v_role.role || ': sees no one else''s setting');
    update public.lens_viewer_setting set sort = '[{"property":"due"}]' where user_id <> v_role.id;
    get diagnostics v_rows = row_count;
    perform tests.ok(v_rows = 0, v_role.role || ': cannot change another person''s setting');
    delete from public.lens_viewer_setting where user_id <> v_role.id;
    get diagnostics v_rows = row_count;
    perform tests.ok(v_rows = 0, v_role.role || ': cannot delete another person''s setting');

    -- 3. The lens and the viewer are fixed.
    begin
      update public.lens_viewer_setting set user_id = (select id from lvs_people where role <> v_role.role limit 1)
      where lens_id = v_shared and user_id = v_role.id;
      raise exception 'FAIL: % handed a setting to someone else', v_role.role;
    exception when insufficient_privilege then
      perform tests.ok(true, v_role.role || ': cannot hand a setting to someone else');
    end;
    reset role;
  end loop;

  -- Caps: a document-sized setting is refused.
  perform tests.authenticate('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2', 'aal2');
  begin
    update public.lens_viewer_setting set layout = jsonb_build_object('blob', repeat('x', 20000))
    where lens_id = v_shared and user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
    raise exception 'FAIL: an oversized layout was accepted';
  exception when check_violation then
    perform tests.ok(true, 'an oversized setting is refused');
  end;
  begin
    update public.lens_viewer_setting set sort = '[{"property":"a"},{"property":"b"},{"property":"c"},{"property":"d"}]'
    where lens_id = v_shared and user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
    raise exception 'FAIL: four sort keys were accepted';
  exception when check_violation then
    perform tests.ok(true, 'more than three sort keys are refused');
  end;
  reset role;

  -- 2. Making the lens personal hides the viewers' settings at once.
  perform tests.authenticate(v_owner, 'aal2');
  update public.lens set visibility = 'personal' where id = v_shared;
  reset role;
  perform tests.authenticate('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2', 'aal2');
  perform tests.ok(not exists (select 1 from public.lens_viewer_setting where lens_id = v_shared),
    'staff: a setting on a lens made personal is no longer readable');
  update public.lens_viewer_setting set sort = '[]' where lens_id = v_shared;
  get diagnostics v_rows = row_count;
  perform tests.ok(v_rows = 0, 'staff: nor writable');
  reset role;
  perform tests.authenticate(v_owner, 'aal2');
  update public.lens set visibility = 'shared' where id = v_shared;
  reset role;
  perform tests.authenticate('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2', 'aal2');
  perform tests.ok(exists (select 1 from public.lens_viewer_setting where lens_id = v_shared),
    'staff: sharing the lens again brings their setting back');
  reset role;

  -- A deactivated member loses access to their settings.
  update public.organization_membership set status = 'deactivated'
  where organization_id = v_org and user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
  perform tests.authenticate('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3', 'aal2');
  perform tests.ok(not exists (select 1 from public.lens_viewer_setting),
    'a deactivated member reads no setting');
  reset role;
  update public.organization_membership set status = 'active'
  where organization_id = v_org and user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';

  -- 3. Deleting the lens deletes the settings.
  perform tests.ok((select count(*) from public.lens_viewer_setting where lens_id = v_shared) = (select count(*) from lvs_people),
    'every viewer''s setting is on the shared lens');
  perform tests.authenticate(v_owner, 'aal2');
  delete from public.lens where id = v_shared;
  reset role;
  perform tests.ok(not exists (select 1 from public.lens_viewer_setting where lens_id = v_shared),
    'deleting the lens deletes every viewer''s setting');
end;
$$;

-- Signed out: no access at all.
do $$
declare
  v_lens uuid;
  v_user uuid;
begin
  select id, owner_id into v_lens, v_user from public.lens limit 1;
  perform tests.clear_auth();
  begin
    perform 1 from public.lens_viewer_setting;
    raise exception 'FAIL: anon read viewer settings';
  exception when insufficient_privilege then
    perform tests.ok(true, 'a signed-out visitor cannot read viewer settings');
  end;
  begin
    insert into public.lens_viewer_setting (lens_id, user_id) values (v_lens, v_user);
    raise exception 'FAIL: anon created a viewer setting';
  exception when insufficient_privilege or not_null_violation then
    perform tests.ok(true, 'a signed-out visitor cannot create a viewer setting');
  end;
  reset role;
end;
$$;

rollback;
