-- Rows members write into the audit trail, the activity feed, the workflow
-- history and message mentions.
--
-- Each insert policy only checked that the writer belonged to the
-- organization, so a member (a guest included) could write an audit or
-- activity entry naming someone else as the actor, as the system, or with a
-- past date, and could add mentions to another person's message. The audit
-- trail is the record of who opened or downloaded personal data, so its
-- entries must say who really wrote them and when.
--
-- Now a member's row must name the member as its actor, and the time is the
-- time of writing. Server code (the service role and definer functions) is
-- not bound by these policies and keeps writing system entries.

-- The time a member's row was written is the time it was written. Applies to
-- the API roles only; definer functions and the service role keep theirs.
create or replace function app.stamp_member_written_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon') then
    new.created_at := now();
  end if;
  return new;
end;
$$;

revoke all on function app.stamp_member_written_at() from public, anon, authenticated;

drop trigger if exists audit_event_stamp_written_at on public.audit_event;
create trigger audit_event_stamp_written_at
  before insert on public.audit_event
  for each row execute function app.stamp_member_written_at();

drop trigger if exists activity_event_stamp_written_at on public.activity_event;
create trigger activity_event_stamp_written_at
  before insert on public.activity_event
  for each row execute function app.stamp_member_written_at();

drop trigger if exists workflow_execution_stamp_written_at on public.workflow_execution;
create trigger workflow_execution_stamp_written_at
  before insert on public.workflow_execution
  for each row execute function app.stamp_member_written_at();

drop trigger if exists message_mention_stamp_written_at on public.message_mention;
create trigger message_mention_stamp_written_at
  before insert on public.message_mention
  for each row execute function app.stamp_member_written_at();

drop policy if exists audit_member_insert on public.audit_event;
create policy audit_member_insert on public.audit_event
  for insert to authenticated
  with check (
    organization_id is not null
    and app.is_org_member(organization_id)
    and actor_id = (select auth.uid())
    and actor_type = 'user'
  );

drop policy if exists activity_member_insert on public.activity_event;
create policy activity_member_insert on public.activity_event
  for insert to authenticated
  with check (
    app.is_org_member(organization_id)
    and actor_id = (select auth.uid())
  );

-- The notification drafts a member may store on a failed rule run for the
-- retry job, which replays them with the service role. Only what the rule
-- runtime writes is accepted: workflow assignment notifications, in this
-- organization, for its active members, with in-app links.
create or replace function app.is_member_workflow_payload(p_organization uuid, p_payload jsonb)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_payload is null or (
    jsonb_typeof(p_payload) = 'array'
    and not exists (
      select 1 from jsonb_array_elements(p_payload) d
      where jsonb_typeof(d) <> 'object'
        or d->>'organization_id' is distinct from p_organization::text
        or d->>'category' is distinct from 'assignment'
        or d->>'reason' is distinct from 'workflow'
        or coalesce(d->>'urgency', 'normal') <> 'normal'
        or (d->>'link' is not null and not app.is_in_app_link(d->>'link'))
        or not exists (
          select 1 from public.organization_membership m
          where m.organization_id = p_organization
            and m.user_id::text = d->>'user_id'
            and m.status = 'active'
        )
    )
  );
$$;

revoke all on function app.is_member_workflow_payload(uuid, jsonb) from public, anon;
grant execute on function app.is_member_workflow_payload(uuid, jsonb) to authenticated, service_role;

-- Members record only the simple rule runs (rules_v1) their own actions
-- trigger: a finished outcome for a rule of their organization, either
-- unattributed (as the app writes them) or attributed to themselves, with
-- none of the run-control columns the server uses to schedule, resume or
-- deduplicate runs. Graph runs, test runs and runs in someone else's name
-- come only from server code.
drop policy if exists workflow_execution_member_insert on public.workflow_execution;
create policy workflow_execution_member_insert on public.workflow_execution
  for insert to authenticated
  with check (
    app.is_org_member(organization_id)
    and engine = 'rules_v1'
    and not is_test
    and outcome in ('notified', 'skipped', 'failed')
    and attempt = 0
    and (
      (actor_kind is null and actor_id is null)
      or (actor_kind = 'person' and actor_id = (select auth.uid())::text)
    )
    and (
      rule_id is null
      or exists (
        select 1 from public.workflow_rule r
        where r.id = rule_id and r.organization_id = workflow_execution.organization_id
      )
    )
    and trigger_event_id is null
    and trigger_payload is null
    and started_at is null
    and finished_at is null
    and resume_step_id is null
    and resume_attempt is null
    and resume_at is null
    and run_state is null
    and retry_of is null
    and parent_execution_id is null
    and waiting_on_kind is null
    and waiting_on_id is null
    and app.is_member_workflow_payload(organization_id, payload)
  );

drop policy if exists mention_insert on public.message_mention;
create policy mention_insert on public.message_mention
  for insert to authenticated
  with check (
    exists (
      select 1 from public.message m
      where m.id = message_mention.message_id
        and m.author_id = (select auth.uid())
    )
  );
