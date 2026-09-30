-- Workspace OS Find (M12). Run after qa-users.sql and rls.sql. Rolled back.
--
--   1. Rights: caller's rights, no dynamic SQL, signed-out visitors refused.
--   2. French-aware matching: accents and case ignored, words in any order,
--      stems in descriptions.
--   3. Type and space filters, ranking, paging and the total.
--   4. RLS: for every fixture person, Find returns exactly the matching
--      records that person can select, and nothing else.
--   5. Hostile queries are plain text.
begin;

create temporary table find_fx (name text primary key, id uuid) on commit drop;
grant select on find_fx to authenticated;

do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_volunteer uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
  v_org uuid;
  v_program_a uuid;
  v_program_b uuid;
  v_project uuid;
begin
  select organization_id into strict v_org from public.organization_membership where user_id = v_owner;
  insert into public.program (organization_id, name, slug, created_by)
  values (v_org, 'Findprog Alpha', 'findprog-a-' || substr(gen_random_uuid()::text, 1, 6), v_owner) returning id into v_program_a;
  insert into public.program (organization_id, name, slug, created_by)
  values (v_org, 'Findprog Beta', 'findprog-b-' || substr(gen_random_uuid()::text, 1, 6), v_owner) returning id into v_program_b;
  insert into public.project (organization_id, program_id, name, owner_id, created_by)
  values (v_org, v_program_a, 'Zyxfind projet école', v_owner, v_owner) returning id into v_project;
  insert into find_fx values ('program_a', v_program_a), ('program_b', v_program_b), ('project', v_project);

  insert into public.task (organization_id, project_id, title, description, created_by, assignee_id)
  values
    (v_org, v_project, 'Zyxfind Réunion du conseil d''ÉCOLE', 'Préparer l''ordre du jour', v_owner, v_volunteer),
    (v_org, null, 'Zyxfind rapport annuel', 'Trois réunions trimestrielles prévues', v_owner, null),
    (v_org, null, 'Zyxfind', 'exact title', v_owner, null);
  update public.task set program_id = v_program_b where title = 'Zyxfind rapport annuel';
  insert into public.task (organization_id, title, created_by, archived_at)
  values (v_org, 'Zyxfind archived école', v_owner, now());
end;
$$;

-- 1. Rights
do $$
begin
  perform tests.ok(
    (select not p.prosecdef and p.proconfig @> array['search_path=""'] and p.provolatile = 's'
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'find'),
    'find runs with the caller''s rights, an empty search_path, and cannot write');
  perform tests.ok(
    position('execute' in lower((select prosrc from pg_proc where proname = 'find' and pronamespace = 'public'::regnamespace))) = 0,
    'find builds no dynamic SQL');
  perform tests.ok(
    not has_function_privilege('anon', 'public.find(text, text[], uuid, integer, integer)', 'execute')
      and has_function_privilege('authenticated', 'public.find(text, text[], uuid, integer, integer)', 'execute'),
    'signed-in people may search; signed-out visitors may not');
  perform tests.clear_auth();
  begin
    perform public.find('zyxfind');
    raise exception 'FAIL: anon searched';
  exception when insufficient_privilege then
    perform tests.ok(true, 'a signed-out caller cannot call find');
  end;
  reset role;
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', '{"role":"authenticated"}', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform tests.ok(not exists (select 1 from public.find('zyxfind')), 'no viewer, no results');
  reset role;
end;
$$;

-- 2 and 3. Matching, filters, ranking
do $$
declare
  v_titles text[];
begin
  perform tests.authenticate('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'aal2');

  select array_agg(title order by title) into v_titles from public.find('reunion ecole zyxfind', array['task']);
  perform tests.ok(v_titles = array['Zyxfind Réunion du conseil d''ÉCOLE'], 'accents and case are ignored');
  select array_agg(title order by title) into v_titles from public.find('ÉCOLE zyxfind conseil', array['task']);
  perform tests.ok(v_titles = array['Zyxfind Réunion du conseil d''ÉCOLE'], 'words match in any order');
  perform tests.ok(not exists (select 1 from public.find('zyxfind archived')), 'archived records are left out');

  select array_agg(title order by title) into v_titles from public.find('réunion zyxfind', array['task']);
  perform tests.ok('Zyxfind rapport annuel' = any (v_titles),
    'descriptions match by French stem ("réunion" finds "réunions")');

  select array_agg(result_type order by result_type) into v_titles from public.find('zyxfind ecole');
  perform tests.ok(v_titles = array['project', 'task'], 'every type is searched by default');
  select array_agg(result_type) into v_titles from public.find('zyxfind ecole', array['project']);
  perform tests.ok(v_titles = array['project'], 'the type filter narrows the result');

  select array_agg(title order by title) into v_titles
  from public.find('zyxfind', null, (select id from find_fx where name = 'program_a'));
  perform tests.ok(v_titles = array['Zyxfind Réunion du conseil d''ÉCOLE', 'Zyxfind projet école'],
    'the space filter keeps a program''s records, including tasks through their project');
  select array_agg(title order by title) into v_titles
  from public.find('zyxfind', null, (select id from find_fx where name = 'program_b'));
  perform tests.ok(v_titles = array['Zyxfind rapport annuel'], 'the space filter uses a task''s own program');

  perform tests.ok((select title from public.find('zyxfind') limit 1) = 'Zyxfind', 'an exact title ranks first');
  perform tests.ok((select count(*) from public.find('zyxfind', null, null, 2)) = 2
      and (select max(total) from public.find('zyxfind', null, null, 2)) = 4,
    'paging returns the page and the total');
  perform tests.ok((select count(*) from public.find('zyxfind', null, null, 2, 2)) = 2, 'offset pages');
  perform tests.ok((select count(*) from public.find('z')) = 0, 'a one-character query finds nothing');
  reset role;
end;
$$;

-- 4. RLS: exactly what each person can select.
do $$
declare
  v_person uuid;
  v_find uuid[];
  v_direct uuid[];
begin
  for v_person in select user_id from public.organization_membership
    where organization_id = (select organization_id from public.program where id = (select id from find_fx where name = 'program_a'))
  loop
    perform tests.authenticate(v_person, 'aal2');
    select coalesce(array_agg(id order by id), array[]::uuid[]) into v_find from public.find('zyxfind', array['task'], null, 100);
    select coalesce(array_agg(id order by id), array[]::uuid[]) into v_direct
    from public.task where title like 'Zyxfind%' and archived_at is null;
    perform tests.ok(v_find = v_direct, format('%s: Find returns exactly the tasks they can select', v_person));
    select coalesce(array_agg(id order by id), array[]::uuid[]) into v_find from public.find('zyxfind', array['project'], null, 100);
    select coalesce(array_agg(id order by id), array[]::uuid[]) into v_direct
    from public.project where name like 'Zyxfind%' and archived_at is null;
    perform tests.ok(v_find = v_direct, format('%s: Find returns exactly the projects they can select', v_person));
    reset role;
  end loop;
end;
$$;

-- 5. Hostile queries
do $inj$
declare
  v_payload text;
  v_before bigint := (select count(*) from public.task);
begin
  perform tests.authenticate('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'aal2');
  foreach v_payload in array array['''; drop table public.task; --', '%%', '__', '\', '$$ select 1 $$', ') or 1=1 --', 'école'' or ''1''=''1', repeat('x', 250)] loop
    perform count(*) from public.find(v_payload);
    perform count(*) from public.find(v_payload, array[v_payload]);
  end loop;
  perform tests.ok((select count(*) from public.task) = v_before, 'hostile queries run as plain text and change nothing');
  perform tests.ok(not exists (select 1 from public.find('%%')), '% is a character, not a wildcard');
  reset role;
end;
$inj$;

rollback;
