-- Match the existing public capability wrappers and derive the actor only from
-- auth.uid(); callers cannot ask about another user.
create function public.can_manage_meeting(p_meeting uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and app.can_manage_meeting(p_meeting);
$$;
revoke all on function public.can_manage_meeting(uuid) from public, anon;
grant execute on function public.can_manage_meeting(uuid) to authenticated;

-- Lock the meeting so retries and concurrent completion share one summary.
create or replace function public.complete_meeting(p_meeting uuid, p_summary text)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare m public.meeting; v_channel uuid;
begin
  if auth.uid() is null or not public.can_manage_meeting(p_meeting) then
    raise exception 'Meeting management access required' using errcode = '42501';
  end if;
  select * into m from public.meeting where id = p_meeting for update;
  if not found or m.status = 'cancelled' then
    raise exception 'Meeting is unavailable';
  end if;
  if p_summary is null or length(trim(p_summary)) = 0 then
    raise exception 'Summary is required';
  end if;
  v_channel := m.channel_id;
  if v_channel is null and m.project_id is not null then
    select id into v_channel from public.channel
      where project_id = m.project_id and archived_at is null order by id limit 1;
  end if;
  if v_channel is not null and m.summary_posted_at is null then
    insert into public.message (organization_id, channel_id, author_id, body,
      is_system, source_record_type, source_record_id)
    values (m.organization_id, v_channel, auth.uid(), p_summary, true, 'meeting', m.id);
  end if;
  update public.meeting set status = 'completed',
    summary_posted_at = case when v_channel is not null then coalesce(m.summary_posted_at, now())
      else m.summary_posted_at end
    where id = m.id;
  if not found then raise exception 'Meeting update denied' using errcode = '42501'; end if;
  return m.id;
end;
$$;
revoke all on function public.complete_meeting(uuid, text) from public, anon;
grant execute on function public.complete_meeting(uuid, text) to authenticated;

create or replace function public.create_meeting_action(
  p_meeting uuid, p_title text, p_owner uuid, p_due timestamptz default null
) returns uuid language plpgsql security invoker set search_path = '' as $$
declare m public.meeting; v_task uuid;
begin
  if auth.uid() is null or not public.can_manage_meeting(p_meeting) then
    raise exception 'Meeting management access required' using errcode = '42501';
  end if;
  select * into m from public.meeting where id = p_meeting for update;
  if not found or m.status = 'cancelled' then raise exception 'Meeting is unavailable'; end if;
  if p_title is null or length(trim(p_title)) not between 1 and 300 then
    raise exception 'Action title is required';
  end if;
  insert into public.task (organization_id, project_id, title, description,
    assignee_id, requester_id, due_at, created_by)
    values (m.organization_id, m.project_id, trim(p_title), 'Action from meeting “' || m.title || '”.',
      coalesce(p_owner, auth.uid()), auth.uid(), p_due, auth.uid()) returning id into v_task;
  insert into public.meeting_action (meeting_id, task_id, title, owner_id, due_at)
    values (m.id, v_task, trim(p_title), coalesce(p_owner, auth.uid()), p_due);
  if coalesce(p_owner, auth.uid()) <> auth.uid() then
    insert into public.notification (user_id, organization_id, category, title, body,
      source_type, source_id, link, dedupe_key)
      values (p_owner, m.organization_id, 'assignment', 'Meeting action assigned: ' || trim(p_title),
        'From “' || m.title || '”', 'task', v_task, '/my-work', 'assign:' || v_task || ':' || p_owner);
  end if;
  return v_task;
end;
$$;
revoke all on function public.create_meeting_action(uuid,text,uuid,timestamptz) from public, anon;
grant execute on function public.create_meeting_action(uuid,text,uuid,timestamptz) to authenticated;
