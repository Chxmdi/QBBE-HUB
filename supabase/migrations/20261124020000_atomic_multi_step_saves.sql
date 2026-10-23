-- Multi-step saves commit together or not at all.
--
-- Creating a project wrote the project, then its manager, then its channel,
-- each as its own request with the later results unread; creating a meeting
-- series did the same with its attendees and agenda, and closing a project
-- with its archived tasks, closure record and evidence. A failure part way
-- left half a save reported as success. Project channels also took their
-- slug from the project name, which is not unique, so a second project with
-- the same name silently had no channel.
--
-- Each save is now one function, run as the caller (SECURITY INVOKER), so
-- row-level security still decides every write exactly as before. Channel
-- slugs end with part of the project or program id. The one step still
-- allowed to be skipped is a project or program channel the creator may not
-- create (only staff may), which was skipped before too; nothing else is.

create or replace function public.create_project_with_channel(
  p_project jsonb, p_channel_name text, p_slug_base text, p_channel_purpose text)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  r public.project := jsonb_populate_record(null::public.project, p_project);
  v_owner uuid := coalesce(r.owner_id, auth.uid());
  v_channel uuid := gen_random_uuid();
begin
  insert into public.project (id, organization_id, program_id, name, outcome, owner_id, sponsor_id, stage,
    health, health_reason, priority, reporting_cadence, funding_source_id, start_date, target_date, created_by)
  values (r.id, r.organization_id, r.program_id, r.name, r.outcome, v_owner, r.sponsor_id, r.stage,
    r.health, r.health_reason, r.priority, r.reporting_cadence, r.funding_source_id, r.start_date, r.target_date,
    r.created_by);

  insert into public.project_membership (project_id, user_id, role) values (r.id, v_owner, 'manager');

  -- Only staff may create channels: anyone else still gets the project,
  -- without one, as before. Nothing else is skipped.
  begin
    insert into public.channel (id, organization_id, name, slug, type, privacy, purpose, project_id, program_id,
      owner_id, created_by)
    values (v_channel, r.organization_id, p_channel_name,
      'project-' || coalesce(nullif(p_slug_base, ''), 'project') || '-' || left(replace(r.id::text, '-', ''), 8),
      'project', 'public', p_channel_purpose, r.id, r.program_id, v_owner, r.created_by);
    perform public.add_channel_member(v_channel, v_owner);
  exception when insufficient_privilege then
    null;
  end;
  return r.id;
end;
$$;

create or replace function public.create_program_with_channel(
  p_program jsonb, p_channel_name text, p_slug_base text, p_channel_purpose text)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  r public.program := jsonb_populate_record(null::public.program, p_program);
  v_lead uuid := coalesce(r.lead_id, auth.uid());
  v_channel uuid := gen_random_uuid();
begin
  insert into public.program (id, organization_id, name, slug, description, lead_id, created_by)
  values (r.id, r.organization_id, r.name, r.slug, r.description, v_lead, r.created_by);

  begin
    insert into public.channel (id, organization_id, name, slug, type, privacy, purpose, program_id, owner_id, created_by)
    values (v_channel, r.organization_id, p_channel_name,
      'program-' || coalesce(nullif(p_slug_base, ''), 'program') || '-' || left(replace(r.id::text, '-', ''), 8),
      'program', 'public', p_channel_purpose, r.id, v_lead, r.created_by);
    perform public.add_channel_member(v_channel, v_lead);
  exception when insufficient_privilege then
    null;
  end;
  return r.id;
end;
$$;

create or replace function public.create_meeting_series(p_meetings jsonb, p_attendees jsonb, p_agenda jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  insert into public.meeting (id, organization_id, project_id, title, purpose, organizer_id, starts_at, ends_at,
    location, meeting_link, series_id, recurrence_rule)
  select id, organization_id, project_id, title, purpose, organizer_id, starts_at, ends_at,
    location, meeting_link, series_id, recurrence_rule
  from jsonb_populate_recordset(null::public.meeting, p_meetings);

  insert into public.meeting_attendee (meeting_id, user_id)
  select meeting_id, user_id from jsonb_populate_recordset(null::public.meeting_attendee, coalesce(p_attendees, '[]'));

  insert into public.agenda_item (meeting_id, title, desired_outcome, sort_key, proposed_by)
  select meeting_id, title, desired_outcome, sort_key, proposed_by
  from jsonb_populate_recordset(null::public.agenda_item, coalesce(p_agenda, '[]'));
end;
$$;

create or replace function public.close_project_with_evidence(
  p_project uuid, p_update jsonb, p_closure jsonb, p_document_ids uuid[], p_archive_open_tasks boolean)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  u public.project_status_update := jsonb_populate_record(null::public.project_status_update, p_update);
  c public.project_closure := jsonb_populate_record(null::public.project_closure, p_closure);
  v_closure uuid;
begin
  -- The final update comes first: a project is never closed without one.
  insert into public.project_status_update (project_id, author_id, health, progress_summary, next_steps)
  values (p_project, auth.uid(), u.health, u.progress_summary, u.next_steps);

  update public.project set stage = 'completed', completed_at = now() where id = p_project;
  if not found then
    raise exception 'Project not found' using errcode = '42501';
  end if;

  if coalesce(p_archive_open_tasks, false) then
    update public.task set archived_at = now()
    where project_id = p_project and archived_at is null
      and status in ('not_started', 'ready', 'in_progress', 'waiting', 'blocked', 'in_review');
  end if;

  -- Closing a reopened project replaces its old closure record.
  insert into public.project_closure (organization_id, project_id, results, lessons, evidence_links, closed_by, closed_at)
  values (c.organization_id, p_project, c.results, c.lessons, coalesce(c.evidence_links, '[]'::jsonb), auth.uid(), now())
  on conflict (project_id) do update
    set results = excluded.results, lessons = excluded.lessons, evidence_links = excluded.evidence_links,
        closed_by = excluded.closed_by, closed_at = excluded.closed_at
  returning id into v_closure;

  if cardinality(coalesce(p_document_ids, '{}')) > 0 then
    delete from public.project_closure_document where closure_id = v_closure;
    insert into public.project_closure_document (closure_id, document_id)
    select v_closure, d from unnest(p_document_ids) as d;
  end if;
  return v_closure;
end;
$$;

revoke all on function public.create_project_with_channel(jsonb, text, text, text) from public, anon;
revoke all on function public.create_program_with_channel(jsonb, text, text, text) from public, anon;
revoke all on function public.create_meeting_series(jsonb, jsonb, jsonb) from public, anon;
revoke all on function public.close_project_with_evidence(uuid, jsonb, jsonb, uuid[], boolean) from public, anon;
grant execute on function public.create_project_with_channel(jsonb, text, text, text) to authenticated;
grant execute on function public.create_program_with_channel(jsonb, text, text, text) to authenticated;
grant execute on function public.create_meeting_series(jsonb, jsonb, jsonb) to authenticated;
grant execute on function public.close_project_with_evidence(uuid, jsonb, jsonb, uuid[], boolean) to authenticated;
