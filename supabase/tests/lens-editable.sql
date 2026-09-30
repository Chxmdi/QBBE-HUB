-- Workspace OS lens_editable (V1-1): exactly public.can(id, 'edit_content'),
-- for every fixture person at both sign-in levels. Rolled back.
begin;

do $$
declare
  v_person uuid;
  v_level text;
  v_ids uuid[];
  v_expected uuid[];
  v_got uuid[];
begin
  select array_agg(id) into v_ids from (
    select id from public.task union all select id from public.project union all select gen_random_uuid()
  ) x;

  perform tests.ok(
    (select not p.prosecdef and p.proconfig @> array['search_path=""'] from pg_proc p
     where p.proname = 'lens_editable' and p.pronamespace = 'public'::regnamespace),
    'lens_editable runs with the caller''s rights');
  perform tests.ok(not has_function_privilege('anon', 'public.lens_editable(uuid[])', 'execute'),
    'signed-out visitors cannot call lens_editable');

  for v_person in select user_id from public.organization_membership loop
    foreach v_level in array array['aal1', 'aal2'] loop
      perform tests.authenticate(v_person, v_level);
      select coalesce(array_agg(id order by id), array[]::uuid[]) into v_expected
      from unnest(v_ids) id where public.can(id, 'edit_content');
      select coalesce(array_agg(id order by id), array[]::uuid[]) into v_got
      from public.lens_editable(v_ids) id;
      perform tests.ok(v_got = v_expected,
        format('%s at %s: lens_editable equals public.can edit_content (%s editable)', v_person, v_level, cardinality(v_got)));
      reset role;
    end loop;
  end loop;

  perform tests.authenticate('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'aal2');
  perform tests.ok((select count(*) from public.lens_editable(array_fill(gen_random_uuid(), array[600]))) = 0,
    'unknown ids are never editable, and the batch is capped');
  reset role;
end;
$$;

rollback;
