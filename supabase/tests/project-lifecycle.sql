-- Intake decisions, closure evidence and template expansion (#27).
--
-- Three things this pins that nothing else did:
--
--   1. A returned request can be clarified by its author, and an author still
--      cannot move their own request to a status only a reviewer may set. The
--      old policy got both halves wrong in opposite directions.
--   2. Deferring and returning are decisions the database demands attribution
--      for. The first version of the command set decided_by to null for both,
--      which the CHECK refuses — so "Deferred" simply did not work.
--   3. Closure evidence follows the project's own access, and cannot name a
--      document belonging to a different project.
--
-- Run after qa-users.sql and rls.sql. All mutations are rolled back.

-- Intake decisions (P1-PRJ-07).
begin;

do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  v_volunteer uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
  v_org uuid;
  v_request uuid;
  n integer;
  failed boolean;
begin
  select organization_id into strict v_org
  from public.organization_membership where user_id = v_owner limit 1;

  -- A volunteer proposes something, as themselves. That is what intake is for.
  perform tests.authenticate(v_volunteer);
  insert into public.project_request (organization_id, title, summary, requested_by)
  values (v_org, 'Saturday homework club', 'Weekly drop-in for grade 6-8.', v_volunteer)
  returning id into v_request;
  perform tests.ok(v_request is not null, 'a volunteer can submit a project request');

  -- An author may not move their own request to a reviewer-only status. The
  -- old WITH CHECK tested ownership alone, so this silently succeeded and the
  -- queue showed a request reviewing itself. A WITH CHECK failure raises
  -- rather than skipping the row, so this is caught rather than counted.
  failed := false;
  begin
    update public.project_request set status = 'in_review' where id = v_request;
  exception when others then
    failed := true;
  end;
  perform tests.ok(failed, 'an author cannot put their own request in review');

  failed := false;
  begin
    update public.project_request
    set status = 'deferred', decision_note = 'Later.',
        decided_by = v_volunteer, decided_at = now()
    where id = v_request;
  exception when others then
    failed := true;
  end;
  perform tests.ok(failed, 'an author cannot defer their own request');

  -- Deferring and returning are decisions, and the database insists on a
  -- decider and a date for both.
  perform tests.clear_auth();
  reset role;
  failed := false;
  begin
    update public.project_request
    set status = 'returned', decision_note = 'Which school?'
    where id = v_request;
  exception when others then
    failed := true;
  end;
  perform tests.ok(failed,
    'a returned request cannot be written without recording who returned it');

  update public.project_request
  set status = 'returned', decision_note = 'Which school, and how many places?',
      decided_by = v_staff, decided_at = now()
  where id = v_request;
  get diagnostics n = row_count;
  perform tests.ok(n = 1, 'returning a request with an attributed decision is accepted');

  -- The whole point of "returned for clarification": the author can answer.
  -- Under the old policy the edit window closed at 'submitted' and this row
  -- count was 0, which made the status a label on a dead end.
  perform tests.authenticate(v_volunteer);
  update public.project_request
  set summary = 'Weekly drop-in at Parkdale PS, 20 places.'
  where id = v_request;
  get diagnostics n = row_count;
  perform tests.ok(n = 1, 'the author of a returned request can clarify it');

  -- Answering it puts it back in the queue, decision cleared.
  update public.project_request
  set status = 'submitted', decided_by = null, decided_at = null
  where id = v_request;
  get diagnostics n = row_count;
  perform tests.ok(n = 1, 'the author can resubmit a returned request');

  -- Withdrawing your own proposal stays open to you, with a reason.
  update public.project_request
  set status = 'withdrawn', decision_note = 'Covered by the tutoring program.',
      decided_by = v_volunteer, decided_at = now()
  where id = v_request;
  get diagnostics n = row_count;
  perform tests.ok(n = 1, 'an author can withdraw their own request');

  -- Somebody else's request is not yours to touch. qa-staff is staff, so the
  -- deny case has to be a second volunteer-level identity: use the request
  -- owner check directly by authenticating as the owner, who is not staff of
  -- this row by authorship.
  perform tests.clear_auth();
  reset role;
  insert into public.project_request (organization_id, title, summary, requested_by)
  values (v_org, 'Somebody else''s idea', 'Not the volunteer''s.', v_staff)
  returning id into v_request;

  perform tests.authenticate(v_volunteer);
  select count(*) into n from public.project_request where id = v_request;
  perform tests.ok(n = 0,
    'a volunteer cannot even read a request somebody else submitted');

  update public.project_request set summary = 'Hijacked.' where id = v_request;
  get diagnostics n = row_count;
  perform tests.ok(n = 0, 'a volunteer cannot edit a request somebody else submitted');

  -- Staff run the queue, which is the policy the whole surface depends on.
  perform tests.authenticate(v_staff);
  update public.project_request
  set status = 'deferred', decision_note = 'Revisit after the fall intake.',
      decided_by = v_staff, decided_at = now()
  where id = v_request;
  get diagnostics n = row_count;
  perform tests.ok(n = 1, 'staff can defer a request in the queue');

  perform tests.clear_auth();
  reset role;
end $$;

rollback;

-- Who runs the queue, once a request names a program (P1-PRJ-07).
begin;

do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  v_org uuid;
  v_led uuid;
  v_unled uuid;
  v_request_led uuid;
  v_request_unled uuid;
  n integer;
begin
  select organization_id into strict v_org
  from public.organization_membership where user_id = v_owner limit 1;

  -- One program this staff member leads, one they hold nothing on.
  insert into public.program (organization_id, name, slug, lead_id, created_by)
  values (v_org, 'Intake led program',
          'intake-led-' || substr(gen_random_uuid()::text, 1, 8), v_staff, v_owner)
  returning id into v_led;

  insert into public.program (organization_id, name, slug, created_by)
  values (v_org, 'Intake unled program',
          'intake-unled-' || substr(gen_random_uuid()::text, 1, 8), v_owner)
  returning id into v_unled;

  insert into public.project_request
    (organization_id, title, summary, requested_by, program_id)
  values (v_org, 'Into my program', 'Mine to decide.', v_owner, v_led)
  returning id into v_request_led;

  insert into public.project_request
    (organization_id, title, summary, requested_by, program_id)
  values (v_org, 'Into somebody else''s program', 'Not mine to decide.', v_owner, v_unled)
  returning id into v_request_unled;

  -- Triage still sees everything: a request that silently vanishes from the
  -- queue is worse than one that refuses a decision with a reason.
  perform tests.authenticate(v_staff);
  select count(*) into n from public.project_request
  where id in (v_request_led, v_request_unled);
  perform tests.ok(n = 2, 'staff can still read the whole intake queue');

  update public.project_request
  set status = 'deferred', decision_note = 'After the fall intake.',
      decided_by = v_staff, decided_at = now()
  where id = v_request_led;
  get diagnostics n = row_count;
  perform tests.ok(n = 1, 'a program lead can decide a request naming their program');

  -- Approving creates a real project inside that program, which is why the
  -- broad staff predicate was the wrong bar here.
  update public.project_request
  set status = 'deferred', decision_note = 'Not mine.',
      decided_by = v_staff, decided_at = now()
  where id = v_request_unled;
  get diagnostics n = row_count;
  perform tests.ok(n = 0,
    'staff cannot decide a request naming a program they hold nothing on');

  perform tests.clear_auth();
  reset role;
end $$;

rollback;

-- Closure evidence (P1-PRJ-08).
begin;

do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  v_volunteer uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
  v_org uuid;
  v_project uuid;
  v_other_project uuid;
  v_closure uuid;
  v_document uuid;
  v_foreign_document uuid;
  n integer;
  failed boolean;
begin
  select organization_id into strict v_org
  from public.organization_membership where user_id = v_owner limit 1;

  insert into public.project (organization_id, name, owner_id, created_by)
  values (v_org, 'Closure evidence project', v_staff, v_owner)
  returning id into v_project;

  insert into public.project (organization_id, name, owner_id, created_by)
  values (v_org, 'Unrelated project', v_staff, v_owner)
  returning id into v_other_project;

  insert into public.document (organization_id, title, kind, url, project_id, created_by)
  values (v_org, 'Final report', 'link', 'https://example.org/report', v_project, v_owner)
  returning id into v_document;

  insert into public.document (organization_id, title, kind, url, project_id, created_by)
  values (v_org, 'Someone else''s report', 'link', 'https://example.org/other',
          v_other_project, v_owner)
  returning id into v_foreign_document;

  -- The project owner holds `manage` through the record_owner grant, which is
  -- what the closure policy asks for.
  perform tests.authenticate(v_staff);
  insert into public.project_closure (
    organization_id, project_id, results, evidence_links, closed_by
  ) values (
    v_org, v_project, 'Served 48 families over 12 weeks.',
    '[{"label": "Report", "url": "https://example.org/report"}]'::jsonb, v_staff
  ) returning id into v_closure;
  perform tests.ok(v_closure is not null, 'a project manager can record a closure');

  -- One closure per project: closing a reopened project replaces the record
  -- rather than accumulating contradictory ones.
  failed := false;
  begin
    insert into public.project_closure (organization_id, project_id, results, closed_by)
    values (v_org, v_project, 'A second, different story.', v_staff);
  exception when others then
    failed := true;
  end;
  perform tests.ok(failed, 'a project cannot carry two closure records');

  -- Evidence has to be evidence for this project.
  insert into public.project_closure_document (closure_id, document_id)
  values (v_closure, v_document);
  perform tests.ok(true, 'a document filed against the project can be attached as evidence');

  failed := false;
  begin
    insert into public.project_closure_document (closure_id, document_id)
    values (v_closure, v_foreign_document);
  exception when others then
    failed := true;
  end;
  perform tests.ok(failed,
    'closure evidence cannot name a document belonging to another project');

  -- Anyone who can read the project can read how it ended.
  perform tests.authenticate(v_owner);
  select count(*) into n from public.project_closure where id = v_closure;
  perform tests.ok(n = 1, 'an owner can read a project''s closure record');

  select count(*) into n from public.project_closure_document where closure_id = v_closure;
  perform tests.ok(n = 1, 'an owner can read the closure''s evidence list');

  -- Someone with no access to the project sees neither.
  perform tests.authenticate(v_volunteer);
  select count(*) into n from public.project_closure where id = v_closure;
  perform tests.ok(n = 0, 'a volunteer cannot read the closure of a project they cannot see');

  select count(*) into n from public.project_closure_document where closure_id = v_closure;
  perform tests.ok(n = 0, 'a volunteer cannot enumerate closure evidence');

  update public.project_closure set results = 'Rewritten.' where id = v_closure;
  get diagnostics n = row_count;
  perform tests.ok(n = 0, 'a volunteer cannot rewrite what a project delivered');

  -- The links column is a list, so a reader never has to guess its shape.
  perform tests.clear_auth();
  reset role;
  failed := false;
  begin
    update public.project_closure set evidence_links = '"not a list"'::jsonb
    where id = v_closure;
  exception when others then
    failed := true;
  end;
  perform tests.ok(failed, 'closure evidence links must be a list');

  perform tests.clear_auth();
  reset role;
end $$;

rollback;

-- Duplication from a template (P1-PRJ-09).
begin;

do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  v_volunteer uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
  v_org uuid;
  v_template uuid;
  n integer;
begin
  select organization_id into strict v_org
  from public.organization_membership where user_id = v_owner limit 1;

  insert into public.project_template (organization_id, name, outcome, created_by)
  values (v_org, 'Workshop series', 'Six sessions delivered.', v_owner)
  returning id into v_template;

  -- Staff define the structure a template reproduces.
  perform tests.authenticate(v_staff);
  insert into public.project_template_item
    (project_template_id, kind, name, day_offset, sort_key)
  values (v_template, 'milestone', 'Venue confirmed', 7, 0),
         (v_template, 'task', 'Book the room', 1, 1),
         (v_template, 'task', 'Recruit facilitators', null, 2);
  select count(*) into n from public.project_template_item
  where project_template_id = v_template;
  perform tests.ok(n = 3, 'staff can define a project template''s structure');

  -- A member may read it — that is how they decide to use it — but not change
  -- what everybody else's projects will be built from.
  perform tests.authenticate(v_volunteer);
  select count(*) into n from public.project_template_item
  where project_template_id = v_template;
  perform tests.ok(n = 3, 'a member can read a project template''s structure');

  update public.project_template_item set name = 'Hijacked' where project_template_id = v_template;
  get diagnostics n = row_count;
  perform tests.ok(n = 0, 'a volunteer cannot rewrite a project template''s structure');

  delete from public.project_template_item where project_template_id = v_template;
  get diagnostics n = row_count;
  perform tests.ok(n = 0, 'a volunteer cannot delete a project template''s structure');

  -- The template carries no comments, notes or history to copy. This is the
  -- P1-PRJ-09 property, and it holds because of the shape of the table rather
  -- than because of a filter somewhere that could be removed.
  perform tests.clear_auth();
  reset role;
  select count(*) into n
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'project_template_item'
    and column_name in ('comment', 'note', 'activity', 'created_by');
  perform tests.ok(n = 0,
    'a project template item stores no comments, notes or authorship to copy forward');

  perform tests.clear_auth();
  reset role;
end $$;

rollback;

-- Milestones: status, evidence and order (#28, P0-MIL-01).
begin;

do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  v_volunteer uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
  v_org uuid;
  v_project uuid;
  v_other_project uuid;
  v_first uuid;
  v_second uuid;
  v_third uuid;
  v_task uuid;
  v_status text;
  v_completed timestamptz;
  v_sort double precision;
  n integer;
  failed boolean;
begin
  select organization_id into strict v_org
  from public.organization_membership where user_id = v_owner limit 1;

  insert into public.project (organization_id, name, owner_id, created_by)
  values (v_org, 'Milestone project', v_staff, v_owner)
  returning id into v_project;

  insert into public.project (organization_id, name, owner_id, created_by)
  values (v_org, 'Other milestone project', v_staff, v_owner)
  returning id into v_other_project;

  -- Ordering. Every milestone created through the application landed on the
  -- default 0, so "ordered milestones" ordered by nothing. A new one now goes
  -- to the end of its own project, counting nobody else's.
  insert into public.milestone (project_id, name) values (v_project, 'First')
  returning id into v_first;
  insert into public.milestone (project_id, name) values (v_project, 'Second')
  returning id into v_second;
  insert into public.milestone (project_id, name) values (v_other_project, 'Elsewhere');

  select sort_key into v_sort from public.milestone where id = v_first;
  perform tests.ok(v_sort = 1, 'the first milestone in a project takes position 1');
  select sort_key into v_sort from public.milestone where id = v_second;
  perform tests.ok(v_sort = 2, 'the next milestone goes to the end of its own project');
  select sort_key into v_sort from public.milestone where name = 'Elsewhere';
  perform tests.ok(v_sort = 1,
    'positions are counted per project, not across the organization');

  -- An explicit position is honoured: template expansion and the seed both
  -- choose their own.
  insert into public.milestone (project_id, name, sort_key)
  values (v_project, 'Third', 9)
  returning id into v_third;
  select sort_key into v_sort from public.milestone where id = v_third;
  perform tests.ok(v_sort = 9, 'an explicitly positioned milestone keeps its position');

  -- Completion has two representations. They are now one fact.
  update public.milestone
  set completed_at = now(), evidence = 'Signed contract on file.'
  where id = v_first;
  select status, completed_at into v_status, v_completed
  from public.milestone where id = v_first;
  perform tests.ok(v_status = 'completed',
    'setting completed_at moves the status to completed');

  update public.milestone set completed_at = null, evidence = null where id = v_first;
  select status, completed_at into v_status, v_completed
  from public.milestone where id = v_first;
  perform tests.ok(v_status = 'planned' and v_completed is null,
    'clearing completed_at reopens the milestone');

  -- ...and from the other side, so a caller that only knows about `status`
  -- leaves the row just as consistent.
  update public.milestone
  set status = 'completed', evidence = 'Attendance sheet, 48 families.'
  where id = v_second;
  select status, completed_at into v_status, v_completed
  from public.milestone where id = v_second;
  perform tests.ok(v_completed is not null,
    'setting the status to completed stamps completed_at');

  update public.milestone set status = 'planned', evidence = null where id = v_second;
  select completed_at into v_completed from public.milestone where id = v_second;
  perform tests.ok(v_completed is null,
    'moving the status off completed clears completed_at');

  -- Completing with nothing to show for it is refused by the database, not
  -- only by the form. This is the issue's definition of done.
  failed := false;
  begin
    update public.milestone set completed_at = now() where id = v_first;
  exception when others then
    failed := true;
  end;
  perform tests.ok(failed, 'a milestone cannot be completed without evidence');

  failed := false;
  begin
    update public.milestone
    set completed_at = now(), evidence = '   '
    where id = v_first;
  exception when others then
    failed := true;
  end;
  perform tests.ok(failed, 'whitespace is not evidence');

  -- An unknown status would render as nothing anywhere.
  failed := false;
  begin
    update public.milestone set status = 'done' where id = v_first;
  exception when others then
    failed := true;
  end;
  perform tests.ok(failed, 'a milestone status outside the four is refused');

  -- Deleting a milestone keeps the work and drops only the grouping.
  insert into public.task (organization_id, project_id, milestone_id, title, created_by)
  values (v_org, v_project, v_third, 'Work under a milestone', v_owner)
  returning id into v_task;

  delete from public.milestone where id = v_third;
  select count(*) into n from public.task where id = v_task and milestone_id is null;
  perform tests.ok(n = 1,
    'deleting a milestone keeps its tasks and only removes the grouping');

  -- Reading is project access; writing is managing the project.
  perform tests.authenticate(v_volunteer);
  select count(*) into n from public.milestone where project_id = v_project;
  perform tests.ok(n = 0,
    'a volunteer cannot read the milestones of a project they cannot see');

  -- An insert the policy refuses raises rather than skipping a row, so this is
  -- caught rather than counted.
  failed := false;
  begin
    insert into public.milestone (project_id, name) values (v_project, 'Smuggled');
  exception when others then
    failed := true;
  end;
  perform tests.ok(failed, 'a volunteer cannot add a milestone to a project');

  update public.milestone set name = 'Hijacked' where id = v_first;
  get diagnostics n = row_count;
  perform tests.ok(n = 0, 'a volunteer cannot rename a milestone');

  delete from public.milestone where id = v_first;
  get diagnostics n = row_count;
  perform tests.ok(n = 0, 'a volunteer cannot delete a milestone');

  perform tests.authenticate(v_staff);
  update public.milestone set name = 'Renamed by the project owner' where id = v_first;
  get diagnostics n = row_count;
  perform tests.ok(n = 1, 'the project owner can rename a milestone');

  delete from public.milestone where id = v_first;
  get diagnostics n = row_count;
  perform tests.ok(n = 1, 'the project owner can delete a milestone');

  perform tests.clear_auth();
  reset role;
end $$;

rollback;
