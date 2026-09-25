-- P1-RPT-03: an export is not visible outside the organization that requested it.
begin;

do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_guest uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5';
  v_org uuid;
  v_export uuid;
  n integer;
begin
  select organization_id into strict v_org
  from public.organization_membership
  where user_id = v_owner
  limit 1;

  -- A finished export: it has a file and a completion time.
  insert into public.export_job (organization_id, kind, requested_by, status, storage_path, completed_at)
  values (v_org, 'task_history', v_owner, 'ready', v_org || '/export-scope-test.csv', now())
  returning id into v_export;

  perform tests.authenticate(v_guest);
  select count(*) into n from public.export_job where id = v_export;
  perform tests.ok(n = 0, 'a guest cannot read another person''s export');

  reset role;
end;
$$;

rollback;
