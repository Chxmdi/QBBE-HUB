-- Rows a member writes into the audit trail, the activity feed, the workflow
-- history and message mentions are attributed to that member and stamped
-- with the time of writing. A member cannot write one in someone else's name,
-- backdate one, or add mentions to someone else's message.
begin;
do $$
declare
  owner_user uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  staff_user uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  volunteer_user uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
  guest_user uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5';
  writer uuid;
  org uuid;
  owner_message uuid;
  refused boolean;
  n int;
  stamped timestamptz;
begin
  reset role;
  perform set_config('request.jwt.claims', '{}', true);
  select organization_id into strict org
  from public.organization_membership where user_id = owner_user;
  select c.id into strict owner_message from public.channel c
  where c.organization_id = org and c.name = 'General' limit 1;
  insert into public.message (organization_id, channel_id, author_id, body)
  values (org, owner_message, owner_user, 'Owner message for audit-forgery')
  returning id into owner_message;

  foreach writer in array array[guest_user, volunteer_user, staff_user] loop
    reset role;
    perform tests.authenticate(writer, 'aal1');
    set local role authenticated;

    refused := false;
    begin
      insert into public.audit_event (organization_id, actor_id, actor_type, event_type, action, object_type, object_id, metadata)
      values (org, owner_user, 'user', 'data_export', 'export_downloaded', 'export_job', gen_random_uuid(), '{"note":"forged"}');
    exception when insufficient_privilege then refused := true;
    end;
    perform tests.ok(refused, format('%s cannot write an audit entry in the owner''s name', writer));

    refused := false;
    begin
      insert into public.audit_event (organization_id, actor_id, actor_type, event_type, action)
      values (org, writer, 'system', 'ledger', 'accountant_granted');
    exception when insufficient_privilege then refused := true;
    end;
    perform tests.ok(refused, format('%s cannot write an audit entry as the system', writer));

    refused := false;
    begin
      insert into public.audit_event (organization_id, event_type, action)
      values (org, 'ledger', 'accountant_granted');
    exception when insufficient_privilege then refused := true;
    end;
    perform tests.ok(refused, format('%s cannot write an unattributed audit entry', writer));

    refused := false;
    begin
      insert into public.activity_event (organization_id, actor_id, verb, source_type, source_id, summary)
      values (org, owner_user, 'closed', 'project', gen_random_uuid(), 'closed the project');
    exception when insufficient_privilege then refused := true;
    end;
    perform tests.ok(refused, format('%s cannot write an activity entry in the owner''s name', writer));

    refused := false;
    begin
      insert into public.workflow_execution (organization_id, rule_name, trigger_event, source_type, source_id, outcome, actor_kind, actor_id)
      values (org, 'Forged', 'task.created', 'task', gen_random_uuid(), 'notified', 'person', owner_user::text);
    exception when insufficient_privilege then refused := true;
    end;
    perform tests.ok(refused, format('%s cannot write workflow history in the owner''s name', writer));

    refused := false;
    begin
      insert into public.workflow_execution (organization_id, rule_name, trigger_event, source_type, source_id, outcome, engine)
      values (org, 'Forged', 'task.created', 'task', gen_random_uuid(), 'succeeded', 'graph_v2');
    exception when insufficient_privilege then refused := true;
    end;
    perform tests.ok(refused, format('%s cannot write a graph workflow run', writer));

    refused := false;
    begin
      insert into public.workflow_execution (organization_id, rule_name, trigger_event, source_type, source_id, outcome, payload)
      values (org, 'Forged', 'task.created', 'task', gen_random_uuid(), 'failed',
        jsonb_build_array(jsonb_build_object('user_id', owner_user, 'organization_id', org, 'category', 'security',
          'reason', 'workflow', 'title', 'Verify your account', 'link', '/settings', 'dedupe_key', 'x')));
    exception when insufficient_privilege then refused := true;
    end;
    perform tests.ok(refused, format('%s cannot store a forged notification for the retry job', writer));

    refused := false;
    begin
      insert into public.workflow_execution (organization_id, rule_name, trigger_event, source_type, source_id, outcome, started_at)
      values (org, 'Forged', 'task.created', 'task', gen_random_uuid(), 'notified', now() - interval '1 year');
    exception when insufficient_privilege then refused := true;
    end;
    perform tests.ok(refused, format('%s cannot backdate a workflow run', writer));

    refused := false;
    begin
      insert into public.workflow_execution (organization_id, rule_name, trigger_event, source_type, source_id, outcome, trigger_event_id)
      values (org, 'Forged', 'task.created', 'task', gen_random_uuid(), 'notified', gen_random_uuid());
    exception when insufficient_privilege then refused := true;
    end;
    perform tests.ok(refused, format('%s cannot claim a trigger event ahead of the server', writer));

    refused := false;
    begin
      insert into public.workflow_execution (organization_id, rule_name, trigger_event, source_type, source_id, outcome, resume_at)
      values (org, 'Forged', 'task.created', 'task', gen_random_uuid(), 'waiting', now());
    exception when insufficient_privilege or check_violation then refused := true;
    end;
    perform tests.ok(refused, format('%s cannot create a paused run', writer));
  end loop;

  -- Staff can read the owner's message in General, but it is not theirs.
  reset role;
  perform tests.authenticate(staff_user, 'aal1');
  set local role authenticated;
  refused := false;
  begin
    insert into public.message_mention (message_id, mentioned_user_id) values (owner_message, guest_user);
  exception when insufficient_privilege then refused := true;
  end;
  perform tests.ok(refused, 'a member cannot add mentions to someone else''s message');

  -- What the app writes still works, and the time is the time of writing.
  -- Audit entries go through record_audit_event: a direct insert, even in
  -- the member's own name, is refused.
  refused := false;
  begin
    insert into public.audit_event (organization_id, actor_id, event_type, action, object_type, created_at)
    values (org, staff_user, 'data_export', 'page_exported', 'page', now() - interval '90 days');
  exception when insufficient_privilege then refused := true;
  end;
  perform tests.ok(refused, 'a member cannot insert an audit entry directly');
  perform tests.ok(public.record_audit_event(org, 'data_export', 'page_exported', 'page', gen_random_uuid(), '{}') is not null,
    'a member can record an audit entry in their own name');

  insert into public.activity_event (organization_id, actor_id, verb, source_type, source_id, summary, created_at)
  values (org, staff_user, 'created', 'milestone', gen_random_uuid(), 'added milestone', now() - interval '90 days');
  get diagnostics n = row_count;
  perform tests.ok(n = 1, 'a member can write an activity entry in their own name');

  insert into public.workflow_execution (organization_id, rule_name, trigger_event, source_type, source_id, outcome, recipient_count)
  values (org, 'Assign rule', 'task.created', 'task', gen_random_uuid(), 'notified', 1);
  get diagnostics n = row_count;
  perform tests.ok(n = 1, 'a member can still record a rule run (no actor)');

  insert into public.workflow_execution (organization_id, rule_name, trigger_event, source_type, source_id, outcome, recipient_count, detail, payload)
  values (org, 'Assign rule', 'task.created', 'task', gen_random_uuid(), 'failed', 1, 'Notification failed.',
    jsonb_build_array(jsonb_build_object('user_id', guest_user, 'organization_id', org, 'category', 'assignment',
      'reason', 'workflow', 'urgency', 'normal', 'title', 'Workflow: x', 'link', '/my-work?task=1', 'dedupe_key', 'k')));
  get diagnostics n = row_count;
  perform tests.ok(n = 1, 'a member can still store the retry drafts the rule runtime writes');

  reset role;
  select created_at into stamped from public.audit_event
  where actor_id = staff_user and action = 'page_exported' order by created_at desc limit 1;
  perform tests.ok(stamped > now() - interval '1 minute', 'a member cannot backdate an audit entry');
  select created_at into stamped from public.activity_event
  where actor_id = staff_user and summary = 'added milestone' order by created_at desc limit 1;
  perform tests.ok(stamped > now() - interval '1 minute', 'a member cannot backdate an activity entry');

  perform tests.authenticate(owner_user, 'aal2');
  set local role authenticated;
  insert into public.message_mention (message_id, mentioned_user_id) values (owner_message, staff_user);
  get diagnostics n = row_count;
  perform tests.ok(n = 1, 'a message author can record mentions on their own message');

  -- Server code keeps writing system entries and past timestamps.
  reset role;
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  set local role service_role;
  insert into public.audit_event (organization_id, actor_type, event_type, action, created_at)
  values (org, 'system', 'retention', 'purged', now() - interval '1 day');
  get diagnostics n = row_count;
  reset role;
  perform set_config('request.jwt.claims', '{}', true);
  perform tests.ok(n = 1, 'the service role can still write a system audit entry');
  select count(*) into n from public.audit_event
  where actor_type = 'system' and action = 'purged' and created_at < now() - interval '12 hours';
  perform tests.ok(n = 1, 'the service role keeps the time it gives');
end;
$$;
rollback;
