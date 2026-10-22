-- Workspace OS modules that are switched off are off at the database too.
--
-- The app hides a switched-off module and its Server Actions refuse, but
-- signed-in people can also call the database API directly. Until now nothing
-- there looked at the switches, so a module switched off in production could
-- still be read and written through it, and its triggers kept copying data
-- from the classic tables. This migration:
--
-- 1. adds app.wos_enabled(keys) / app.wos_any_enabled(): a module counts as on
--    when its feature_flag row is on (what the app reads), or when
--    app.workspace_os_override names it. The override is the database side of
--    the app's WORKSPACE_OS_FLAGS environment switch, which staging and CI
--    use; production never sets either.
-- 2. adds a restrictive row-security policy to the tables that belong only to
--    Workspace OS modules: while none of a table's modules is on, signed-in
--    callers read and write none of its rows. Tables classic features also
--    write (change sets, editor documents and blocks, decisions, public
--    pages) are left alone. Classic search reads pages through these rules,
--    so it stops showing links to switched-off pages.
-- 3. stops the object event triggers recording while every module is off, and
--    stops keeping a deleted contact's or person's values in event history.
-- 4. makes two directly callable functions answer nothing while their
--    modules are off.
--
-- Turning a module on starts its object history from that moment.

create table app.workspace_os_override (
  key text primary key check (key = 'all' or key like 'wos\_%'),
  created_at timestamptz not null default now()
);
alter table app.workspace_os_override enable row level security;
revoke all on table app.workspace_os_override from public, anon, authenticated;
comment on table app.workspace_os_override is
  'Database side of WORKSPACE_OS_FLAGS: Workspace OS modules on regardless of feature_flag. Staging and CI only; never set in production.';

create or replace function app.wos_enabled(p_keys text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
      select 1 from public.feature_flag f
      where f.key = any (p_keys) and f.enabled and f.organization_id is null
    )
    or exists (
      select 1 from app.workspace_os_override o
      where o.key = 'all' or o.key = any (p_keys)
    );
$$;

create or replace function app.wos_any_enabled()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
      select 1 from public.feature_flag f
      where f.key like 'wos\_%' and f.enabled and f.organization_id is null
    )
    or exists (select 1 from app.workspace_os_override);
$$;

revoke all on function app.wos_enabled(text[]) from public, anon;
revoke all on function app.wos_any_enabled() from public, anon;
grant execute on function app.wos_enabled(text[]) to authenticated, service_role;
grant execute on function app.wos_any_enabled() to authenticated, service_role;

-- 2. One restrictive policy per Workspace OS table, naming the modules that
-- use it. The check runs once per statement (the sub-select), not per row.
do $$
declare
  v_table text;
  v_keys text[];
  -- Each table and the modules that use it; null means any module (the
  -- object registry underneath every module).
  v_tables constant jsonb := '{
    "object": null,
    "object_type": null,
    "property_definition": null,
    "property_value": null,
    "object_relation": null,
    "relation_type": null,
    "object_event": null,
    "object_event_cursor": null,
    "space": null,
    "access_grant": null,
    "access_role": null,
    "blueprint": ["wos_objects"],
    "blueprint_build": ["wos_objects"],
    "workspace_app": ["wos_objects"],
    "workspace_app_grant": ["wos_objects"],
    "follow_event_cursor": ["wos_objects"],
    "capture_forward": ["wos_objects"],
    "upkeep_review": ["wos_objects"],
    "sign_in_rule": ["wos_spaces"],
    "page": ["wos_pages"],
    "page_favourite": ["wos_pages"],
    "page_visit": ["wos_pages"],
    "page_watch": ["wos_pages"],
    "page_presence": ["wos_pages"],
    "activity_entry": ["wos_pages"],
    "page_template_origin": ["wos_pages", "wos_objects"],
    "object_trash": ["wos_editor", "wos_objects", "wos_pages"],
    "object_version": ["wos_editor", "wos_objects", "wos_pages"],
    "object_lock": ["wos_editor", "wos_objects", "wos_pages"],
    "object_presence": ["wos_editor", "wos_objects", "wos_pages"],
    "object_suggestion": ["wos_editor", "wos_objects", "wos_pages"],
    "object_layout": ["wos_editor", "wos_objects"],
    "record_comment_mention": ["wos_editor", "wos_objects", "wos_pages"],
    "record_comment_reaction": ["wos_editor", "wos_objects", "wos_pages"],
    "editor_operation": ["wos_editor"],
    "synced_block": ["wos_editor"],
    "synced_block_access_request": ["wos_editor"],
    "lens": ["wos_lenses"],
    "lens_viewer_setting": ["wos_lenses"],
    "lens_column_setting": ["wos_lenses"],
    "lens_totals_setting": ["wos_lenses"],
    "home_visit": ["wos_home"],
    "capture_item": ["wos_capture"],
    "meeting_capture": ["wos_meetings_v2"],
    "goal": ["wos_goals"],
    "goal_metric": ["wos_goals"],
    "goal_project": ["wos_goals"],
    "object_approval": ["wos_object_approvals"],
    "workflow_execution_step": ["wos_workflows_v2"],
    "workflow_review": ["wos_workflows_v2"],
    "workflow_webhook_secret": ["wos_workflows_v2"],
    "api_token": ["wos_workflows_v2"],
    "api_request_log": ["wos_workflows_v2"]
  }'::jsonb;
begin
  for v_table in select jsonb_object_keys(v_tables) loop
    if v_tables -> v_table = 'null'::jsonb then
      execute format(
        'create policy wos_switch on public.%I as restrictive for all to authenticated
           using ((select app.wos_any_enabled())) with check ((select app.wos_any_enabled()))',
        v_table);
    else
      select array_agg(k) into v_keys from jsonb_array_elements_text(v_tables -> v_table) k;
      execute format(
        'create policy wos_switch on public.%I as restrictive for all to authenticated
           using ((select app.wos_enabled(%L::text[]))) with check ((select app.wos_enabled(%L::text[])))',
        v_table, v_keys, v_keys);
    end if;
  end loop;
end;
$$;

-- 3. Object events from the classic tables. Nothing is recorded while every
-- module is off, and a deleted contact's or person's events lose their
-- values, so their details do not outlive the record in the event history.
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

  -- A deleted contact or person takes their details out of the event
  -- history too. Other records keep theirs: the audit trail is built from
  -- these events and names what was deleted, as audit_event does.
  if tg_op = 'DELETE' and v_map.type_key in ('contact', 'person') then
    update public.object_event set changes = '[]'::jsonb
    where object_id = old.id and object_type = v_map.type_key and changes <> '[]'::jsonb;
    if app.wos_any_enabled() then
      perform app.record_object_event(old.organization_id, old.id, v_map.type_key, 'deleted', '[]'::jsonb);
    end if;
    return null;
  end if;

  if not app.wos_any_enabled() then
    return null;
  end if;

  if tg_op = 'DELETE' then
    -- Every non-empty system property, from its last value to nothing.
    v_changes := app.system_property_changes(old.organization_id, v_map.type_key, to_jsonb(old),
      (select jsonb_object_agg(k, null) from jsonb_object_keys(to_jsonb(old)) k));
    perform app.record_object_event(old.organization_id, old.id, v_map.type_key, 'deleted', v_changes);
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

create or replace function app.object_event_from_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    update public.object_event set changes = '[]'::jsonb
    where object_id = old.user_id and object_type = 'person' and organization_id = old.organization_id
      and changes <> '[]'::jsonb;
  end if;
  if not app.wos_any_enabled() then
    return null;
  end if;
  if tg_op = 'INSERT' then
    perform app.record_object_event(new.organization_id, new.user_id, 'person', 'created');
  elsif tg_op = 'DELETE' then
    perform app.record_object_event(old.organization_id, old.user_id, 'person', 'deleted');
  elsif new.status is distinct from old.status then
    perform app.record_object_event(
      new.organization_id, new.user_id, 'person',
      case when new.status = 'active' then 'restored' else 'archived' end,
      jsonb_build_array(jsonb_build_object('property', 'status', 'before', to_jsonb(old.status::text), 'after', to_jsonb(new.status::text)))
    );
  end if;
  return null;
end;
$$;

revoke all on function app.object_event_from_native() from public, anon, authenticated;
revoke all on function app.object_event_from_membership() from public, anon, authenticated;

-- 4. Two functions signed-in people can call directly. The history marker
-- answers nothing while every module is off; the sign-in rule status (a
-- spaces feature) answers nothing while spaces are off. Bodies otherwise as
-- before. The four daily Workspace OS jobs are left running: they only delete
-- expired trash, old versions and stale presence, which is wanted either way.
create or replace function public.object_event_high_water()
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when not app.wos_any_enabled() then null
    when (select auth.uid()) is null and not app.is_service_role() then null
    else app.object_event_high_water()
  end;
$$;

create or replace function public.my_sign_in_status()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when app.wos_enabled(array['wos_spaces']) then (
    select jsonb_build_object(
      'role', m.role,
      'require_mfa', coalesce(r.require_mfa, m.role in ('owner', 'admin')),
      'has_verified_factor', exists (
        select 1 from auth.mfa_factors f
        where f.user_id = m.user_id and f.factor_type = 'totp' and f.status = 'verified'),
      'aal', coalesce((select auth.jwt()) ->> 'aal', 'aal1'),
      'mfa_ok', not coalesce(r.require_mfa, m.role in ('owner', 'admin'))
                or coalesce((select auth.jwt()) ->> 'aal', 'aal1') = 'aal2',
      'max_session_hours', r.max_session_hours,
      'session_started_at', s.created_at,
      'session_ok', r.max_session_hours is null or s.created_at is null
                    or s.created_at > now() - make_interval(hours => r.max_session_hours))
    from public.organization_membership m
    left join public.sign_in_rule r on r.organization_id = m.organization_id and r.role = m.role
    left join auth.sessions s
      on s.id = nullif((select auth.jwt()) ->> 'session_id', '')::uuid and s.user_id = m.user_id
    where m.user_id = (select auth.uid()) and m.status = 'active'
    order by m.joined_at
    limit 1
  ) end;
$$;

revoke all on function public.object_event_high_water() from public, anon;
revoke all on function public.my_sign_in_status() from public, anon;
grant execute on function public.object_event_high_water() to authenticated, service_role;
grant execute on function public.my_sign_in_status() to authenticated, service_role;
