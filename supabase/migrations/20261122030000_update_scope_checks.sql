-- Moving records between organizations, projects and programs.
--
-- Many update policies check the right to manage a record by looking up the
-- stored row by id, so the new organization, project, program, organizer
-- or creator a member writes is never checked. A project manager could move
-- a meeting or event into a project they cannot read and make themselves its
-- organizer or creator; members could move documents, events, notifications
-- and requests into another organization, and insert risks, issues,
-- reports, events and integration connections tagged with another
-- organization. Projects, programs, tasks, decision requests, comments and
-- goals already refused such moves; these tables did not.
--
-- Now, for members' own statements on these tables: a record keeps its
-- organization and creator; a new or changed project or program must be one
-- the member manages (and in the record's organization; for a request's
-- program and a notification's project, only the organization is checked);
-- a meeting's organizer changes only by its current organizer, an
-- administrator with MFA or a manager of its project or program; and a new record is in an organization the member
-- belongs to. Server code is unaffected. Trigger arguments name the scope
-- columns a table has. workspace_app is left to its own package.

create or replace function app.forbid_scope_move()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_new jsonb := to_jsonb(new);
  v_old jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) else null end;
  v_uid uuid := auth.uid();
  v_org uuid := (v_new->>'organization_id')::uuid;
  v_col text;
  v_value uuid;
  v_scope_org uuid;
  v_same_org_only boolean;
begin
  -- Invoker on purpose: current_user is 'authenticated' only for a member's
  -- own statement, not inside server functions.
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if v_org is not null and not exists (
      select 1 from public.organization_membership m
      where m.organization_id = v_org and m.user_id = v_uid and m.status = 'active'
    ) then
      raise exception 'You can only add records to your own organization.' using errcode = '42501';
    end if;
  else
    if v_new->'organization_id' is distinct from v_old->'organization_id' then
      raise exception 'A record cannot move to another organization.' using errcode = '42501';
    end if;
    if v_new ? 'created_by' and v_new->'created_by' is distinct from v_old->'created_by' then
      raise exception 'A record keeps its creator.' using errcode = '42501';
    end if;
  end if;

  foreach v_col in array coalesce(tg_argv, '{}'::text[]) loop
    -- 'org:<column>' checks only that the project or program is in the
    -- record's organization (for columns their writers may change freely).
    v_same_org_only := v_col like 'org:%';
    v_col := regexp_replace(v_col, '^org:', '');
    continue when v_col not in ('project_id', 'program_id');
    v_value := (v_new->>v_col)::uuid;
    continue when v_value is null;
    continue when tg_op = 'UPDATE' and v_new->v_col is not distinct from v_old->v_col;
    if v_col = 'project_id' then
      select p.organization_id into v_scope_org from public.project p where p.id = v_value;
    else
      select p.organization_id into v_scope_org from public.program p where p.id = v_value;
    end if;
    if v_scope_org is distinct from v_org then
      raise exception 'A record belongs to a project or program of its own organization.' using errcode = '42501';
    end if;
    -- Moving into a scope needs the right to manage it; adding to one is
    -- governed by each table's own insert policy.
    if tg_op = 'UPDATE' and not v_same_org_only and not (
      (v_col = 'project_id' and public.has_project_capability(v_value, 'manage'))
      or (v_col = 'program_id' and public.has_program_capability(v_value, 'manage'))
    ) then
      raise exception 'You can only move a record into a project or program you manage.' using errcode = '42501';
    end if;
  end loop;

  if tg_op = 'UPDATE' and 'organizer_id' = any (coalesce(tg_argv, '{}'::text[]))
     and v_new->'organizer_id' is distinct from v_old->'organizer_id'
     and not (
       -- The current organizer may hand the meeting over.
       v_old->>'organizer_id' = v_uid::text
       or (coalesce(auth.jwt()->>'aal', 'aal1') = 'aal2' and exists (
          select 1 from public.organization_membership m
          where m.organization_id = v_org and m.user_id = v_uid and m.status = 'active'
            and m.role in ('owner', 'admin')))
       or (v_new->>'project_id' is not null
           and public.has_project_capability((v_new->>'project_id')::uuid, 'manage'))
       or (v_new->>'project_id' is null and v_new->>'program_id' is not null
           and public.has_program_capability((v_new->>'program_id')::uuid, 'manage'))
     ) then
    raise exception 'Only an administrator or a manager of its project or program can change a meeting''s organizer.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function app.forbid_scope_move() from public, anon, authenticated;

do $$
declare
  r record;
begin
  for r in select * from (values
    ('document', array['project_id', 'program_id']),
    ('event', array['project_id', 'program_id']),
    ('meeting', array['project_id', 'program_id', 'organizer_id']),
    ('report_instance', array['project_id', 'program_id']),
    ('risk', array['project_id']),
    ('issue', array['project_id']),
    ('project_closure', array['project_id']),
    ('decision_request', array['project_id']),
    ('editor_document', array[]::text[]),
    ('integration_connection', array[]::text[]),
    ('meeting_capture', array[]::text[]),
    ('notification', array['org:project_id']),
    ('object_relation', array[]::text[]),
    ('project_request', array['org:program_id', 'org:project_id']),
    ('property_value', array[]::text[]),
    ('synced_block', array[]::text[]),
    ('synced_block_access_request', array[]::text[])
  ) as t(tbl, cols) loop
    execute format('drop trigger if exists %I on public.%I', r.tbl || '_forbid_scope_move', r.tbl);
    execute format(
      'create trigger %I before insert or update on public.%I for each row execute function app.forbid_scope_move(%s)',
      r.tbl || '_forbid_scope_move', r.tbl,
      coalesce((select string_agg(quote_literal(c), ', ') from unnest(r.cols) c), ''));
  end loop;
end;
$$;
