-- A member cannot move a record into another organization, or into a
-- project or program they do not manage, or take over its organizer or
-- creator; moving between two projects they manage still works.
begin;
do $$
declare
  owner_user uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  staff_user uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  org uuid;
  org_b uuid := 'cccccccc-0000-4000-8000-0000000000d1';
  p_mine uuid;
  p_mine_too uuid;
  p_closed uuid;
  v_meeting uuid;
  v_event uuid;
  v_doc uuid;
  v_note uuid;
  foreign_project uuid;
  foreign_program uuid;
  refused boolean;
  n int;
begin
  reset role;
  perform set_config('request.jwt.claims', '{}', true);
  select organization_id into strict org
  from public.organization_membership where user_id = owner_user;
  insert into public.organization (id, name, slug) values (org_b, 'USM other org', 'usm-other-org');
  insert into public.project (organization_id, name)
  values (org_b, 'USM foreign project') returning id into foreign_project;
  insert into public.program (organization_id, name, slug)
  values (org_b, 'USM foreign program', 'usm-foreign-program') returning id into foreign_program;
  insert into public.project (organization_id, name, owner_id, created_by)
  values (org, 'USM mine', staff_user, owner_user) returning id into p_mine;
  insert into public.project (organization_id, name, owner_id, created_by)
  values (org, 'USM mine too', staff_user, owner_user) returning id into p_mine_too;
  insert into public.project (organization_id, name, owner_id, created_by)
  values (org, 'USM restricted', owner_user, owner_user) returning id into p_closed;
  insert into public.meeting (organization_id, title, starts_at, organizer_id, project_id)
  values (org, 'USM meeting', now() + interval '1 day', owner_user, p_mine) returning id into v_meeting;
  insert into public.event (organization_id, name, starts_at, project_id, created_by)
  values (org, 'USM event', now() + interval '2 days', p_mine, owner_user) returning id into v_event;
  insert into public.document (organization_id, title, kind, url, project_id, owner_id, created_by)
  values (org, 'USM doc', 'link', 'https://drive.google.com/usm', p_mine, staff_user, staff_user) returning id into v_doc;
  insert into public.notification (user_id, organization_id, category, title)
  values (staff_user, org, 'mention', 'USM note') returning id into v_note;

  perform tests.authenticate(staff_user, 'aal1');
  set local role authenticated;

  refused := false;
  begin
    update public.meeting set project_id = p_closed where id = v_meeting;
  exception when insufficient_privilege then refused := true;
  end;
  perform tests.ok(refused, 'a manager cannot move a meeting into a project they do not manage');
  refused := false;
  begin
    update public.meeting set organizer_id = staff_user where id = v_meeting;
    get diagnostics n = row_count;
    refused := n = 0;
  exception when insufficient_privilege then refused := true;
  end;
  perform tests.ok(not refused, 'a manager of the meeting''s project can still change its organizer');
  update public.meeting set project_id = p_mine_too where id = v_meeting;
  get diagnostics n = row_count;
  perform tests.ok(n = 1, 'a manager can move a meeting between projects they manage');

  refused := false;
  begin
    update public.event set project_id = p_closed where id = v_event;
  exception when insufficient_privilege then refused := true;
  end;
  perform tests.ok(refused, 'a manager cannot move an event into a project they do not manage');
  refused := false;
  begin
    update public.event set created_by = staff_user where id = v_event;
  exception when insufficient_privilege then refused := true;
  end;
  perform tests.ok(refused, 'a manager cannot make themselves an event''s creator');

  refused := false;
  begin
    update public.document set organization_id = org_b where id = v_doc;
  exception when insufficient_privilege then refused := true;
  end;
  perform tests.ok(refused, 'a document cannot move to another organization');
  refused := false;
  begin
    update public.document set project_id = p_closed where id = v_doc;
  exception when insufficient_privilege then refused := true;
  end;
  perform tests.ok(refused, 'a document cannot move into a project its owner does not manage');
  update public.document set project_id = p_mine_too where id = v_doc;
  get diagnostics n = row_count;
  perform tests.ok(n = 1, 'a document can move between projects its owner manages');

  insert into public.report_instance (organization_id, report_type, title, project_id, period_start, period_end, snapshot, generated_by)
  values (org, 'project', 'USM report', p_mine, current_date, current_date, '{}', staff_user);
  refused := false;
  begin
    update public.report_instance set project_id = p_closed where title = 'USM report';
  exception when insufficient_privilege then refused := true;
  end;
  perform tests.ok(refused, 'a report cannot move into a project its manager does not manage');

  refused := false;
  begin
    update public.notification set organization_id = org_b where id = v_note;
  exception when insufficient_privilege then refused := true;
  end;
  perform tests.ok(refused, 'a notification cannot move to another organization');

  refused := false;
  begin
    insert into public.risk (organization_id, project_id, title, created_by)
    values (org_b, p_mine, 'USM risk', staff_user);
  exception when insufficient_privilege then refused := true;
  end;
  perform tests.ok(refused, 'a risk cannot be filed under another organization');
  refused := false;
  begin
    insert into public.event (organization_id, name, starts_at, project_id, created_by)
    values (org_b, 'USM foreign event', now(), p_mine, staff_user);
  exception when insufficient_privilege then refused := true;
  end;
  perform tests.ok(refused, 'an event cannot be filed under another organization');
  refused := false;
  begin
    insert into public.integration_connection (organization_id, user_id, provider)
    values (org_b, staff_user, 'google_calendar');
  exception when insufficient_privilege then refused := true;
  end;
  perform tests.ok(refused, 'an integration cannot be connected to another organization');

  refused := false;
  begin
    insert into public.project_request (organization_id, title, summary, requested_by, program_id)
    values (org, 'USM request', 'x', staff_user, foreign_program);
  exception when insufficient_privilege then refused := true;
  end;
  perform tests.ok(refused, 'a request cannot name another organization''s program');

  refused := false;
  begin
    insert into public.notification (user_id, organization_id, category, title, project_id)
    values (owner_user, org, 'mention', 'USM foreign project', foreign_project);
  exception when insufficient_privilege then refused := true;
  end;
  perform tests.ok(refused, 'a notification cannot name another organization''s project');

  reset role;
  perform set_config('request.jwt.claims', '{}', true);
end;
$$;
rollback;
