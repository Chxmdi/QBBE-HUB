-- Epic 4 completion: funding source, agreements, and report visibility.
begin;

do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_guest uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5';
  v_org uuid;
  v_crm uuid;
  v_agreement uuid;
  v_project uuid;
  v_report uuid;
  n integer;
begin
  select organization_id into strict v_org
  from public.organization_membership
  where user_id = v_owner
  limit 1;

  perform tests.authenticate(v_owner);

  insert into public.crm_organization (
    organization_id, name, category, owner_id, status, next_action_at
  ) values (
    v_org, 'Funder Trust', 'funder', v_owner, 'active', current_date + 7
  ) returning id into v_crm;

  insert into public.project (
    organization_id, name, owner_id, created_by, funding_source_id, stage
  ) values (
    v_org, 'Funded club', v_owner, v_owner, v_crm, 'planning'
  ) returning id into v_project;
  perform tests.ok(v_project is not null, 'a project can name a CRM funder');

  insert into public.crm_agreement (
    organization_id, crm_organization_id, title, status, created_by
  ) values (
    v_org, v_crm, 'Memorandum of understanding', 'draft', v_owner
  ) returning id into v_agreement;
  perform tests.ok(v_agreement is not null, 'staff can record an agreement');

  insert into public.report_instance (
    organization_id, report_type, title, project_id, generated_by, snapshot
  ) values (
    v_org, 'project', 'Club status', v_project, v_owner, '{"project":{"name":"Funded club"}}'::jsonb
  ) returning id into v_report;

  perform tests.authenticate(v_guest);
  select count(*) into n from public.crm_agreement where id = v_agreement;
  perform tests.ok(n = 0, 'a guest cannot read an agreement');
  select count(*) into n from public.report_instance where id = v_report;
  perform tests.ok(n = 0, 'a guest cannot read a report snapshot');

  reset role;
end;
$$;

rollback;
