-- Workspace OS M9b: the activity feed, audit log and notifications can read
-- object_event (epic #199, design note section 6, "How the existing readers
-- move over").
--
-- Nothing is switched over here: the pages keep reading activity_event and
-- audit_event until integration moves them. This change makes object_event
-- carry everything those readers need and proves, in tests, that reading it
-- gives the same output as before:
--
-- 1. object_event gains project_id and program_id (filled on insert), which
--    is how the project and program pages filter the feed today.
-- 2. The task's remaining tracked fields become system properties
--    (milestone, approver, completion criteria, blocked reason), so every
--    field task history describes today is in the event's changes.
-- 3. A created event lists the record's first system property values and a
--    deleted event its last ones, so consumers and the audit trail know them
--    without reading a row that may be gone.
-- 4. object_activity_feed: object_event in activity_event's shape, plus the
--    activity_event rows written before object_event started.
-- 5. object_material_audit: the task.* rows task_material_audited writes to
--    audit_event, derived from object_event instead. The comparison test
--    (objects-event-readers.sql) runs the same changes and requires the two
--    to match exactly before that trigger is retired.
--
-- Notifications are produced by a consumer in the application
-- (src/features/objects/services/event-consumers.ts), with the same dedupe
-- keys as today, covered by a unit test.

-- ---------------------------------------------------------------------------
-- 1. Project and program on every event
-- ---------------------------------------------------------------------------

alter table public.object_event add column project_id uuid, add column program_id uuid;

create index idx_object_event_project on public.object_event (project_id, occurred_at desc)
  where project_id is not null;
create index idx_object_event_program on public.object_event (program_id, occurred_at desc)
  where program_id is not null;

create or replace function app.fill_object_event_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.project_id is not null or new.program_id is not null then
    return new;
  end if;

  case new.object_type
    when 'task' then
      select t.project_id, t.program_id into new.project_id, new.program_id
      from public.task t where t.id = new.object_id;
    when 'project' then
      select p.id, p.program_id into new.project_id, new.program_id
      from public.project p where p.id = new.object_id;
    when 'meeting' then
      select m.project_id, m.program_id into new.project_id, new.program_id
      from public.meeting m where m.id = new.object_id;
    when 'event' then
      select e.project_id, e.program_id into new.project_id, new.program_id
      from public.event e where e.id = new.object_id;
    when 'document' then
      select d.project_id, d.program_id into new.project_id, new.program_id
      from public.document d where d.id = new.object_id;
    when 'risk' then
      select r.project_id into new.project_id from public.risk r where r.id = new.object_id;
    when 'decision' then
      select d.project_id into new.project_id from public.decision d where d.id = new.object_id;
    when 'outcome_metric' then
      select m.program_id into new.program_id from public.outcome_metric m where m.id = new.object_id;
    else
      null;
  end case;

  if new.project_id is not null and new.program_id is null then
    select p.program_id into new.program_id from public.project p where p.id = new.project_id;
  end if;

  -- The record is gone (a delete): keep the scope its last event had.
  if new.project_id is null and new.program_id is null then
    select e.project_id, e.program_id into new.project_id, new.program_id
    from public.object_event e
    where e.object_id = new.object_id
    order by e.seq desc
    limit 1;
  end if;
  return new;
end;
$$;

revoke all on function app.fill_object_event_scope() from public, anon, authenticated;

create trigger object_event_scope before insert on public.object_event
  for each row execute function app.fill_object_event_scope();

-- ---------------------------------------------------------------------------
-- 2. The rest of the task's tracked fields as system properties
-- ---------------------------------------------------------------------------

create or replace function app.seed_task_tracking_properties(p_organization uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.property_definition
    (organization_id, type_id, key, name_en, name_fr, kind, options, system_column, position)
  select p_organization, t.id, p.key, p.en, p.fr, p.kind, p.options, p.col, p.position
  from (values
    ('milestone', 'Milestone', 'Jalon', 'relation', '{"relationTypeKey":"contains"}'::jsonb, 'milestone_id', 16),
    ('approver', 'Approver', 'Approbateur', 'person', '{}'::jsonb, 'approver_id', 17),
    ('completion_criteria', 'Completion criteria', 'Critères d''achèvement', 'text', '{}'::jsonb, 'completion_criteria', 18),
    ('blocked_reason', 'Blocked reason', 'Raison du blocage', 'text', '{}'::jsonb, 'blocked_reason', 19)
  ) as p(key, en, fr, kind, options, col, position)
  join public.object_type t on t.organization_id = p_organization and t.key = 'task'
  on conflict (type_id, key) do nothing;
$$;

revoke all on function app.seed_task_tracking_properties(uuid) from public, anon, authenticated;

create or replace function app.seed_native_object_types_for_new_organization()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.seed_native_object_types(new.id);
  perform app.seed_system_properties(new.id);
  perform app.seed_task_tracking_properties(new.id);
  perform app.seed_relation_types(new.id);
  return new;
end;
$$;

select app.seed_task_tracking_properties(o.id) from public.organization o;

-- ---------------------------------------------------------------------------
-- 3. Created and deleted events carry the values
-- ---------------------------------------------------------------------------

create or replace function app.object_event_from_native()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_map app.native_object_map;
  v_old jsonb;
  v_new jsonb;
  v_changes jsonb;
  v_was boolean;
  v_is boolean;
begin
  select * into v_map from app.native_object_map m where m.native_table = tg_table_name;
  if not found then
    return null;
  end if;

  if tg_op = 'INSERT' then
    -- Every non-empty system property, from nothing to its first value, so a
    -- consumer (the assignment notification, say) needs no second read.
    v_changes := app.system_property_changes(new.organization_id, v_map.type_key,
      (select jsonb_object_agg(k, null) from jsonb_object_keys(to_jsonb(new)) k), to_jsonb(new));
    perform app.record_object_event(new.organization_id, new.id, v_map.type_key, 'created', v_changes);
    return null;
  end if;
  if tg_op = 'DELETE' then
    -- Every non-empty system property, from its last value to nothing.
    v_changes := app.system_property_changes(old.organization_id, v_map.type_key, to_jsonb(old),
      (select jsonb_object_agg(k, null) from jsonb_object_keys(to_jsonb(old)) k));
    perform app.record_object_event(old.organization_id, old.id, v_map.type_key, 'deleted', v_changes);
    return null;
  end if;

  v_old := to_jsonb(old);
  v_new := to_jsonb(new);
  v_changes := app.system_property_changes(new.organization_id, v_map.type_key, v_old, v_new);
  v_was := app.native_row_archived(v_map, v_old);
  v_is := app.native_row_archived(v_map, v_new);

  if v_is and not v_was then
    perform app.record_object_event(new.organization_id, new.id, v_map.type_key, 'archived', v_changes);
  elsif v_was and not v_is then
    perform app.record_object_event(new.organization_id, new.id, v_map.type_key, 'restored', v_changes);
  elsif jsonb_array_length(v_changes) > 0 then
    perform app.record_object_event(new.organization_id, new.id, v_map.type_key, 'updated', v_changes);
  end if;
  return null;
end;
$$;

revoke all on function app.object_event_from_native() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Activity feed
-- ---------------------------------------------------------------------------

-- When object_event started recording for an organization. activity_event
-- rows older than this are still shown; newer ones are the old writers'
-- duplicates and are left out.
create or replace function app.object_event_started_at(p_organization uuid)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(min(e.occurred_at), 'infinity'::timestamptz)
  from public.object_event e where e.organization_id = p_organization;
$$;

revoke all on function app.object_event_started_at(uuid) from public, anon;
grant execute on function app.object_event_started_at(uuid) to authenticated;

create view public.object_activity_feed
with (security_invoker = true)
as
  select e.id, e.organization_id,
         case when e.actor_kind = 'person' then app.jsonb_uuid(jsonb_build_object('a', e.actor_id), 'a') end as actor_id,
         e.actor_kind,
         e.verb, e.object_type as source_type, e.object_id as source_id,
         e.project_id, e.program_id,
         null::text as summary,
         jsonb_build_object('changes', e.changes, 'change_set_id', e.change_set_id) as metadata,
         e.occurred_at as created_at,
         'object_event'::text as origin
  from public.object_event e
  union all
  select a.id, a.organization_id, a.actor_id,
         case when a.actor_id is null then 'system' else 'person' end,
         a.verb, a.source_type, a.source_id, a.project_id, a.program_id,
         a.summary, a.metadata, a.created_at,
         'activity_event'
  from public.activity_event a
  where a.created_at < app.object_event_started_at(a.organization_id);

comment on view public.object_activity_feed is
  'Activity feed read from object_event (M9b), with activity_event rows from before object_event started. Summaries of object_event rows are rendered by the app.';

revoke all on public.object_activity_feed from anon;
grant select on public.object_activity_feed to authenticated;

-- app.jsonb_uuid is called by the view as the reader.
grant execute on function app.jsonb_uuid(jsonb, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Material audit rows, derived from object_event
-- ---------------------------------------------------------------------------

create view public.object_material_audit
with (security_invoker = true)
as
  -- Deletion.
  select e.id as event_id, e.seq, e.organization_id, 'task.deletion'::text as event_type,
         'deleted'::text as action, 'task'::text as object_type, e.object_id,
         jsonb_build_object('title', (select c -> 'before' from jsonb_array_elements(e.changes) c
                                      where c ->> 'property' = 'title')) as metadata,
         e.occurred_at
  from public.object_event e
  where e.object_type = 'task' and e.verb = 'deleted'
  union all
  -- Assignment, status and due date, in that order within one change.
  select e.id, e.seq, e.organization_id, m.event_type, 'updated', 'task', e.object_id,
         jsonb_build_object('from', c -> 'before', 'to', c -> 'after'),
         e.occurred_at
  from public.object_event e
  cross join lateral jsonb_array_elements(e.changes) c
  join (values ('assignee', 'task.assignment'), ('status', 'task.status'), ('due', 'task.due_date'))
    as m(property, event_type) on m.property = c ->> 'property'
  where e.object_type = 'task' and e.verb in ('updated', 'archived', 'restored')
  union all
  -- Archive and restore.
  select e.id, e.seq, e.organization_id,
         case when e.verb = 'archived' then 'task.deletion' else 'task.restore' end,
         e.verb, 'task', e.object_id,
         -- The title at that moment: this event's new title, else the "before"
         -- of the next title change, else the title now.
         jsonb_build_object('title', coalesce(
           (select c -> 'after' from jsonb_array_elements(e.changes) c where c ->> 'property' = 'title'),
           (select c -> 'before'
            from public.object_event later
            cross join lateral jsonb_array_elements(later.changes) c
            where later.object_id = e.object_id and later.seq > e.seq and c ->> 'property' = 'title'
            order by later.seq
            limit 1),
           (select to_jsonb(o.title) from public.object o where o.id = e.object_id))),
         e.occurred_at
  from public.object_event e
  where e.object_type = 'task' and e.verb in ('archived', 'restored');

comment on view public.object_material_audit is
  'The task.* material audit rows (task_material_audited) derived from object_event (M9b). Compared with audit_event in objects-event-readers.sql.';

revoke all on public.object_material_audit from anon;
grant select on public.object_material_audit to authenticated;
