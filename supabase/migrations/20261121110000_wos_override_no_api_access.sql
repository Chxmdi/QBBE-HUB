-- Follow-up to 20261121100000_wos_switches_in_database, from its security
-- review.
--
-- 1. The override is the database owner's alone: no API role may read or
--    change it, the service role included. It accepts only the module names
--    the app knows, so a typo cannot open a module the app shows as off.
-- 2. "Any module on" counts only modules that keep data; turning on a screen
--    switch (phone layout, offline use) no longer opens the object registry.
-- 3. Nothing is recorded in the object event history while every module is
--    off, whichever trigger or call it comes from (profiles, properties,
--    relations and change sets as well as the classic records), and the
--    page activity log records nothing while pages are off.
-- 4. A deleted contact's or person's details also leave the activity log,
--    which copied them from the event history.
-- 5. Seven more tables that only Workspace OS uses get the switch policy.

revoke all on table app.workspace_os_override from public, anon, authenticated, service_role;

alter table app.workspace_os_override drop constraint workspace_os_override_key_check;
alter table app.workspace_os_override add constraint workspace_os_override_key_check check (key in (
  'all', 'wos_objects', 'wos_spaces', 'wos_pages', 'wos_editor', 'wos_lenses', 'wos_home', 'wos_capture',
  'wos_workflows_v2', 'wos_forms_v2', 'wos_public_pages', 'wos_offline', 'wos_meetings_v2',
  'wos_decisions_v2', 'wos_goals', 'wos_mobile', 'wos_object_approvals'
));

create or replace function app.wos_any_enabled()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.wos_enabled(array[
    'wos_objects', 'wos_spaces', 'wos_pages', 'wos_editor', 'wos_lenses', 'wos_home', 'wos_capture',
    'wos_workflows_v2', 'wos_forms_v2', 'wos_public_pages', 'wos_meetings_v2', 'wos_decisions_v2',
    'wos_goals', 'wos_object_approvals'
  ]);
$$;
revoke all on function app.wos_any_enabled() from public, anon;
grant execute on function app.wos_any_enabled() to authenticated, service_role;

-- 3. The one place every object event is written.
create or replace function app.record_object_event(
  p_organization uuid,
  p_object uuid,
  p_type text,
  p_verb text,
  p_changes jsonb default '[]'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor text := nullif(current_setting('app.actor', true), '');
  v_kind text;
  v_id text;
  v_change_set uuid;
begin
  if p_organization is null or p_object is null then
    return;
  end if;
  -- Every module off: Workspace OS keeps no copy of anything.
  if not app.wos_any_enabled() then
    return;
  end if;

  if v_actor is not null then
    v_kind := split_part(v_actor, ':', 1);
    v_id := nullif(substr(v_actor, length(v_kind) + 2), '');
    if v_kind not in ('person', 'team', 'automation', 'integration', 'system') then
      v_kind := 'system';
      v_id := null;
    end if;
  elsif (select auth.uid()) is not null then
    v_kind := 'person';
    v_id := (select auth.uid())::text;
  else
    v_kind := 'system';
  end if;

  begin
    v_change_set := nullif(current_setting('app.change_set_id', true), '')::uuid;
  exception when invalid_text_representation then
    v_change_set := null;
  end;

  insert into public.object_event
    (organization_id, object_id, object_type, actor_kind, actor_id, verb, changes, change_set_id)
  values
    (p_organization, p_object, p_type, v_kind, v_id, p_verb, coalesce(p_changes, '[]'::jsonb), v_change_set);
end;
$$;
revoke all on function app.record_object_event(uuid, uuid, text, text, jsonb) from public, anon, authenticated;

-- The page activity log (a pages feature) records nothing while pages are off.
do $$
declare
  v_trigger record;
begin
  for v_trigger in
    select t.oid, t.tgname, c.relname, pg_get_triggerdef(t.oid) as def
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_proc p on p.oid = t.tgfoid
    where not t.tgisinternal and p.proname like 'activity\_from\_%'
      and pg_get_triggerdef(t.oid) not like '% WHEN %'
  loop
    execute format('drop trigger %I on public.%I', v_trigger.tgname, v_trigger.relname);
    execute replace(v_trigger.def, ' EXECUTE FUNCTION ',
      $w$ WHEN (app.wos_enabled(array['wos_pages'])) EXECUTE FUNCTION $w$);
  end loop;
end;
$$;

-- 4. A deleted contact or person: their activity entries keep that something
-- happened, not their details.
create or replace function app.scrub_deleted_subject()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_object uuid;
begin
  -- Read through jsonb: the two tables name the subject's id differently.
  v_object := (to_jsonb(old) ->> case when tg_table_name = 'organization_membership' then 'user_id' else 'id' end)::uuid;
  update public.activity_entry set details = '{}'::jsonb, subject = null
  where object_id = v_object and (details <> '{}'::jsonb or subject is not null);
  return null;
end;
$$;
revoke all on function app.scrub_deleted_subject() from public, anon, authenticated;

create trigger crm_contact_scrub_activity
  after delete on public.crm_contact
  for each row execute function app.scrub_deleted_subject();
create trigger organization_membership_scrub_activity
  after delete on public.organization_membership
  for each row execute function app.scrub_deleted_subject();

-- 5. More tables only Workspace OS uses.
do $$
declare
  v_table text;
  v_keys text[];
  v_tables constant jsonb := '{
    "form_v2": ["wos_forms_v2"],
    "form_v2_response": ["wos_forms_v2"],
    "template_v2": ["wos_pages", "wos_objects"],
    "template_v2_version": ["wos_pages", "wos_objects"],
    "follow_v2": ["wos_objects"],
    "follow_rule_v2": ["wos_objects"],
    "workflow_event_cursor": ["wos_workflows_v2"],
    "publication": ["wos_public_pages"]
  }'::jsonb;
begin
  for v_table in select jsonb_object_keys(v_tables) loop
    select array_agg(k) into v_keys from jsonb_array_elements_text(v_tables -> v_table) k;
    execute format(
      'create policy wos_switch on public.%I as restrictive for all to authenticated
         using ((select app.wos_enabled(%L::text[]))) with check ((select app.wos_enabled(%L::text[])))',
      v_table, v_keys, v_keys);
  end loop;
end;
$$;
