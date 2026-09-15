-- Core scoped-access cutover: role, inheritance, parent/child and mutation
-- checks. Run after qa-users.sql and rls.sql. All mutations are rolled back.
begin;

do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  v_volunteer uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
  v_reviewer uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4';
  v_leadership uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5';
  v_org uuid;
  v_other_org uuid;
  v_program uuid;
  v_other_program uuid;
  v_project uuid;
  v_sibling uuid;
  v_other_project uuid;
  v_cross_org_project uuid;
  v_milestone uuid;
  v_sibling_milestone uuid;
  v_task uuid;
  v_task_peer uuid;
  v_task_unlinked uuid;
  v_sibling_task uuid;
  v_checklist uuid;
  v_sibling_checklist uuid;
  v_comment uuid;
  v_sibling_comment uuid;
  v_label uuid;
  v_grant uuid;
  v_duplicate_grant uuid;
  n integer;
begin
  select organization_id into strict v_org
  from public.organization_membership owner_membership
  where owner_membership.user_id = v_owner
    and exists (
      select 1 from public.organization_membership peer
      where peer.organization_id = owner_membership.organization_id
        and peer.user_id = v_reviewer
    );

  -- Use the ordinary non-admin organization role while exercising scoped
  -- reviewer and approver grants below.
  update public.organization_membership
  set role = 'volunteer'
  where organization_id = v_org and user_id = v_reviewer;

  insert into public.program (
    organization_id, name, slug, lead_id, created_by
  ) values (
    v_org, 'Scoped core program',
    'scoped-core-' || substr(gen_random_uuid()::text, 1, 8),
    v_staff, v_owner
  ) returning id into v_program;

  insert into public.program (
    organization_id, name, slug, created_by
  ) values (
    v_org, 'Unrelated scoped program',
    'scoped-unrelated-' || substr(gen_random_uuid()::text, 1, 8), v_owner
  ) returning id into v_other_program;

  insert into public.project (
    organization_id, program_id, name, owner_id, created_by
  ) values (
    v_org, v_program, 'Scoped direct project', v_staff, v_owner
  ) returning id into v_project;
  insert into public.project (
    organization_id, program_id, name, owner_id, created_by
  ) values (
    v_org, v_program, 'Scoped sibling project', v_owner, v_owner
  ) returning id into v_sibling;
  insert into public.project (
    organization_id, program_id, name, owner_id, created_by
  ) values (
    v_org, v_other_program, 'Unrelated scoped project', v_owner, v_owner
  ) returning id into v_other_project;

  insert into public.milestone (project_id, name)
  values (v_project, 'Visible scoped milestone') returning id into v_milestone;
  insert into public.milestone (project_id, name)
  values (v_sibling, 'Hidden sibling milestone') returning id into v_sibling_milestone;

  insert into public.task (
    organization_id, program_id, project_id, milestone_id, title,
    assignee_id, requester_id, reviewer_id, status, created_by
  ) values (
    v_org, v_program, v_project, v_milestone, 'Scoped task',
    v_staff, v_staff, v_reviewer, 'in_review', v_owner
  ) returning id into v_task;
  insert into public.task (
    organization_id, program_id, project_id, milestone_id, title,
    assignee_id, requester_id, status, created_by
  ) values (
    v_org, v_program, v_sibling, v_sibling_milestone, 'Sibling task',
    v_staff, v_staff, 'ready', v_owner
  ) returning id into v_sibling_task;
  insert into public.task (
    organization_id, program_id, project_id, milestone_id, title,
    assignee_id, requester_id, status, created_by
  ) values (
    v_org, v_program, v_project, v_milestone, 'Scoped peer task',
    v_staff, v_staff, 'ready', v_owner
  ) returning id into v_task_peer;
  insert into public.task (
    organization_id, program_id, project_id, milestone_id, title,
    assignee_id, requester_id, status, created_by
  ) values (
    v_org, v_program, v_project, v_milestone, 'Scoped unlinked task',
    v_staff, v_staff, 'ready', v_owner
  ) returning id into v_task_unlinked;
  insert into public.task_dependency (blocking_task_id, blocked_task_id)
  values (v_task, v_task_peer);
  insert into public.task_dependency (blocking_task_id, blocked_task_id)
  values (v_sibling_task, v_task);

  insert into public.checklist_item (task_id, title)
  values (v_task, 'Visible child') returning id into v_checklist;
  insert into public.checklist_item (task_id, title)
  values (v_sibling_task, 'Hidden child') returning id into v_sibling_checklist;
  insert into public.task_comment (task_id, author_id, body)
  values (v_task, v_staff, 'Visible comment') returning id into v_comment;
  insert into public.task_comment (task_id, author_id, body)
  values (v_sibling_task, v_staff, 'Hidden comment') returning id into v_sibling_comment;
  insert into public.label (organization_id, name)
  values (v_org, 'Scoped label ' || substr(gen_random_uuid()::text, 1, 8))
  returning id into v_label;
  insert into public.task_label (task_id, label_id) values (v_task, v_label);
  insert into public.task_label (task_id, label_id) values (v_sibling_task, v_label);

  perform tests.authenticate(v_owner, 'aal1');
  begin
    perform public.set_project_direct_access(
      v_project, v_volunteer, 'contributor'
    );
    raise exception 'FAIL: AAL1 owner changed a direct project grant';
  exception when insufficient_privilege then
    perform tests.ok(true, 'AAL1 owner cannot call direct-grant administration RPCs');
  end;
  reset role;

  perform tests.authenticate(v_owner, 'aal2');
  v_grant := public.set_project_direct_access(
    v_project, v_volunteer, 'contributor'
  );
  perform tests.ok(v_grant is not null, 'AAL2 owner sets a direct project grant atomically');
  v_duplicate_grant := public.set_project_direct_access(
    v_project, v_volunteer, 'contributor'
  );
  perform tests.ok(
    v_duplicate_grant = v_grant,
    'duplicate direct-grant submissions serialize onto one source row'
  );
  v_grant := public.set_project_direct_access(
    v_project, v_reviewer, 'reviewer'
  );
  perform tests.ok(v_grant is not null, 'AAL2 owner sets a typed reviewer grant');
  v_grant := public.set_project_direct_access(
    v_project, v_leadership, 'contributor'
  );
  perform tests.ok(v_grant is not null, 'direct provenance can coexist before leadership restriction');
  v_grant := public.set_program_direct_access(
    v_program, v_staff, 'read_only'
  );
  perform tests.ok(v_grant is not null, 'direct program source coexists with record-lead source');
  perform public.remove_program_direct_access(v_program, v_staff);
  reset role;

  perform tests.ok(
    exists (
      select 1 from public.program_access_grant
      where program_id = v_program and user_id = v_staff and source = 'record_lead'
    ) and not exists (
      select 1 from public.program_access_grant
      where program_id = v_program and user_id = v_staff and source = 'direct'
    ),
    'direct RPC removal preserves independent lead provenance'
  );
  select count(*) into n from public.audit_event
  where object_id = v_grant and action = 'direct_program_access_set';
  perform tests.ok(n = 1, 'successful direct grant mutation writes one audit event');

  perform tests.authenticate(v_volunteer);
  perform tests.ok(
    public.has_project_capability(v_project, 'collaborate')
      and not public.has_project_capability(v_project, 'manage')
      and not public.has_program_capability(v_program, 'read')
      and not public.has_project_capability(v_sibling, 'read')
      and not public.has_project_capability(v_other_project, 'read'),
    'direct project contributor reaches only that project and not its parent or siblings'
  );
  select count(*) into n from public.project
  where id in (v_project, v_sibling, v_other_project);
  perform tests.ok(n = 1, 'project SELECT applies the direct-project boundary');
  select count(*) into n from public.program_membership where program_id = v_program;
  perform tests.ok(n = 0, 'direct project access does not expose parent program membership');
  select count(*) into n from public.milestone
  where id in (v_milestone, v_sibling_milestone);
  perform tests.ok(n = 1, 'milestone visibility follows the accessible parent project');
  select count(*) into n from public.task
  where id in (v_task, v_task_peer, v_task_unlinked, v_sibling_task);
  perform tests.ok(n = 3, 'task visibility follows the accessible parent project');
  select count(*) into n from public.checklist_item
  where id in (v_checklist, v_sibling_checklist);
  perform tests.ok(n = 1, 'checklist visibility follows its task parent');
  select count(*) into n from public.task_comment
  where id in (v_comment, v_sibling_comment);
  perform tests.ok(n = 1, 'comment visibility follows its task parent');
  select count(*) into n from public.task_label
  where task_id in (v_task, v_sibling_task);
  perform tests.ok(n = 1, 'task-label visibility follows its task parent');
  select count(*) into n from public.task_dependency
  where (blocking_task_id = v_task and blocked_task_id = v_task_peer)
     or (blocking_task_id = v_sibling_task and blocked_task_id = v_task);
  perform tests.ok(n = 1, 'dependency visibility requires access to both task parents');

  update public.task set description = 'Contributor update' where id = v_task;
  get diagnostics n = row_count;
  perform tests.ok(n = 1, 'scoped volunteer contributor updates permitted task work');
  insert into public.checklist_item (task_id, title)
  values (v_task, 'Contributor child');
  insert into public.task_comment (task_id, author_id, body)
  values (v_task, v_volunteer, 'Contributor comment');
  perform tests.ok(true, 'scoped contributor collaborates through checklist and comments');
  insert into public.task (
    organization_id, program_id, project_id, milestone_id, title,
    requester_id, status, created_by
  ) values (
    v_org, v_program, v_project, v_milestone, 'Contributor-created task',
    v_volunteer, 'ready', v_volunteer
  );
  perform tests.ok(true, 'scoped contributor creates work inside the assigned project');
  begin
    update public.task set assignee_id = v_volunteer where id = v_task;
    raise exception 'FAIL: contributor changed task authority';
  exception when insufficient_privilege then
    perform tests.ok(true, 'contributor cannot reassign task authority');
  end;
  update public.project set name = name where id = v_project;
  get diagnostics n = row_count;
  perform tests.ok(n = 0, 'project contributor cannot manage the project record');
  begin
    insert into public.milestone (project_id, name)
    values (v_project, 'Contributor must not add milestone');
    raise exception 'FAIL: contributor inserted a milestone';
  exception when insufficient_privilege then
    perform tests.ok(true, 'project contributor cannot mutate management-only milestones');
  end;
  begin
    insert into public.task_dependency (blocking_task_id, blocked_task_id)
    values (v_task_peer, v_task_unlinked);
    raise exception 'FAIL: contributor inserted a task dependency';
  exception when insufficient_privilege then
    perform tests.ok(true, 'project contributor cannot mutate management-only dependencies');
  end;
  begin
    insert into public.project_status_update (
      project_id, author_id, health, progress_summary
    ) values (
      v_project, v_volunteer, 'on_track', 'Contributor status update'
    );
    raise exception 'FAIL: contributor published a management status update';
  exception when insufficient_privilege then
    perform tests.ok(true, 'project contributor cannot publish management status updates');
  end;
  reset role;

  perform tests.authenticate(v_owner, 'aal2');
  perform public.remove_project_direct_access(v_project, v_volunteer);
  reset role;
  perform tests.authenticate(v_volunteer);
  perform tests.ok(
    not public.has_project_capability(v_project, 'read'),
    'direct project removal revokes that source without retaining accidental scope'
  );
  reset role;

  perform tests.authenticate(v_staff);
  perform tests.ok(
    public.has_program_capability(v_program, 'manage')
      and public.has_project_capability(v_project, 'manage')
      and public.has_project_capability(v_sibling, 'manage')
      and not public.has_project_capability(v_other_project, 'read'),
    'program lead inherits management across that program only'
  );
  insert into public.project (
    organization_id, program_id, name, owner_id, created_by
  ) values (
    v_org, v_program, 'Lead-created project', v_staff, v_staff
  );
  insert into public.milestone (project_id, name)
  values (v_sibling, 'Lead milestone');
  insert into public.project_status_update (
    project_id, author_id, health, progress_summary
  ) values (
    v_project, v_staff, 'on_track', 'Scoped lead update'
  );
  insert into public.program_membership (program_id, user_id, role)
  values (v_program, v_reviewer, 'reviewer');
  perform tests.ok(true, 'program lead manages projects, milestones, status, and membership');
  reset role;

  perform tests.authenticate(v_reviewer);
  perform tests.ok(
    public.has_project_capability(v_project, 'review')
      and public.has_project_capability(v_sibling, 'review')
      and not public.has_project_capability(v_project, 'manage')
      and not public.has_project_capability(v_other_project, 'read'),
    'program membership is inherited by every project without unrelated access'
  );
  begin
    update public.task set title = 'Reviewer rewrite' where id = v_task;
    raise exception 'FAIL: reviewer rewrote task content';
  exception when insufficient_privilege then
    perform tests.ok(true, 'reviewer cannot rewrite ordinary task content');
  end;
  update public.task
  set status = 'completed', completed_at = now()
  where id = v_task;
  get diagnostics n = row_count;
  perform tests.ok(n = 1, 'reviewer performs the relevant in-review decision');
  begin
    insert into public.checklist_item (task_id, title)
    values (v_task, 'Reviewer must not edit work');
    raise exception 'FAIL: reviewer edited checklist work';
  exception when insufficient_privilege then
    perform tests.ok(true, 'reviewer cannot edit contributor checklist work');
  end;
  reset role;

  -- Remove inherited reviewer provenance, then verify a project-only approver.
  perform tests.authenticate(v_staff);
  delete from public.program_membership
  where program_id = v_program and user_id = v_reviewer;
  reset role;
  perform tests.authenticate(v_owner, 'aal2');
  perform public.set_project_direct_access(v_project, v_reviewer, 'approver');
  reset role;
  update public.task set status = 'in_review', completed_at = null where id = v_task;
  perform tests.authenticate(v_reviewer);
  perform tests.ok(
    public.has_project_capability(v_project, 'approve')
      and not public.has_project_capability(v_sibling, 'read'),
    'project approver has only the directly assigned project action scope'
  );
  update public.task
  set status = 'completed', completed_at = now()
  where id = v_task;
  get diagnostics n = row_count;
  perform tests.ok(n = 1, 'approver performs the relevant task approval action');
  reset role;

  update public.organization_membership
  set role = 'leadership_viewer'
  where organization_id = v_org and user_id = v_leadership;
  perform tests.authenticate(v_leadership);
  perform tests.ok(
    public.has_program_capability(v_program, 'read')
      and public.has_project_capability(v_sibling, 'read')
      and public.has_task_capability(v_sibling_task, 'read')
      and not public.has_project_capability(v_project, 'collaborate')
      and not public.has_task_capability(v_task, 'review'),
    'leadership viewer remains portfolio read-only despite a stronger direct grant'
  );
  update public.task set description = 'Leadership write' where id = v_task;
  get diagnostics n = row_count;
  perform tests.ok(n = 0, 'leadership viewer cannot update task work');
  begin
    insert into public.task_comment (task_id, author_id, body)
    values (v_task, v_leadership, 'Leadership write');
    raise exception 'FAIL: leadership viewer wrote a task comment';
  exception when insufficient_privilege then
    perform tests.ok(true, 'leadership viewer cannot add operational comments');
  end;
  reset role;

  insert into public.organization (name, slug)
  values (
    'Scoped core foreign organization',
    'scoped-core-foreign-' || substr(gen_random_uuid()::text, 1, 8)
  ) returning id into v_other_org;
  insert into public.program (organization_id, name, slug, created_by)
  values (
    v_other_org, 'Foreign program',
    'foreign-' || substr(gen_random_uuid()::text, 1, 8), v_owner
  ) returning id into v_other_program;
  insert into public.project (
    organization_id, program_id, name, created_by
  ) values (
    v_other_org, v_other_program, 'Foreign project', v_owner
  ) returning id into v_cross_org_project;

  perform tests.authenticate(v_volunteer);
  select count(*) into n from public.project where id = v_cross_org_project;
  perform tests.ok(n = 0, 'scoped access never crosses organization boundaries');
  reset role;

  perform tests.authenticate(v_owner, 'aal2');
  begin
    perform public.set_project_direct_access(
      v_cross_org_project, v_volunteer, 'read_only'
    );
    raise exception 'FAIL: administrator granted access outside their organization';
  exception when insufficient_privilege then
    perform tests.ok(true, 'direct-grant RPC rejects a cross-organization administrator');
  end;
  reset role;
end;
$$;

rollback;
