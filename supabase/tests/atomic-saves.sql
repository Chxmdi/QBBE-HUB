-- Multi-step saves (migration 20261124020000). Proves creating a project, a
-- program or a meeting series, and closing a project, each commit as a whole
-- or not at all: two projects with the same name both get a channel; a
-- failing agenda row leaves no meeting behind; a failing evidence row
-- leaves the project open and its old evidence in place. Run after
-- qa-users.sql and rls.sql. All changes are rolled back.
begin;

create function tests.reject_agenda_fixture() returns trigger language plpgsql as $$
begin raise exception 'Injected agenda failure' using errcode = '23514'; end;
$$;
create trigger reject_agenda_fixture before insert on public.agenda_item
for each row when (new.title = 'FAIL_AGENDA') execute function tests.reject_agenda_fixture();

do $$
declare
  v_admin uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4';
  v_org uuid;
  v_program uuid := gen_random_uuid();
  v_first uuid := gen_random_uuid();
  v_second uuid := gen_random_uuid();
  v_meeting uuid := gen_random_uuid();
  v_closure uuid;
  v_doc uuid;
  v_other_doc uuid;
  v_other_project uuid := gen_random_uuid();
  v_slugs text[];
  v_failed boolean;
  v_id uuid;
begin
  select organization_id into strict v_org from organization_membership where user_id = v_admin;
  perform tests.authenticate(v_admin, 'aal2');

  perform public.create_program_with_channel(jsonb_build_object(
    'id', v_program, 'organization_id', v_org, 'name', 'Atomic program', 'slug', 'atomic-program-' || left(v_program::text, 8),
    'lead_id', v_admin, 'created_by', v_admin), 'Atomic program', 'atomic-program', 'Program channel');
  perform tests.ok(exists (select 1 from channel where program_id = v_program and type = 'program'),
    'a program is created with its channel');

  foreach v_id in array array[v_first, v_second] loop
    perform public.create_project_with_channel(jsonb_build_object(
      'id', v_id, 'organization_id', v_org, 'program_id', v_program, 'name', 'Gala',
      'owner_id', v_admin, 'stage', 'planning', 'health', 'on_track', 'priority', 'medium',
      'reporting_cadence', 'monthly', 'created_by', v_admin), 'Gala', 'gala', 'Project channel');
  end loop;
  select array_agg(slug order by slug) into v_slugs from channel where project_id in (v_first, v_second);
  perform tests.ok(cardinality(v_slugs) = 2 and v_slugs[1] <> v_slugs[2],
    format('two "Gala" projects in one program each get their own channel (%s)', array_to_string(v_slugs, ', ')));
  perform tests.ok((select count(*) from project_membership where project_id in (v_first, v_second) and role = 'manager') = 2,
    'each new project has its manager');

  v_failed := false;
  begin
    perform public.create_meeting_series(
      jsonb_build_array(jsonb_build_object('id', v_meeting, 'organization_id', v_org, 'project_id', v_first,
        'title', 'Atomic meeting', 'organizer_id', v_admin, 'starts_at', now() + interval '1 day',
        'ends_at', now() + interval '1 day 1 hour')),
      jsonb_build_array(jsonb_build_object('meeting_id', v_meeting, 'user_id', v_admin)),
      jsonb_build_array(jsonb_build_object('meeting_id', v_meeting, 'title', 'FAIL_AGENDA', 'sort_key', 1, 'proposed_by', v_admin)));
  exception when check_violation then
    v_failed := true;
  end;
  perform tests.ok(v_failed and not exists (select 1 from meeting where id = v_meeting),
    'a meeting whose agenda cannot be saved is not created at all');

  perform tests.clear_auth(); reset role;
  insert into document (organization_id, project_id, title, kind, storage_path, created_by)
  values (v_org, v_first, 'Gala report', 'file', 'atomic/gala.pdf', v_admin) returning id into v_doc;
  insert into project (id, organization_id, program_id, name, owner_id, created_by)
  values (v_other_project, v_org, v_program, 'Other project', v_admin, v_admin);
  insert into document (organization_id, project_id, title, kind, storage_path, created_by)
  values (v_org, v_other_project, 'Other report', 'file', 'atomic/other.pdf', v_admin) returning id into v_other_doc;

  perform tests.authenticate(v_admin, 'aal2');
  v_closure := public.close_project_with_evidence(v_first,
    jsonb_build_object('health', 'on_track', 'progress_summary', 'Closing: raised the goal'),
    jsonb_build_object('organization_id', v_org, 'results', 'Raised the goal', 'evidence_links', '[]'::jsonb),
    array[v_doc], false);
  perform tests.ok((select stage from project where id = v_first) = 'completed'
      and exists (select 1 from project_closure_document where closure_id = v_closure and document_id = v_doc),
    'a project closes with its evidence');

  perform tests.clear_auth(); reset role;
  update project set stage = 'planning', completed_at = null where id = v_first;
  perform tests.authenticate(v_admin, 'aal2');
  v_failed := false;
  begin
    perform public.close_project_with_evidence(v_first,
      jsonb_build_object('health', 'on_track', 'progress_summary', 'Closing again'),
      jsonb_build_object('organization_id', v_org, 'results', 'Second close', 'evidence_links', '[]'::jsonb),
      array[v_other_doc], false);
  exception when others then
    v_failed := true;
  end;
  perform tests.clear_auth(); reset role;
  perform tests.ok(v_failed
      and (select stage from project where id = v_first) = 'planning'
      and exists (select 1 from project_closure_document where closure_id = v_closure and document_id = v_doc)
      and (select results from project_closure where id = v_closure) = 'Raised the goal',
    'a close whose evidence is refused changes nothing: still open, old closure and evidence kept');

  perform tests.ok(not has_function_privilege('anon', 'public.create_project_with_channel(jsonb, text, text, text)', 'execute')
      and not has_function_privilege('anon', 'public.close_project_with_evidence(uuid, jsonb, jsonb, uuid[], boolean)', 'execute'),
    'signed-out visitors cannot call the save functions');
end;
$$;

rollback;
